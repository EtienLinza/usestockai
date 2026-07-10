// ============================================================================
// AUTOTRADER SCAN — fully automated trade lifecycle, runs every 10 min via cron
//
// Per opted-in user:
//   1. Loads open virtual_positions + watchlist
//   2. Batch-fetches OHLCV (cached across users in this invocation)
//   3. For each open position → runExitDecision (Win + Loss in parallel)
//   4. For each watchlist ticker without a position → runEntryDecision
//   5. Executes (paper-mode by default), logs to autotrade_log, posts sell_alerts
//
// Reuses the canonical evaluateSignal() engine — same code path the backtest validates.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  calculateATR,
  calculateRSI,
  calculateMACD,
  calculateSMA,
  calculateEMA,
  safeGet,
} from "../_shared/indicators.ts";
import {
  evaluateSignal,
  primeTrackerCacheFromDB,
  persistTrackerCacheToDB,
  clearTrackerCache,
  classifyStock,
  PROFILE_PARAMS,
  type DataSet,
  type MacroContext,
  type ProfileParams,
  type StockProfile,
} from "../_shared/signal-engine-v2.ts";
import { isMarketHoliday, nyseCloseMinute } from "../_shared/market-calendar.ts";
import { evaluateScanHealth, type TickerHealth } from "../_shared/circuit-breaker.ts";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import { getQuoteWithFallback, getEarningsBlackoutDays, getSector, getBeta } from "../_shared/finnhub.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { applyIsotonicCalibration, type IsotonicAnchor } from "../_shared/calibration.ts";
import { loadDanelfinScores } from "../_shared/danelfin.ts";
import { loadEpsRevisions } from "../_shared/eps-revisions.ts";
import { loadLatestRegime } from "../_shared/regime-detector.ts";
import { loadLatestMetaModel, scoreMetaLabel, type MetaLabelModel } from "../_shared/meta-labeler.ts";
import { loadShortInterestMap, shortInterestConvictionDelta, type ShortInterestRow } from "../_shared/short-interest.ts";
import { slippageShrinkFactor } from "../_shared/slippage-model.ts";
import {
  computePortfolioCvarBase,
  computePortfolioCvarMarginal,
  closeToReturns,
  DEFAULT_CVAR_CAP_PCT,
  type CvarBase,
  type CvarPosition,
} from "../_shared/portfolio-cvar.ts";
import { detectAdwinDrift, adwinGateAdjust } from "../_shared/adwin.ts";

/** Thrown by the circuit breaker to abort the entire scan immediately. */
class CircuitBreakerTrippedError extends Error {
  constructor(public readonly verdictReason: string) {
    super(verdictReason);
    this.name = "CircuitBreakerTrippedError";
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Daily candle fetch with caching (per invocation) ─────────────────────
// Historical bars come from Yahoo (Finnhub free tier blocks /stock/candle).
const priceCache = new Map<string, DataSet | null>();

async function fetchYahooData(ticker: string): Promise<DataSet | null> {
  if (priceCache.has(ticker)) return priceCache.get(ticker)!;
  const ds = await fetchDailyHistory(ticker, "1y");
  priceCache.set(ticker, ds);
  return ds;
}

async function batchFetch(tickers: string[]): Promise<void> {
  const need = tickers.filter(t => !priceCache.has(t));
  for (let i = 0; i < need.length; i += 5) {
    const batch = need.slice(i, i + 5);
    await Promise.all(batch.map(fetchYahooData));
    if (i + 5 < need.length) await new Promise(r => setTimeout(r, 200));
  }
}

// ── Live intraday quote — Finnhub primary, Yahoo fallback ──────────────────
// Used at entry execution to get an actual fillable price (no longer reliant
// on Yahoo crumb cookies). Returns null if both providers fail.
interface LiveQuote { price: number; previousClose: number | null; marketState: string | null }
async function fetchLiveQuote(ticker: string): Promise<LiveQuote | null> {
  const q = await getQuoteWithFallback(ticker);
  if (!q) return null;
  return {
    price: q.price,
    previousClose: q.previousClose,
    marketState: q.marketState,
  };
}

// ============================================================================
// TYPES
// ============================================================================

interface Position {
  id: string; user_id: string; ticker: string;
  position_type: "long" | "short";
  entry_price: number; shares: number;
  created_at: string;
  peak_price: number | null;
  trailing_stop_price: number | null;
  hard_stop_price: number | null;
  entry_atr: number | null;
  entry_conviction: number | null;
  entry_strategy: string | null;
  entry_profile: string | null;
  entry_weekly_alloc: number | null;
  breakout_failed_count: number;
  opened_by: string;
  opened_by_rotation: boolean;
  signal_id: string | null;
  partial_exits_taken: number;
  // Pyramid / re-entry state (add-on engine)
  add_on_count: number | null;
  last_add_on_at: string | null;
  original_shares: number | null;
  partial_trim_price: number | null;
  partial_trim_shares: number | null;
  reentry_deadline: string | null;
}

interface Settings {
  user_id: string; enabled: boolean;
  kill_switch: boolean;
  /** off | freeze_entries | liquidate (preferred over legacy kill_switch). */
  emergency_mode: "off" | "freeze_entries" | "liquidate";
  /** Capital rotation: replace worst open position with a stronger fresh signal. */
  rotation_enabled: boolean;
  rotation_min_delta_conviction: number;
  rotation_max_per_day: number;
  rotation_count_today: number;
  rotation_day: string | null;
  min_conviction: number; max_positions: number;
  max_nav_exposure_pct: number; max_single_name_pct: number;
  daily_loss_limit_pct: number; starting_nav: number;
  paper_mode: boolean; notify_on_action: boolean;
  advanced_mode: boolean;
  scan_interval_minutes: number;
  last_scan_at: string | null;
  next_scan_at: string | null;
  risk_profile: "conservative" | "balanced" | "aggressive";
  adaptive_mode: boolean;
  auto_add_watchlist: boolean;
  auto_watchlist_consideration_floor: number;
  auto_watchlist_stale_days: number;
  /** Computed at runtime — 30-day rolling NAV drawdown % (positive = decline). */
  current_drawdown_pct: number;
  /** Computed at runtime — 30-day CDaR_0.95 (mean of worst 5% daily drawdowns). */
  current_cdar_pct: number;
}

interface AdaptiveContext {
  vix: number | null;
  vixRegime: "calm" | "normal" | "elevated" | "crisis";
  spyTrend: "up" | "down" | "flat";
  recentPnlPct: number;        // last 7-day realized P&L % vs starting NAV
  windowDays: number;
  /** 30-day rolling NAV drawdown % from peak (positive number). */
  rollingDrawdownPct: number;
  /** 30-day CDaR at α=0.95 — mean of worst 5% of daily peak-to-current drawdowns. */
  rollingCdarPct: number;
  adjustments: string[];       // human-readable reasons applied
}

// ── Rolling drawdown circuit breaker (Phase 3 #16) ─────────────────────────
// Hard-block all new entries once trailing 30-day NAV drawdown exceeds this
// threshold. Independent of daily_loss_limit (intraday) and recentPnlPct
// (7-day realized) — catches slow bleeds the other two miss.
const ROLLING_DD_HARD_BLOCK_PCT = 10;

// ── CDaR (Conditional Drawdown-at-Risk) circuit breaker — idea #13 ────────
// CDaR_α is the mean of drawdown observations in the worst (1−α) tail.
// More robust than a single peak-to-current snapshot because it captures
// the *severity* of the recent loss path, not just one moment. Tuned to
// fire before the peak-to-current breaker on persistent slow bleeds.
const CDAR_ALPHA = 0.95;
const CDAR_HARD_BLOCK_PCT = 12; // hard-block entries
const CDAR_HALF_EXPOSURE_PCT = 8; // halve max NAV exposure
const CDAR_TIGHTEN_PCT = 5; // mild tightening

// (Sentiment / AI layer removed: signals are now 100% deterministic.
//  Trading-loop AI was a regulatory + reproducibility risk — keep this surface
//  pure technical from now on.)

// ─── Risk profile baselines ──────────────────────────────────────────────
const RISK_PROFILE_BASELINES = {
  conservative: { minConv: 78, maxPos: 5, maxNav: 60, maxSingle: 12 },
  balanced:     { minConv: 72, maxPos: 8, maxNav: 80, maxSingle: 20 },
  aggressive:   { minConv: 66, maxPos: 12, maxNav: 95, maxSingle: 28 },
} as const;

// SPY 50-SMA slope check
function spyTrendOf(macro: MacroContext | null): "up" | "down" | "flat" {
  if (!macro || macro.spyClose.length < 50) return "flat";
  const c = macro.spyClose;
  const sma = calculateSMA(c, 50);
  const last = sma[sma.length - 1];
  const prev = sma[sma.length - 6] ?? last;
  if (!Number.isFinite(last) || !Number.isFinite(prev)) return "flat";
  const slope = (last - prev) / prev;
  if (slope > 0.005) return "up";
  if (slope < -0.005) return "down";
  return "flat";
}
function isBearishMacro(macro: MacroContext | null): boolean {
  return spyTrendOf(macro) === "down";
}

// ── Vol-targeting scalar (improvement #7) ─────────────────────────────────
// Continuous portfolio-level position-size scalar based on SPY's recent
// realized volatility. We target ~16% annualized portfolio vol — a common
// risk-parity anchor. When SPY realized vol > target, scale sizes down;
// when < target, scale up modestly. Continuous (not regime-bucketed) so
// sizing reacts smoothly as conditions evolve.
//
// M-6 FIX: lookback is 63 bars (≈ one quarter, institutional standard) instead
// of 20. The 20-bar window was too noisy — transient VIX spikes halved sizing
// for an entire month after the spike rolled off. 63 bars is the same window
// banks/risk-parity desks use for the same reason. We also keep a 20-bar
// "fast" measurement and surface it in logs for transparency.
const VOL_TARGET_ANNUAL = 0.16;
const VOL_LOOKBACK = 63;
const VOL_LOOKBACK_FAST = 20;
const VOL_SCALAR_MIN = 0.5;
const VOL_SCALAR_MAX = 1.25;

function realizedVolAnnualized(close: number[], lookback: number): number | null {
  if (close.length < lookback + 1) return null;
  let sum = 0; const rets: number[] = [];
  for (let i = close.length - lookback; i < close.length; i++) {
    const a = close[i - 1], b = close[i];
    if (!(a > 0 && b > 0)) continue;
    const r = Math.log(b / a);
    rets.push(r); sum += r;
  }
  if (rets.length < 5) return null;
  const m = sum / rets.length;
  let v = 0; for (const r of rets) v += (r - m) * (r - m);
  v /= Math.max(1, rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

function volTargetScalar(macro: MacroContext | null): { scalar: number; spyVol: number | null; spyVolFast: number | null } {
  if (!macro) return { scalar: 1, spyVol: null, spyVolFast: null };
  let spyVol = realizedVolAnnualized(macro.spyClose, VOL_LOOKBACK);
  const spyVolFast = realizedVolAnnualized(macro.spyClose, VOL_LOOKBACK_FAST);
  // Fallback: not enough bars for 63 (e.g. fresh ticker) — fall back to fast window.
  if (spyVol == null || spyVol <= 0) spyVol = spyVolFast;
  if (spyVol == null || spyVol <= 0) return { scalar: 1, spyVol: null, spyVolFast };
  const raw = VOL_TARGET_ANNUAL / spyVol;
  const scalar = Math.max(VOL_SCALAR_MIN, Math.min(VOL_SCALAR_MAX, raw));
  return { scalar, spyVol, spyVolFast };
}

// VIX regime classifier
function vixRegimeOf(vix: number | null): "calm" | "normal" | "elevated" | "crisis" {
  if (vix == null || !Number.isFinite(vix)) return "normal";
  if (vix < 15) return "calm";
  if (vix < 22) return "normal";
  if (vix < 30) return "elevated";
  return "crisis";
}

// ─── Adaptive engine: derive effective settings from regime + perf + profile ──
function computeEffectiveSettings(
  s: Settings,
  ctx: AdaptiveContext,
  regimeFloors: Record<string, number> | null,
): Settings {
  // If adaptive_mode is OFF and advanced_mode is ON, use stored values verbatim.
  // Otherwise we always layer adaptive logic on top of a profile baseline.
  const adjustments: string[] = [];

  // Pick baseline:
  //   - adaptive_mode ON  → from risk_profile
  //   - adaptive_mode OFF → user's stored values (advanced) or risk_profile baseline
  let minConv: number;
  let maxPos: number;
  let maxNav: number;
  let maxSingle: number;

  if (s.adaptive_mode) {
    const baseline = RISK_PROFILE_BASELINES[s.risk_profile];
    minConv = baseline.minConv;
    maxPos = Math.min(baseline.maxPos, Math.max(3, Math.round(s.starting_nav / 12500)));
    maxNav = baseline.maxNav;
    maxSingle = baseline.maxSingle;
    adjustments.push(`base: ${s.risk_profile} profile`);
  } else if (s.advanced_mode) {
    minConv = s.min_conviction;
    maxPos = s.max_positions;
    maxNav = s.max_nav_exposure_pct;
    maxSingle = s.max_single_name_pct;
  } else {
    const baseline = RISK_PROFILE_BASELINES[s.risk_profile];
    minConv = baseline.minConv;
    maxPos = Math.min(baseline.maxPos, Math.max(3, Math.round(s.starting_nav / 12500)));
    maxNav = baseline.maxNav;
    maxSingle = baseline.maxSingle;
  }

  // ── Layer 1: VIX regime modulation (only when adaptive) ──
  if (s.adaptive_mode) {
    // Conviction/position deltas stay discrete (cliff edges read better in
    // logs), but NAV exposure now follows a CONTINUOUS regime curve
    // (Phase 3 #13) so we don't whipsaw between, say, 80% → 70% → 80% as VIX
    // crosses 19.5. Curve: maxNav = baseline × (0.4 + 0.6 × regimeScore),
    // floored at 30. regimeScore ∈ [0,1] blends VIX (60%) + SPY trend (40%).
    const baselineMaxNav = maxNav;
    const vixVal = ctx.vix ?? 18;
    // Piecewise-linear VIX score: 1 at ≤14, 0.7 at 18, 0.4 at 25, 0.1 at 35, 0 at ≥45
    const vixScore = vixVal <= 14 ? 1.0
      : vixVal <= 18 ? 1.0 - 0.3 * ((vixVal - 14) / 4)
      : vixVal <= 25 ? 0.7 - 0.3 * ((vixVal - 18) / 7)
      : vixVal <= 35 ? 0.4 - 0.3 * ((vixVal - 25) / 10)
      : vixVal <= 45 ? 0.1 - 0.1 * ((vixVal - 35) / 10)
      : 0;
    const spyScore = ctx.spyTrend === "up" ? 1.0 : ctx.spyTrend === "flat" ? 0.7 : 0.3;
    const regimeScore = Math.max(0, Math.min(1, 0.6 * vixScore + 0.4 * spyScore));
    maxNav = Math.max(30, Math.min(baselineMaxNav, baselineMaxNav * (0.4 + 0.6 * regimeScore)));
    adjustments.push(`continuous regime NAV: vix=${vixVal.toFixed(1)} spy=${ctx.spyTrend} score=${regimeScore.toFixed(2)} → ${maxNav.toFixed(0)}% (base ${baselineMaxNav})`);

    // Discrete conviction/position deltas (kept for clarity in logs)
    switch (ctx.vixRegime) {
      case "calm":
        minConv -= 2; maxPos += 1;
        adjustments.push(`calm VIX (${ctx.vix?.toFixed(1) ?? "?"}): −2 conv, +1 pos`);
        break;
      case "normal":
        break;
      case "elevated":
        minConv += 4; maxPos -= 1; maxSingle -= 3;
        adjustments.push(`elevated VIX (${ctx.vix?.toFixed(1) ?? "?"}): +4 conv, −1 pos, −3 single`);
        break;
      case "crisis":
        minConv += 10; maxPos = Math.min(maxPos, 3); maxSingle = Math.min(maxSingle, 10);
        adjustments.push(`crisis VIX (${ctx.vix?.toFixed(1) ?? "?"}): +10 conv, hard caps applied`);
        break;
    }

    // ── Layer 2: SPY trend (conviction only — NAV handled by regime curve) ──
    if (ctx.spyTrend === "down") {
      minConv += 4;
      adjustments.push(`SPY downtrend: +4 conv`);
    } else if (ctx.spyTrend === "up") {
      minConv -= 1;
      adjustments.push(`SPY uptrend: −1 conv`);
    }

    // ── Layer 3: Performance feedback (rolling 7-day) ──
    if (ctx.recentPnlPct <= -5) {
      minConv += 8; maxPos = Math.max(2, maxPos - 2); maxSingle = Math.max(8, maxSingle * 0.6);
      adjustments.push(`drawdown ${ctx.recentPnlPct.toFixed(1)}%: +8 conv, tighter caps`);
    } else if (ctx.recentPnlPct <= -2) {
      minConv += 3; maxSingle = Math.max(10, maxSingle * 0.8);
      adjustments.push(`mild drawdown ${ctx.recentPnlPct.toFixed(1)}%: +3 conv`);
    } else if (ctx.recentPnlPct >= 5) {
      minConv -= 2;
      adjustments.push(`strong P&L +${ctx.recentPnlPct.toFixed(1)}%: −2 conv`);
    }

    // ── Layer 3b: 30-day rolling drawdown (Phase 3 #16) ──
    // Slow-bleed protection — graduated tightening; hard block enforced in
    // runEntryDecision at ROLLING_DD_HARD_BLOCK_PCT regardless of adaptive_mode.
    const dd = ctx.rollingDrawdownPct;
    if (dd >= 8) {
      minConv += 6; maxPos = Math.max(1, maxPos - 2); maxNav = Math.min(maxNav, maxNav * 0.6);
      adjustments.push(`30d drawdown ${dd.toFixed(1)}%: +6 conv, NAV×0.6`);
    } else if (dd >= 5) {
      minConv += 3; maxNav = Math.min(maxNav, maxNav * 0.8);
      adjustments.push(`30d drawdown ${dd.toFixed(1)}%: +3 conv, NAV×0.8`);
    }

    // ── Layer 3c: CDaR_0.95 (idea #13) — severity-aware breaker ──
    // Looks at the mean depth of the worst 5% of the last 30 daily drawdowns.
    // Catches "many shallow red days in a row" that the single-point peak
    // breaker would only catch on the final close.
    const cdar = ctx.rollingCdarPct;
    if (cdar >= CDAR_HALF_EXPOSURE_PCT) {
      minConv += 5; maxNav = Math.min(maxNav, maxNav * 0.5);
      adjustments.push(`CDaR ${cdar.toFixed(1)}%: +5 conv, NAV×0.5`);
    } else if (cdar >= CDAR_TIGHTEN_PCT) {
      minConv += 2; maxNav = Math.min(maxNav, maxNav * 0.85);
      adjustments.push(`CDaR ${cdar.toFixed(1)}%: +2 conv, NAV×0.85`);
    }

    // ── Layer 4: Calibration floor (from nightly strategy_weights.regime_floors) ──
    if (regimeFloors) {
      const regimeKey = ctx.spyTrend === "down" ? "bear" : ctx.vixRegime === "calm" ? "bull" : "neutral";
      const calFloor = Number(regimeFloors[regimeKey]);
      if (Number.isFinite(calFloor) && calFloor > minConv) {
        adjustments.push(`calibration floor (${regimeKey}): conv raised ${minConv}→${calFloor}`);
        minConv = calFloor;
      }
    }
  }

  // ── Hard safety clamps ──
  minConv = Math.max(55, Math.min(95, Math.round(minConv)));
  maxPos = Math.max(1, Math.min(20, Math.round(maxPos)));
  maxNav = Math.max(20, Math.min(100, maxNav));
  maxSingle = Math.max(5, Math.min(50, maxSingle));

  ctx.adjustments = adjustments;

  return {
    ...s,
    min_conviction: minConv,
    max_positions: maxPos,
    max_nav_exposure_pct: maxNav,
    max_single_name_pct: maxSingle,
    daily_loss_limit_pct: s.daily_loss_limit_pct, // always user-controlled / 3% default
    current_drawdown_pct: ctx.rollingDrawdownPct,
    current_cdar_pct: ctx.rollingCdarPct,
  };
}

// Autopilot scan cadence — tighter on volatile/open, looser on calm afternoons.
// P-8 FIX: use Intl to derive the actual NY hour so the cadence aligns with
// the cash session in both EDT (UTC−4) and EST (UTC−5). The old code hardcoded
// UTC−4, which was off by an hour for ~5 months/year (Nov→Mar).
function algoScanIntervalMinutes(macro: MacroContext | null, vixRegime: string): number {
  const nyHourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", hour12: false,
  }).format(new Date());
  const nyHour = Number(nyHourStr) % 24;
  if (nyHour === 9 || nyHour === 10) return 5;
  if (vixRegime === "elevated" || vixRegime === "crisis") return 5;
  if (isBearishMacro(macro)) return 5;
  if (nyHour >= 14 && nyHour < 16) return 15;
  return 10;
}

type ExitAction =
  | { kind: "HOLD"; reason: string; trailingUpdate?: number; peakUpdate?: number }
  | { kind: "FULL_EXIT"; reason: string; price: number }
  | { kind: "PARTIAL_EXIT"; reason: string; pct: number; price: number; nextRung?: number; trailingUpdate?: number };

// ── Correlation-aware portfolio gating (improvement #4) ─────────────────
// Compute simple log-returns over the last `lookback` daily bars and return
// the Pearson correlation coefficient. Returns null if either series is too
// short or has zero variance (avoids NaN poisoning the gate).
const CORR_LOOKBACK_BARS = 60;
// Correlation gate is now **adaptive** (Phase 1 of the adaptive-constants sweep).
// Base 0.75 stays as the neutral / bull_quiet reading, but volatile regimes
// tighten toward 0.60 because a single factor blow-up in a stressed tape is
// far more likely to take multiple positions with it. VIX regime can only
// tighten further, never loosen. Kept as a helper so every call site pulls
// from the same source of truth.
function adaptiveCorrThreshold(
  marketRegime: string | null | undefined,
  vixRegime: "calm" | "normal" | "elevated" | "crisis",
): number {
  let t = 0.75;
  switch (marketRegime) {
    case "bull_quiet":     t = 0.80; break;
    case "bull_volatile":  t = 0.68; break;
    case "bear_quiet":     t = 0.68; break;
    case "bear_volatile":  t = 0.60; break;
    default:               t = 0.75;
  }
  if (vixRegime === "crisis")   t = Math.min(t, 0.58);
  else if (vixRegime === "elevated") t = Math.min(t, 0.66);
  return t;
}

function dailyReturns(close: number[], lookback: number): number[] {
  const n = close.length;
  if (n < lookback + 1) return [];
  const out: number[] = [];
  for (let i = n - lookback; i < n; i++) {
    const prev = close[i - 1], cur = close[i];
    if (prev > 0 && cur > 0) out.push(Math.log(cur / prev));
  }
  return out;
}

function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  // H-8 FIX: require ≥60 overlapping bars before applying the 0.75 correlation
  // threshold (which was calibrated on a full 60-bar window). Short-history
  // tickers used to be compared at 30 bars and tripped the gate noisily.
  if (n < 60) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}

/**
 * Returns the highest absolute correlation between `candidate` and any of the
 * open positions over the last 60 daily bars, or null if not enough data.
 * Also returns the ticker that drove the max correlation (for log clarity).
 */
function maxCorrelationToBook(
  candidateTicker: string,
  openTickers: string[],
): { maxAbs: number; against: string } | null {
  const candData = priceCache.get(candidateTicker);
  if (!candData) return null;
  const candRet = dailyReturns(candData.close, CORR_LOOKBACK_BARS);
  if (candRet.length < 60) return null;

  let bestAbs = 0;
  let bestTicker = "";
  for (const t of openTickers) {
    if (t === candidateTicker) continue;
    const d = priceCache.get(t);
    if (!d) continue;
    const r = dailyReturns(d.close, CORR_LOOKBACK_BARS);
    const c = pearson(candRet, r);
    if (c === null) continue;
    const a = Math.abs(c);
    if (a > bestAbs) { bestAbs = a; bestTicker = t; }
  }
  return bestTicker ? { maxAbs: bestAbs, against: bestTicker } : null;
}

type EntryAction =
  | { kind: "ENTER"; conviction: number; kellyFraction: number; price: number;
      strategy: string; profile: StockProfile; atr: number; hardStop: number;
      weeklyAlloc: number; reasoning: string;
      decision: "BUY" | "SHORT";
      siVelocity?: number | null; siDelta?: number;
      slippageBpsEst?: number | null }
  | { kind: "HOLD" | "BLOCKED"; reason: string };

type ScanMode = "all" | "exits" | "entries";

const MAX_ENTRY_TICKERS_PER_INVOCATION = 30;

function tickerShard(ticker: string, shards: number): number {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  return h % Math.max(1, shards);
}

// ============================================================================
// Helper: compute the 4 non-trailing peak signals (RSI div, climax, MACD roll,
// thesis done) — used by runner-mode exhaustion check. Returns trailing as a
// 5th signal based on the supplied trailing price.
// ============================================================================
function computePeakSignals(
  pos: Position, data: DataSet, currentPrice: number, trailing: number, rsi: number[],
): { fired: number; firedLabels: string[] } {
  const isLong = pos.position_type === "long";
  const n = data.close.length;
  const close = data.close, vol = data.volume;
  const trailingHit = isLong ? currentPrice <= trailing : currentPrice >= trailing;

  let rsiDivergence = false;
  if (n >= 6 && !isNaN(rsi[n - 1]) && !isNaN(rsi[n - 6])) {
    rsiDivergence = isLong
      ? close[n - 1] > close[n - 6] && rsi[n - 1] < rsi[n - 6] && rsi[n - 1] > 65
      : close[n - 1] < close[n - 6] && rsi[n - 1] > rsi[n - 6] && rsi[n - 1] < 35;
  }

  let climax = false;
  if (n >= 21) {
    let avgV = 0;
    for (let i = n - 21; i < n - 1; i++) avgV += vol[i];
    avgV /= 20;
    const hi = data.high[n - 1], lo = data.low[n - 1], cl = close[n - 1];
    const range = hi - lo;
    const closePos = range > 0 ? (cl - lo) / range : 0.5;
    const volSpike = vol[n - 1] > avgV * 1.8;
    climax = isLong ? volSpike && closePos < 0.35 : volSpike && closePos > 0.65;
  }

  let macdRoll = false;
  if (n >= 35) {
    const m = calculateMACD(close);
    const h = m.histogram;
    if (n >= 3) {
      macdRoll = isLong
        ? h[n - 1] > 0 && h[n - 1] < h[n - 2] && h[n - 2] < h[n - 3]
        : h[n - 1] < 0 && h[n - 1] > h[n - 2] && h[n - 2] > h[n - 3];
    }
  }

  // Thesis completion (lighter check — runner mode already gates on thesis)
  const lastRsi = safeGet(rsi, 50);
  const strat = pos.entry_strategy ?? "trend";
  let thesisDone = false;
  if (strat === "mean_reversion") thesisDone = lastRsi >= 48 && lastRsi <= 58;
  else if (strat === "breakout") {
    const entry = Number(pos.entry_price);
    thesisDone = isLong ? currentPrice < entry * 1.01 : currentPrice > entry * 0.99;
  }

  const signals = [trailingHit, rsiDivergence, climax, macdRoll, thesisDone];
  const labels = ["trailing-stop", "RSI divergence", "volume climax", "MACD rollover", "thesis complete"];
  return {
    fired: signals.filter(Boolean).length,
    firedLabels: labels.filter((_, i) => signals[i]),
  };
}

// ----------------------------------------------------------------------------
// H-7: Legacy-position fallbacks — synthesize hard stop / initial risk when
// `hard_stop_price` is missing (positions opened before R-ladder shipped, or
// rows where the column was nulled by a migration). Uses entry_atr with a
// strategy-aware multiplier; falls back to 5% notional risk as last resort.
// Keeps R-ladder, R-progress time-stop, and synthesized T1 stop live for
// every open position instead of silently disabling them.
// ----------------------------------------------------------------------------
function inferInitRiskPerShare(pos: Position): number {
  const entry = Number(pos.entry_price);
  if (pos.hard_stop_price != null) {
    const r = Math.abs(entry - Number(pos.hard_stop_price));
    if (isFinite(r) && r > 0) return r;
  }
  const atr = Number(pos.entry_atr ?? 0);
  if (isFinite(atr) && atr > 0) {
    const k = pos.entry_strategy === "mean_reversion" ? 1.5
            : pos.entry_strategy === "breakout" ? 1.75
            : 2.0;
    return atr * k;
  }
  return entry > 0 ? entry * 0.05 : 0;
}

function inferHardStopPrice(pos: Position): number | null {
  if (pos.hard_stop_price != null) return Number(pos.hard_stop_price);
  const entry = Number(pos.entry_price);
  const risk = inferInitRiskPerShare(pos);
  if (!isFinite(risk) || risk <= 0 || !isFinite(entry) || entry <= 0) return null;
  return pos.position_type === "long" ? entry - risk : entry + risk;
}

// ============================================================================
// WIN EXIT — peak detection (5 signals, 3-of-5 fires FULL_EXIT)
// Improvements over the basic ATR-trail:
//   • RSI bearish divergence (5-bar lookback)
//   • Volume climax + close-near-low candle
//   • MACD histogram rollover (2-bar decline)
//   • Strategy-aware thesis completion
//   • Peak detection only kicks in after +6% — below that, just hold/cut
//   • Runner mode: lets clean uptrends ride past the hard ceiling
// ============================================================================
function runWinExit(
  pos: Position, data: DataSet, currentPrice: number, profile: ProfileParams,
  liveWeeklyAlloc: number,
): ExitAction {
  const isLong = pos.position_type === "long";
  const entry = Number(pos.entry_price);
  const pnlPct = isLong ? (currentPrice - entry) / entry : (entry - currentPrice) / entry;

  // Peak update
  const oldPeak = pos.peak_price ?? entry;
  const newPeak = isLong ? Math.max(oldPeak, currentPrice) : Math.min(oldPeak, currentPrice);

  // Trailing-stop ratchet (Phase 2 #9 — Chandelier-style anchored to peak).
  // FAT-TAIL FIX: Because avg loss ($397) > avg win ($248), we MUST let
  // multi-R winners run further to maintain positive expectancy if win-rate
  // mean-reverts. Loosen post-rung trails: keep base ATR mult pre-rung,
  // 3.5×ATR after rung 1 (was 3.0), 3.0×ATR after rung 2 (was 2.5).
  const atr = pos.entry_atr ?? 0;
  let trailing = pos.trailing_stop_price ?? pos.hard_stop_price ?? (isLong ? entry * 0.95 : entry * 1.05);
  if (atr > 0) {
    const rungNow = pos.partial_exits_taken ?? 0;
    const trailMult = rungNow >= 2 ? 3.0
                    : rungNow >= 1 ? 3.5
                    : profile.trailingStopATRMult;
    const candidate = isLong
      ? newPeak - atr * trailMult
      : newPeak + atr * trailMult;
    trailing = isLong ? Math.max(trailing, candidate) : Math.min(trailing, candidate);
  }
  const trailingHit = isLong ? currentPrice <= trailing : currentPrice >= trailing;

  // ── Pre-rung breakeven trigger ─────────────────────────────────────────
  // FAT-TAIL FIX: before any partial scales out, once price has moved
  // `breakevenRungATR × ATR` in our favor, ratchet the trailing stop to entry.
  // This kills round-trips — a position that goes +1.5 ATR favorable can no
  // longer come back and hit the full hard stop, capping Avg Loss across the
  // distribution. Pure stop ratchet, no shares closed.
  {
    const rung = pos.partial_exits_taken ?? 0;
    if (rung === 0 && atr > 0 && profile.breakevenRungATR > 0) {
      const favorable = isLong ? currentPrice - entry : entry - currentPrice;
      const beTrigger = atr * profile.breakevenRungATR;
      if (favorable >= beTrigger) {
        const newTrail = isLong ? Math.max(trailing, entry) : Math.min(trailing, entry);
        if (newTrail !== trailing) trailing = newTrail;
      }
    }
  }

  // ── R-multiple partial-exit ladder (Phase 2 #7) ────────────────────────
  // Scale out `partialScaleOutPct` at +1R, then half of the remainder at +2R,
  // let runner/peak handle the rest. Tightens trailing to breakeven after
  // rung 1 fires (free trade). Initial risk per share = |entry − hard_stop_price|;
  // falls back to ATR-derived or 5% notional when hard_stop_price is missing (H-7).
  {
    const initRisk = inferInitRiskPerShare(pos);
    if (entry > 0 && initRisk > 0) {
      const rMult = (isLong ? currentPrice - entry : entry - currentPrice) / initRisk;
      const rung = pos.partial_exits_taken ?? 0;
      const rung1Pct = Math.min(0.75, Math.max(0.10, profile.partialScaleOutPct ?? (1 / 3)));
      if (rung === 0 && rMult >= 1.0) {
        // Rung 1: take `partialScaleOutPct`, ratchet trailing to breakeven (entry)
        const newTrail = isLong ? Math.max(trailing, entry) : Math.min(trailing, entry);
        return {
          kind: "PARTIAL_EXIT",
          reason: `R-ladder rung 1: +1R hit (${(pnlPct * 100).toFixed(1)}%), scale ${Math.round(rung1Pct * 100)}%, trail → breakeven`,
          pct: rung1Pct,
          price: currentPrice,
          nextRung: 1,
          trailingUpdate: newTrail,
        };
      }
      if (rung === 1 && rMult >= 2.0) {
        // Rung 2: take half of remaining, ratchet trailing to +1R (lock first R)
        const lockPx = isLong ? entry + initRisk : entry - initRisk;
        const newTrail = isLong ? Math.max(trailing, lockPx) : Math.min(trailing, lockPx);
        return {
          kind: "PARTIAL_EXIT",
          reason: `R-ladder rung 2: +2R hit (${(pnlPct * 100).toFixed(1)}%), trail → +1R locked`,
          pct: 0.5,
          price: currentPrice,
          nextRung: 2,
          trailingUpdate: newTrail,
        };
      }
    }
  }

  // ── Stale-sliver harvest ───────────────────────────────────────────────
  // ── Stale-sliver harvest (fully adaptive) ──────────────────────────────
  // After the R-ladder has trimmed a position (rung ≥ 1), the remaining
  // notional can become so small that further upside is dominated by noise
  // and there's no capital-efficient reason to keep the slot occupied.
  // Case in point (CSSI): after r1 + r2 partials the sliver was making
  // ~$5–6 total — not enough to justify the slot, not bad enough to stop
  // out. All three thresholds scale per-position:
  //   • notionalGate  — % of original notional considered "sliver". Bigger
  //     on high-ATR names (noise eats slivers faster), smaller on calm
  //     names where a small remainder can still compound cleanly. Also
  //     tightened for high-conviction runners (be more patient).
  //   • rFloor        — how many R of upside is still "worth waiting for".
  //     Scales with ATR% (noisy names need more R to matter) and rung
  //     depth (deeper rungs = thinner justification to hold).
  //   • absFloor      — hard $ floor as % of original notional, clamped to
  //     a sane band so tiny accounts don't hold $50 slivers and large
  //     accounts don't hold $2k slivers of a $50k original.
  {
    const rung = pos.partial_exits_taken ?? 0;
    if (rung >= 1 && pnlPct > 0) {
      const shares = Number(pos.shares) || 0;
      const originalShares = Number(pos.original_shares ?? shares) || shares;
      const remainingNotional = shares * currentPrice;
      const originalNotional = originalShares * entry;
      const initRisk = inferInitRiskPerShare(pos);
      const unrealizedDollars = (isLong ? currentPrice - entry : entry - currentPrice) * shares;

      // Adaptivity inputs
      const atrPct = atr > 0 && entry > 0 ? atr / entry : 0.02;        // 2% typical
      const atrScalar = Math.max(0.5, Math.min(2.0, atrPct / 0.02));   // 0.5×..2×
      const conv = Number(pos.entry_conviction ?? 70);
      const convScalar = Math.max(0.7, Math.min(1.2, 1 + (conv - 70) / 100));
      // higher conviction → shrink notionalGate (hold longer); low conv → widen
      const notionalGate = Math.max(
        0.20,
        Math.min(0.45, (0.30 * atrScalar) / convScalar),
      );
      // rung 1 → 0.5R base, rung 2 → 0.7R base (thinner sliver, needs more upside)
      const rBase = rung >= 2 ? 0.70 : 0.50;
      const rFloorMult = Math.max(0.30, Math.min(1.00, rBase * atrScalar));
      const rFloorDollars = initRisk > 0 ? rFloorMult * initRisk * shares : 0;
      // 5% of original notional, clamped $150..$1000
      const absFloor = Math.max(150, Math.min(1000, 0.05 * originalNotional));

      const trimmedToSliver = originalNotional > 0 && remainingNotional <= notionalGate * originalNotional;
      const noiseDominated = rFloorDollars > 0 && unrealizedDollars <= rFloorDollars;
      const belowAbsFloor = remainingNotional < absFloor;

      if (trimmedToSliver && (noiseDominated || belowAbsFloor)) {
        return {
          kind: "FULL_EXIT",
          reason: `Stale sliver harvest: $${remainingNotional.toFixed(0)} left after ${rung} partial${rung > 1 ? "s" : ""} (+${(pnlPct * 100).toFixed(1)}%, +$${unrealizedDollars.toFixed(0)}) — gate ${(notionalGate * 100).toFixed(0)}% / ${rFloorMult.toFixed(2)}R adaptive, freeing slot`,
          price: currentPrice,
        };
      }
    }
  }

  // Below a floor P&L we don't try to time a peak — hold or let loss-engine cut.
  // ADAPTIVE (Phase 1 sweep): the old fixed 6% floor fit ~2%-ATR names but
  // triggered too early on low-vol tickers (e.g. utilities at 0.8% ATR) and
  // too late on high-vol names (5% ATR crypto proxies). Formula: ~3× ATR%,
  // clamped to a sane [3%, 12%] range so we still guard against noise on both ends.
  const atrPctForPeak = atr > 0 && entry > 0 ? atr / entry : 0.02;
  const minProfitForPeak = Math.max(0.03, Math.min(0.12, atrPctForPeak * 3));
  if (pnlPct < minProfitForPeak) {
    return { kind: "HOLD", reason: `below peak-detection floor (${(minProfitForPeak * 100).toFixed(1)}%, atr-adaptive)`, trailingUpdate: trailing, peakUpdate: newPeak };
  }

  const n = data.close.length;
  const close = data.close, vol = data.volume;

  // ── Pre-compute indicators we need for both runner-mode + peak detection ──
  const rsi = calculateRSI(close, 14);
  const ema20 = calculateEMA(close, 20);
  const sma50 = calculateSMA(close, 50);
  const lastClose = close[n - 1];
  const lastEma20 = ema20[n - 1];
  const lastSma50 = sma50[n - 1];

  // ── RUNNER MODE — let big winners ride until the trend actually breaks ──
  // Activates only when the position is meaningfully profitable AND every
  // momentum/structure check still confirms the move. Suppresses the hard
  // ceiling and 3-of-5 peak rule; only a tighter trail, trend break, or
  // 4-of-5 exhaustion can release the runner.
  const ceilingPnl = profile.takeProfitPct / 100 * 1.5;
  const RUNNER_FLOOR = Math.max(ceilingPnl, 0.12);
  const strat = pos.entry_strategy ?? "trend";
  const isMR = strat === "mean_reversion";

  // Gate 1: profitable enough
  let runnerActive = pnlPct >= RUNNER_FLOOR && !isMR;

  // Gate 2: trend structure intact (close > 20-EMA > 50-SMA for long)
  if (runnerActive && Number.isFinite(lastEma20) && Number.isFinite(lastSma50)) {
    runnerActive = isLong
      ? lastClose > lastEma20 && lastEma20 > lastSma50
      : lastClose < lastEma20 && lastEma20 < lastSma50;
  } else {
    runnerActive = false;
  }

  // Gate 3: still near the peak (within 1.5 × ATR)
  if (runnerActive && atr > 0) {
    const distFromPeak = isLong ? newPeak - currentPrice : currentPrice - newPeak;
    runnerActive = distFromPeak <= atr * 1.5;
  }

  // Gate 4: no exhaustion — RSI not extreme + diverging
  if (runnerActive && n >= 6 && !isNaN(rsi[n - 1]) && !isNaN(rsi[n - 6])) {
    const extremeRsi = isLong ? rsi[n - 1] > 80 : rsi[n - 1] < 20;
    const diverging = isLong
      ? close[n - 1] > close[n - 6] && rsi[n - 1] < rsi[n - 6]
      : close[n - 1] < close[n - 6] && rsi[n - 1] > rsi[n - 6];
    if (extremeRsi && diverging) runnerActive = false;
  }

  // Gate 5: thesis still alive (strategy-aware)
  if (runnerActive) {
    if (strat === "trend") {
      const entryAlloc = pos.entry_weekly_alloc ?? 0;
      // Direction must still match — if entry was long-bias, live alloc must still be > 0
      if (entryAlloc !== 0 && Math.sign(liveWeeklyAlloc) !== Math.sign(entryAlloc)) {
        runnerActive = false;
      }
    } else if (strat === "breakout") {
      const breakout = isLong ? entry * 1.02 : entry * 0.98;
      runnerActive = isLong ? currentPrice > breakout : currentPrice < breakout;
    }
  }

  if (runnerActive) {
    // Tighter Chandelier-style trail while running
    const chandelier = isLong ? newPeak - 2.5 * atr : newPeak + 2.5 * atr;
    const runnerTrail = isLong ? Math.max(trailing, chandelier) : Math.min(trailing, chandelier);
    const runnerHit = isLong ? currentPrice <= runnerTrail : currentPrice >= runnerTrail;

    if (runnerHit) {
      return { kind: "FULL_EXIT", reason: `Runner trailing-stop hit (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
    }
    // Trend break — close lost the 50-SMA
    const trendBreak = isLong ? lastClose < lastSma50 : lastClose > lastSma50;
    if (trendBreak) {
      return { kind: "FULL_EXIT", reason: `Runner trend break (close lost 50-SMA, +${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
    }
    // 4-of-5 exhaustion check happens below after signals are computed.
    // Mark runner state and continue to compute peak signals.
    // (We re-enter the signal block below but with stricter exit threshold.)
    // Compute peak signals inline:
    const sigsR = computePeakSignals(pos, data, currentPrice, runnerTrail, rsi);
    if (sigsR.fired >= 4) {
      return { kind: "FULL_EXIT", reason: `Runner exhaustion (${sigsR.fired}/5: ${sigsR.firedLabels.join(" + ")}, +${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
    }
    return {
      kind: "HOLD",
      reason: `runner-mode (+${(pnlPct * 100).toFixed(1)}%, peak ${newPeak.toFixed(2)}, ${sigsR.fired}/5 sig)`,
      trailingUpdate: runnerTrail,
      peakUpdate: newPeak,
    };
  }

  // Hard ceiling: take-profit × 1.5 — always exits regardless of signals
  if (pnlPct >= ceilingPnl) {
    return { kind: "FULL_EXIT", reason: `Hard take-profit ceiling hit (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
  }


  // (n, close, vol already computed above for runner-mode)

  // SIGNAL 1: trailing hit
  // (already computed)

  // SIGNAL 2: RSI bearish divergence (long) / bullish divergence (short)
  let rsiDivergence = false;
  if (n >= 6 && !isNaN(rsi[n - 1]) && !isNaN(rsi[n - 6])) {
    if (isLong) {
      rsiDivergence = close[n - 1] > close[n - 6] && rsi[n - 1] < rsi[n - 6] && rsi[n - 1] > 65;
    } else {
      rsiDivergence = close[n - 1] < close[n - 6] && rsi[n - 1] > rsi[n - 6] && rsi[n - 1] < 35;
    }
  }

  // SIGNAL 3: Volume climax candle
  let climax = false;
  if (n >= 21) {
    let avgV = 0;
    for (let i = n - 21; i < n - 1; i++) avgV += vol[i];
    avgV /= 20;
    const hi = data.high[n - 1], lo = data.low[n - 1], cl = close[n - 1];
    const range = hi - lo;
    const closePos = range > 0 ? (cl - lo) / range : 0.5;
    const volSpike = vol[n - 1] > avgV * 1.8;
    climax = isLong
      ? volSpike && closePos < 0.35   // distribution on long
      : volSpike && closePos > 0.65;  // accumulation on short
  }

  // SIGNAL 4: MACD histogram rollover
  let macdRoll = false;
  if (n >= 35) {
    const m = calculateMACD(close);
    const h = m.histogram;
    if (n >= 3) {
      if (isLong) {
        macdRoll = h[n - 1] > 0 && h[n - 1] < h[n - 2] && h[n - 2] < h[n - 3];
      } else {
        macdRoll = h[n - 1] < 0 && h[n - 1] > h[n - 2] && h[n - 2] > h[n - 3];
      }
    }
  }

  // SIGNAL 5: Thesis completion (strategy-aware)
  let thesisDone = false;
  const lastRsi = safeGet(rsi, 50);
  if (strat === "mean_reversion") {
    thesisDone = lastRsi >= 48 && lastRsi <= 58;
  } else if (strat === "trend") {
    const entryAlloc = Math.abs(pos.entry_weekly_alloc ?? 1.0);
    const liveAbs = Math.abs(liveWeeklyAlloc);
    thesisDone = entryAlloc >= 0.75 && liveAbs <= entryAlloc - 0.5;
  } else if (strat === "breakout") {
    // Price returned inside breakout zone (within 1% of entry)
    thesisDone = isLong
      ? currentPrice < entry * 1.01
      : currentPrice > entry * 0.99;
  }

  const signals = [trailingHit, rsiDivergence, climax, macdRoll, thesisDone];
  const fired = signals.filter(Boolean).length;
  const labels = ["trailing-stop", "RSI divergence", "volume climax", "MACD rollover", "thesis complete"];
  const firedLabels = labels.filter((_, i) => signals[i]);

  if (fired >= 3) {
    return { kind: "FULL_EXIT", reason: `Peak detection: ${firedLabels.join(" + ")} (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
  }
  if (fired === 2 && pnlPct >= profile.takeProfitPct / 100 * 0.8) {
    return { kind: "PARTIAL_EXIT", reason: `Approaching target with ${fired} peak signals: ${firedLabels.join(" + ")}`, pct: 0.5, price: currentPrice };
  }
  return { kind: "HOLD", reason: `peak-watch (${fired}/5)`, trailingUpdate: trailing, peakUpdate: newPeak };
}

// ============================================================================
// LOSS EXIT — thesis invalidation (priority order)
// ============================================================================
function runLossExit(
  pos: Position, _data: DataSet, currentPrice: number, profile: ProfileParams,
  liveDecision: "BUY" | "SHORT" | "HOLD" | null,
  liveConviction: number,
  liveWeeklyBias: "long" | "short" | "flat" | null,
  liveRsi: number,
): ExitAction | null {
  const isLong = pos.position_type === "long";
  const entry = Number(pos.entry_price);
  const pnlPct = isLong ? (currentPrice - entry) / entry : (entry - currentPrice) / entry;

  // T1: Hard stop — non-negotiable. For legacy positions without an explicit
  // hard_stop_price, synthesize one from entry_atr (H-7) so the safety net
  // still fires.
  {
    const stopPx = inferHardStopPrice(pos);
    if (stopPx != null) {
      const hit = isLong ? currentPrice <= stopPx : currentPrice >= stopPx;
      if (hit) {
        const synth = pos.hard_stop_price == null ? " [synthesized]" : "";
        return { kind: "FULL_EXIT", reason: `Hard stop hit${synth} (${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
      }
    }
  }

  // T1.5: Intent flip — live engine fires the OPPOSITE side decision (Phase 2 #11).
  // Normally requires |pnl| > 0.5% to avoid round-trip churn, BUT a high-conviction
  // (≥75) opposite signal overrides that gate — at that quality the engine is
  // explicitly telling us the trade should reverse, and the round-trip cost is
  // small versus the expected loss from holding through the reversal.
  if (liveDecision) {
    const opposite =
      (isLong && liveDecision === "SHORT") ||
      (!isLong && liveDecision === "BUY");
    if (opposite) {
      const churnGateOk = Math.abs(pnlPct) > 0.005 || liveConviction >= 75;
      if (churnGateOk) {
        return {
          kind: "FULL_EXIT",
          reason: `Engine flipped to ${liveDecision} (intent reversal, conv ${liveConviction}, pnl ${(pnlPct * 100).toFixed(1)}%)`,
          price: currentPrice,
        };
      }
    }
  }

  // T2: Thesis invalidation (only when actually losing > 3%)
  if (pnlPct < -0.03) {
    if (liveWeeklyBias && ((isLong && liveWeeklyBias === "short") || (!isLong && liveWeeklyBias === "long"))) {
      return { kind: "FULL_EXIT", reason: `Weekly bias flipped to ${liveWeeklyBias} — thesis invalidated`, price: currentPrice };
    }
    // MR failure: held longer than max + RSI still extreme
    const barsHeld = businessDaysSince(pos.created_at);
    if (pos.entry_strategy === "mean_reversion" && barsHeld > profile.maxHoldMR && liveRsi < 40) {
      return { kind: "FULL_EXIT", reason: `Mean-reversion failed to materialize after ${barsHeld} bars`, price: currentPrice };
    }
    if (pos.entry_strategy === "breakout" && pos.breakout_failed_count >= 2) {
      return { kind: "FULL_EXIT", reason: `Breakout failed — price returned to range twice`, price: currentPrice };
    }
  }

  // T2.5: R-progress time stop (Phase 2 #8)
  // If half the strategy's max-hold has elapsed and the trade hasn't shown
  // ≥ 0.5R of unrealized progress, the thesis is stalling — cut early to
  // free capital for fresher setups. Uses initial risk = |entry − hard_stop|.
  const maxHold = pos.entry_strategy === "mean_reversion"
    ? profile.maxHoldMR
    : pos.entry_strategy === "breakout"
    ? profile.maxHoldBreakout
    : profile.maxHoldTrend;
  const barsHeld = businessDaysSince(pos.created_at);
  // T2.5: R-progress time stop (Phase 2 #8)
  // If half the strategy's max-hold has elapsed and the trade hasn't shown
  // ≥ 0.5R of unrealized progress, the thesis is stalling — cut early to
  // free capital for fresher setups. Uses initial risk derived from
  // hard_stop_price, ATR fallback, or 5% notional (H-7).
  // Only allow R-progress stall to exit if the trade is at/above breakeven —
  // never realize a red loss on a stall. The hard stop is the only path to red.
  if (entry > 0 && barsHeld >= Math.max(3, Math.floor(maxHold / 2)) && pnlPct >= 0) {
    const initRiskPerShare = inferInitRiskPerShare(pos);
    if (initRiskPerShare > 0) {
      const progressR = (isLong ? currentPrice - entry : entry - currentPrice) / initRiskPerShare;
      if (progressR < 0.5) {
        return {
          kind: "FULL_EXIT",
          reason: `R-progress stall at breakeven+: only ${progressR.toFixed(2)}R after ${barsHeld}/${maxHold} bars`,
          price: currentPrice,
        };
      }
    }
  }

  // T3: Time stop — only fire on green. On red, hold and let the hard stop
  // (or a recovery) decide the exit. No "dead capital" sells at a loss.
  if (barsHeld >= maxHold) {
    if (pnlPct > 0) {
      return {
        kind: "FULL_EXIT",
        reason: `Time stop — taking the profit (+${(pnlPct * 100).toFixed(1)}%)`,
        price: currentPrice,
      };
    }
    // Red at time stop: do nothing. Hard stop remains the only red exit.
  }

  return null; // no loss-exit triggered
}

function businessDaysSince(iso: string): number {
  // H-1 FIX: walk day-by-day, skipping weekends AND NYSE holidays.
  // Previously used calendar-days × 5/7 which ignored holidays entirely,
  // so R-progress stall and time-stop fired ~1–2 days late around holiday weeks.
  const start = new Date(iso);
  if (!Number.isFinite(start.getTime())) return 1;
  const today = new Date();
  // Normalize both to UTC midnight to avoid DST drift in the loop.
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let count = 0;
  // Cap at 1 year of bars in case of bad input — defensive only.
  for (let i = 0; i < 400 && day < end; i++) {
    day.setUTCDate(day.getUTCDate() + 1);
    const wd = day.getUTCDay(); // 0=Sun, 6=Sat
    if (wd === 0 || wd === 6) continue;
    if (isMarketHoliday(day)) continue;
    count++;
  }
  return Math.max(1, count);
}

// ============================================================================
// ENTRY DECISION
// ============================================================================
function bucketKeyAT(c: number): string {
  if (c < 60) return "lt60";
  if (c < 70) return "60-69";
  if (c < 80) return "70-79";
  if (c < 90) return "80-89";
  return "90+";
}

async function runEntryDecision(
  ticker: string,
  data: DataSet,
  macro: MacroContext | null,
  settings: Settings,
  openCount: number,
  totalNavExposurePct: number,
  todayPnlPct: number,
  openTickers: string[],
  volScalar: number,
  calibrationCurve: Record<string, { adjust: number }>,
  strategyTilts: Record<string, { multiplier: number }>,
  tickerCalibration: Record<string, { adjust: number }>,
  danelfinMap?: Map<string, number>,
  epsRevisionMap?: Map<string, number>,
  /** C-3 FIX: dynamic NAV (starting_nav + cumulative realized PnL +
   *  unrealized today). Previously we sized off `settings.starting_nav`
   *  which is static — after a 20% drawdown the engine sized 25% TOO
   *  LARGE relative to actual equity. */
  currentNav?: number,
  marketRegime?: string | null,
  metaModel?: MetaLabelModel | null,
  strategyEdges?: Record<string, { winRate: number; avgWin: number; avgLoss: number; sampleSize: number }>,
  shortInterestMap?: Map<string, ShortInterestRow>,
  metaGate?: { pass: number; skip: number },
): Promise<EntryAction> {
  // Daily loss limit — block all new entries
  if (todayPnlPct <= -settings.daily_loss_limit_pct) {
    return { kind: "BLOCKED", reason: `Daily loss limit (${todayPnlPct.toFixed(1)}% vs −${settings.daily_loss_limit_pct}% cap)` };
  }
  // Rolling 30-day drawdown circuit breaker (Phase 3 #16) — applies even
  // when adaptive_mode is off, so manual users still get crash protection.
  if (settings.current_drawdown_pct >= ROLLING_DD_HARD_BLOCK_PCT) {
    return {
      kind: "BLOCKED",
      reason: `Rolling drawdown circuit breaker: 30d NAV dd ${settings.current_drawdown_pct.toFixed(1)}% ≥ ${ROLLING_DD_HARD_BLOCK_PCT}% — entries paused`,
    };
  }
  // CDaR_0.95 circuit breaker (idea #13) — also runs in non-adaptive mode.
  // Catches sustained slow bleeds where the peak-to-current snapshot is mild
  // but the *average* worst-tail drawdown across the window is severe.
  if (settings.current_cdar_pct >= CDAR_HARD_BLOCK_PCT) {
    return {
      kind: "BLOCKED",
      reason: `CDaR circuit breaker: 30d CDaR_0.95 ${settings.current_cdar_pct.toFixed(1)}% ≥ ${CDAR_HARD_BLOCK_PCT}% — entries paused`,
    };
  }
  if (openCount >= settings.max_positions) {
    return { kind: "BLOCKED", reason: `Max positions reached (${openCount}/${settings.max_positions})` };
  }
  if (totalNavExposurePct >= settings.max_nav_exposure_pct) {
    return { kind: "BLOCKED", reason: `NAV exposure cap reached (${totalNavExposurePct.toFixed(0)}% / ${settings.max_nav_exposure_pct}%)` };
  }

  // ── Correlation gate (improvement #4) ───────────────────────────────────
  // Skip if 60-day return correlation with any existing book position exceeds
  // 0.75 in absolute value. Cuts factor-blowup risk (e.g. all big-cap tech
  // crashing together) without forcing the user to enforce sector caps manually.
  if (openTickers.length > 0) {
    const corr = maxCorrelationToBook(ticker, openTickers);
    const corrCutoff = adaptiveCorrThreshold(marketRegime, macro?.stressed ? "elevated" : "normal");
    if (corr && corr.maxAbs >= corrCutoff) {
      return {
        kind: "BLOCKED",
        reason: `Correlation gate: |ρ|=${corr.maxAbs.toFixed(2)} vs ${corr.against} ≥ ${corrCutoff.toFixed(2)} (regime-adaptive) over ${CORR_LOOKBACK_BARS}d`,
      };
    }
  }

  // ── Earnings blackout (Phase 1 #4) ──────────────────────────────────────
  // Block new entries within 3 trading days of an earnings release. Earnings
  // gaps routinely violate ATR-based stops and our signal engine has no edge
  // through binary fundamental events. Cached 6h via Finnhub free tier.
  // Crypto / non-equity tickers return null and pass through.
  try {
    const days = await getEarningsBlackoutDays(ticker);
    if (days !== null && days <= 3) {
      return {
        kind: "BLOCKED",
        reason: `Earnings blackout: report in ~${days} trading day${days === 1 ? "" : "s"} — gap risk too high for systematic entry`,
      };
    }
  } catch (_e) { /* non-fatal — never block scan on earnings API hiccup */ }

  const danelfin = danelfinMap?.get(ticker.toUpperCase()) ?? null;
  const epsRev = epsRevisionMap?.get(ticker.toUpperCase()) ?? null;
  // Pre-evaluate without realized edge so we can fetch the right strategy bucket.
  const peek = evaluateSignal(data, ticker, undefined, macro, undefined, undefined, danelfin, epsRev, marketRegime);
  const edge = peek?.strategy ? strategyEdges?.[peek.strategy] : undefined;
  const sig = evaluateSignal(data, ticker, undefined, macro, undefined, undefined, danelfin, epsRev, marketRegime, edge ?? null);
  if (!sig) return { kind: "HOLD", reason: "Insufficient data" };
  if (sig.decision === "HOLD") return { kind: "HOLD", reason: sig.reasoning };

  // ── Short-interest velocity overlay (supporting factor, NEVER a gate) ──
  // Applied AFTER the engine returns so the backtest stays deterministic.
  // Persisted via si_velocity column for closed-loop calibration.
  let siDelta = 0;
  let siVelocity: number | null = null;
  const siRow = shortInterestMap?.get(ticker.toUpperCase()) ?? null;
  if (siRow) {
    const side: "long" | "short" = sig.decision === "BUY" ? "long" : "short";
    siDelta = shortInterestConvictionDelta(siRow, side, sig.strategy);
    siVelocity = siRow.velocity30d;
    if (siDelta !== 0) {
      sig.conviction = Math.max(0, Math.min(100, sig.conviction + siDelta));
    }
  }

  // ── Honest conviction calibration (Phase 1 #5) ──────────────────────────
  // Apply the same nightly-learned adjustments the scanner uses so the
  // autotrader's min_conviction gate compares apples-to-apples. Order:
  // strategy tilt × → bucket adjust + → per-ticker adjust +. Clamped 0..100.
  let conviction = sig.conviction;
  const tiltMult = strategyTilts[sig.strategy]?.multiplier ?? 1.0;
  conviction = conviction * tiltMult;
  const isoAnchors = (calibrationCurve as any)?.__isotonic as IsotonicAnchor[] | undefined;
  if (isoAnchors && isoAnchors.length >= 3) {
    conviction = applyIsotonicCalibration(conviction, isoAnchors);
  } else {
    const bucketAdj = calibrationCurve[bucketKeyAT(conviction)]?.adjust ?? 0;
    conviction = conviction + bucketAdj;
  }
  const tickAdj = tickerCalibration[ticker.toUpperCase()]?.adjust ?? 0;
  conviction = Math.max(0, Math.min(100, Math.round(conviction + tickAdj)));

  if (conviction < settings.min_conviction) {
    return { kind: "HOLD", reason: `Calibrated conviction ${conviction} (raw ${sig.conviction}) < min ${settings.min_conviction}` };
  }

  // ── Meta-label gate (cold-start safe — null model passes through).
  // Audit fix: runs AFTER calibration so the conviction feature matches the
  // value the trainer sees in `signal_outcomes.conviction` (also calibrated).
  // Thresholds tighten under detected drift (see ADWIN pre-scan pass).
  const gate = metaGate ?? { pass: 0.45, skip: 0.30 };
  const metaScore = scoreMetaLabel(metaModel ?? null, {
    conviction,
    atrPct: sig.atrPct,
    relStrength: 0,
    sectorMomentum: 0,
    epsRevisionScore: sig.epsRevisionScore ?? 0,
    regime: sig.marketRegime ?? marketRegime ?? null,
    hourOfDay: (new Date().getUTCHours() + 19) % 24,
    dayOfWeek: new Date().getUTCDay(),
  });
  if (metaScore !== null && Number.isFinite(metaScore)) {
    if (metaScore < gate.skip) {
      return { kind: "HOLD", reason: `Meta-label skip: score=${metaScore.toFixed(3)} < ${gate.skip.toFixed(2)}` };
    }
    if (metaScore < gate.pass && conviction < 80) {
      return { kind: "HOLD", reason: `Meta-label demote: score=${metaScore.toFixed(3)} < ${gate.pass.toFixed(2)} (conv ${conviction} < 80) — consensus-only` };
    }
  }

  const effectiveConviction = conviction;

  // Size — apply portfolio-level vol-target scalar (improvement #7) BEFORE
  // single-name and headroom caps so the user-facing caps remain absolute
  // ceilings while sizing breathes with realized SPY vol.
  const headroom = (settings.max_nav_exposure_pct - totalNavExposurePct) / 100;
  const baseFrac = sig.kellyFraction * volScalar;
  let cappedFrac = Math.min(baseFrac, settings.max_single_name_pct / 100, headroom);
  const currentPrice = data.close[data.close.length - 1];
  // C-3 FIX: size off dynamic NAV when caller provides it; fall back to
  // starting_nav only for legacy paths that haven't been updated yet.
  const navForSizing = Number.isFinite(currentNav) && (currentNav as number) > 0
    ? (currentNav as number)
    : settings.starting_nav;
  let targetDollars = navForSizing * cappedFrac;

  // ── Almgren–Chriss slippage shrink ─────────────────────────────────────
  // Estimate ADV from last 20 bars (close × volume), compute expected impact,
  // shrink the order if impact would consume > 30% of expected edge.
  let slippageBpsEst: number | null = null;
  if (data.volume && data.volume.length >= 20 && targetDollars > 0) {
    const n = data.close.length;
    let advDollars = 0;
    for (let i = n - 20; i < n; i++) {
      advDollars += data.close[i] * data.volume[i];
    }
    advDollars /= 20;
    if (Number.isFinite(advDollars) && advDollars > 0) {
      const shrink = slippageShrinkFactor(targetDollars, advDollars, sig.atrPct, 2, 0.30);
      slippageBpsEst = shrink.bps;
      if (shrink.factor < 1) {
        cappedFrac = cappedFrac * shrink.factor;
        targetDollars = navForSizing * cappedFrac;
      }
    }
  }

  if (targetDollars < currentPrice) {
    return { kind: "HOLD", reason: "Position too small after caps" };
  }


  // Hard stop at entry — STRUCTURAL + ADAPTIVE (Phase 2 #10)
  // Pure-ATR stops fire on noise. We anchor the stop to actual market
  // structure: the more conservative (tighter) of swing-low / EMA20 buffer,
  // then clamp the resulting risk into [0.8·ATR, hardStopATRMult·ATR] so
  // we neither stop on a tick nor blow our risk budget. Stop distance stays
  // fully adaptive to volatility — fat-tail control is enforced via
  // risk-parity sizing below, NOT a constant % cap.
  const profile = PROFILE_PARAMS[sig.profile];
  const params = sig.blendedParams ?? profile;
  const atr = sig.atr;
  const isLong = sig.decision === "BUY";
  const atrStopDist = atr * params.hardStopATRMult;
  const minDist = atr * 0.8;
  let stopDist = atrStopDist;
  if (atr > 0 && data.close.length >= 22) {
    const lookback = 10;
    const n = data.close.length;
    let swing = isLong ? Infinity : -Infinity;
    for (let i = n - 1 - lookback; i < n - 1; i++) {
      if (i < 0) continue;
      swing = isLong ? Math.min(swing, data.low[i]) : Math.max(swing, data.high[i]);
    }
    const ema20Arr = calculateEMA(data.close, 20);
    const lastEma20 = ema20Arr[n - 1];
    const emaAnchor = Number.isFinite(lastEma20)
      ? (isLong ? lastEma20 - 0.25 * atr : lastEma20 + 0.25 * atr)
      : (isLong ? -Infinity : Infinity);
    // Structural anchor = tighter of swing/EMA (closer to entry)
    const structAnchor = isLong ? Math.max(swing, emaAnchor) : Math.min(swing, emaAnchor);
    const structDist = isLong ? currentPrice - structAnchor : structAnchor - currentPrice;
    if (Number.isFinite(structDist) && structDist > 0) {
      stopDist = Math.min(atrStopDist, Math.max(minDist, structDist));
    }
  }
  const hardStop = isLong ? currentPrice - stopDist : currentPrice + stopDist;

  // ── FAT-TAIL GUARD: Risk-parity sizing (ADAPTIVE — Phase 1 sweep) ─────
  // Cap dollar risk per trade at a regime-adjusted % of NAV. Base window is
  // 0.30% → 0.60% (min-conv → 95+ conv). We tighten in stress (bear_volatile
  // or crisis VIX → 0.20% → 0.45%) and loosen modestly in bull_quiet
  // (0.35% → 0.70%). Conviction still scales linearly within the window so
  // higher-quality setups get more risk budget, but the window itself moves
  // with the tape instead of being a hard-coded pair.
  const _vixReg = (macro?.stressed ? "elevated" : "normal") as "calm"|"normal"|"elevated"|"crisis";
  let minRiskPct = 0.0030, maxRiskPct = 0.0060;
  if (marketRegime === "bear_volatile" || _vixReg === "crisis") { minRiskPct = 0.0020; maxRiskPct = 0.0045; }
  else if (marketRegime === "bear_quiet" || marketRegime === "bull_volatile" || _vixReg === "elevated") { minRiskPct = 0.0025; maxRiskPct = 0.0055; }
  else if (marketRegime === "bull_quiet" && _vixReg === "calm") { minRiskPct = 0.0035; maxRiskPct = 0.0070; }
  const convBlend = Math.max(0, Math.min(1,
    (effectiveConviction - settings.min_conviction) / Math.max(1, 95 - settings.min_conviction)
  ));
  const riskPct = minRiskPct + (maxRiskPct - minRiskPct) * convBlend;
  const riskBudgetDollars = navForSizing * riskPct;
  if (stopDist > 0) {
    const maxSharesByRisk = riskBudgetDollars / stopDist;
    const maxDollarsByRisk = maxSharesByRisk * currentPrice;
    if (targetDollars > maxDollarsByRisk) {
      const shrinkFactor = maxDollarsByRisk / targetDollars;
      cappedFrac = cappedFrac * shrinkFactor;
      targetDollars = maxDollarsByRisk;
    }
  }
  if (targetDollars < currentPrice) {
    return { kind: "HOLD", reason: `Stop too wide for risk budget — would size below 1 share at ${(riskPct * 100).toFixed(2)}% NAV cap` };
  }

  const reasoningExtra: string[] = [];
  if (siDelta !== 0) reasoningExtra.push(`siΔ=${siDelta > 0 ? "+" : ""}${siDelta}`);
  if (slippageBpsEst !== null && slippageBpsEst > 0) reasoningExtra.push(`slip=${slippageBpsEst.toFixed(1)}bps`);
  const reasoning = reasoningExtra.length > 0
    ? `${sig.reasoning} | ${reasoningExtra.join(" | ")}`
    : sig.reasoning;

  return {
    kind: "ENTER",
    conviction: effectiveConviction,
    kellyFraction: cappedFrac,
    price: currentPrice,
    strategy: sig.strategy,
    profile: sig.profile,
    atr,
    hardStop,
    weeklyAlloc: sig.weeklyBias.targetAllocation,
    decision: sig.decision === "SHORT" ? "SHORT" : "BUY",
    reasoning,
    siVelocity,
    siDelta,
    slippageBpsEst,
  };
}

// ============================================================================
// ADD-ON & RE-ENTRY ENGINE — "buy more" on winners + re-buy R1/R2 partials
// ============================================================================
// Both paths reuse evaluateSignal + all live gates (meta-label, correlation,
// heat cap, earnings blackout, market regime). Never widens the hard stop;
// trailing stop rebases off the new weighted-average entry.
// Everything scales with conviction/ATR/regime — no hard-coded caps.
// ============================================================================

type AddOnAction =
  | { kind: "ADD_ON" | "RE_ENTRY"; conviction: number; price: number; addDollars: number;
      strategy: string; profile: StockProfile; atr: number; reasoning: string; addScale: number }
  | { kind: "SKIP"; reason: string }
  | { kind: "BLOCKED"; reason: string };

/** Adaptive add-on cap: higher conviction → allow more scale-ins. */
function maxAddsForConviction(c: number): number {
  return Math.max(0, Math.round(c / 30) - 1); // 60→1, 90→2, 100→2
}

/** Adaptive cooldown between add-ons in ms — calmer stocks unlock faster. */
function addOnCooldownMs(atrPct: number): number {
  const bars = Math.max(1, Math.ceil(atrPct * 100)); // 1..10 bars
  return bars * 6.5 * 3600 * 1000; // 6.5h ≈ one RTH session
}

async function evaluateAddOnCandidate(
  ticker: string,
  data: DataSet,
  pos: Position,
  macro: MacroContext | null,
  settings: Settings,
  danelfinMap: Map<string, number> | undefined,
  epsRevisionMap: Map<string, number> | undefined,
  marketRegime: string | null | undefined,
  metaModel: MetaLabelModel | null | undefined,
  strategyEdges: Record<string, { winRate: number; avgWin: number; avgLoss: number; sampleSize: number }> | undefined,
  metaGate: { pass: number; skip: number } | undefined,
  calibrationCurve: Record<string, { adjust: number }>,
  strategyTilts: Record<string, { multiplier: number }>,
  tickerCalibration: Record<string, { adjust: number }>,
  openTickers: string[],
  mode: "ADD_ON" | "RE_ENTRY",
): Promise<AddOnAction> {
  // Emergency / drawdown / daily loss shortcuts inherited from parent flow
  if (settings.current_drawdown_pct >= ROLLING_DD_HARD_BLOCK_PCT) {
    return { kind: "BLOCKED", reason: `Add-on blocked: rolling DD ${settings.current_drawdown_pct.toFixed(1)}%` };
  }
  if (settings.current_cdar_pct >= CDAR_HARD_BLOCK_PCT) {
    return { kind: "BLOCKED", reason: `Add-on blocked: CDaR ${settings.current_cdar_pct.toFixed(1)}%` };
  }

  // Earnings blackout — same rule as fresh entries
  try {
    const d = await getEarningsBlackoutDays(ticker);
    if (d !== null && d <= 3) return { kind: "SKIP", reason: `Earnings in ~${d}d — no add-on` };
  } catch (_e) { /* non-fatal */ }

  const danelfin = danelfinMap?.get(ticker.toUpperCase()) ?? null;
  const epsRev = epsRevisionMap?.get(ticker.toUpperCase()) ?? null;
  const peek = evaluateSignal(data, ticker, undefined, macro, undefined, undefined, danelfin, epsRev, marketRegime);
  const edge = peek?.strategy ? strategyEdges?.[peek.strategy] : undefined;
  const sig = evaluateSignal(data, ticker, undefined, macro, undefined, undefined, danelfin, epsRev, marketRegime, edge ?? null);
  if (!sig) return { kind: "SKIP", reason: "Insufficient data" };
  if (sig.decision === "HOLD") return { kind: "SKIP", reason: "Signal HOLD" };

  const posSide: "BUY" | "SHORT" = pos.position_type === "long" ? "BUY" : "SHORT";
  if (sig.decision !== posSide) return { kind: "SKIP", reason: `Fresh signal ${sig.decision} opposes open ${posSide}` };

  // Calibrate conviction (identical stacking to runEntryDecision)
  let conviction = sig.conviction * (strategyTilts[sig.strategy]?.multiplier ?? 1.0);
  const iso = (calibrationCurve as any)?.__isotonic as IsotonicAnchor[] | undefined;
  if (iso && iso.length >= 3) conviction = applyIsotonicCalibration(conviction, iso);
  else conviction = conviction + (calibrationCurve[bucketKeyAT(conviction)]?.adjust ?? 0);
  conviction = Math.max(0, Math.min(100, Math.round(
    conviction + (tickerCalibration[ticker.toUpperCase()]?.adjust ?? 0)
  )));

  // Meta-label gate
  const gate = metaGate ?? { pass: 0.45, skip: 0.30 };
  const metaScore = scoreMetaLabel(metaModel ?? null, {
    conviction, atrPct: sig.atrPct, relStrength: 0, sectorMomentum: 0,
    epsRevisionScore: sig.epsRevisionScore ?? 0,
    regime: sig.marketRegime ?? marketRegime ?? null,
    hourOfDay: (new Date().getUTCHours() + 19) % 24,
    dayOfWeek: new Date().getUTCDay(),
  });
  if (metaScore !== null && Number.isFinite(metaScore) && metaScore < gate.skip) {
    return { kind: "SKIP", reason: `Meta-label skip (${metaScore.toFixed(3)})` };
  }

  // Conviction floors — add-ons need a real upgrade, re-entries slightly relaxed
  const baseFloor = Math.max(settings.min_conviction, mode === "ADD_ON" ? 78 : settings.min_conviction + 3);
  if (conviction < baseFloor) {
    return { kind: "SKIP", reason: `Conviction ${conviction} < add floor ${baseFloor}` };
  }

  // Correlation gate — still applies (adds to concentration risk)
  const others = openTickers.filter(t => t !== ticker.toUpperCase());
  if (others.length > 0) {
    const corr = maxCorrelationToBook(ticker, others);
    const corrCutoff = adaptiveCorrThreshold(marketRegime, macro?.stressed ? "elevated" : "normal");
    if (corr && corr.maxAbs >= corrCutoff) {
      return { kind: "SKIP", reason: `Corr ${corr.maxAbs.toFixed(2)} vs ${corr.against} ≥ ${corrCutoff.toFixed(2)}` };
    }
  }

  const currentPrice = data.close[data.close.length - 1];
  const entry = Number(pos.entry_price);
  const isLong = pos.position_type === "long";

  if (mode === "ADD_ON") {
    // Only add to winners
    const pnlPct = isLong ? (currentPrice - entry) / entry : (entry - currentPrice) / entry;
    if (pnlPct <= 0) return { kind: "SKIP", reason: "Not in profit — no pyramid" };

    const addCount = Number(pos.add_on_count ?? 0);
    const maxAdds = maxAddsForConviction(conviction);
    if (addCount >= maxAdds) return { kind: "SKIP", reason: `Add cap reached (${addCount}/${maxAdds})` };

    // Cooldown
    if (pos.last_add_on_at) {
      const since = Date.now() - new Date(pos.last_add_on_at).getTime();
      const need = addOnCooldownMs(sig.atrPct);
      if (since < need) {
        return { kind: "SKIP", reason: `Add cooldown ${Math.round((need - since) / 3600000)}h remaining` };
      }
    }
  } else {
    // RE_ENTRY: adaptive price gate off VWAP of trims
    const trimPx = Number(pos.partial_trim_price ?? 0);
    if (trimPx <= 0) return { kind: "SKIP", reason: "No trim reference price" };
    const dipTarget = trimPx * (1 - 0.5 * sig.atrPct);
    const premiumOk = currentPrice <= trimPx * (1 + 0.25 * sig.atrPct) && conviction >= 80;
    const dipOk = isLong ? currentPrice <= dipTarget : currentPrice >= dipTarget;
    // For shorts we mirror: dip = higher price, premium = lower price
    if (!(dipOk || premiumOk)) {
      return { kind: "SKIP", reason: `Re-entry price gate: px ${currentPrice.toFixed(2)} vs trim ${trimPx.toFixed(2)}` };
    }
  }

  // Sizing: adaptive to conviction & realized edge. Base = original notional.
  const originalShares = Number(pos.original_shares ?? pos.shares ?? 0);
  const baseDollars = originalShares > 0 ? originalShares * currentPrice : Number(pos.shares) * currentPrice;
  const addScale = Math.max(0.25, Math.min(1.5, (conviction - 60) / 40));
  let addDollars = baseDollars * addScale;

  if (mode === "RE_ENTRY") {
    // Never re-buy more than what was trimmed (in notional at current px)
    const trimShares = Number(pos.partial_trim_shares ?? 0);
    const trimNotional = trimShares * currentPrice;
    if (trimNotional > 0) addDollars = Math.min(addDollars, trimNotional);
  }
  if (addDollars < currentPrice) return { kind: "SKIP", reason: "Add too small (< 1 share)" };

  return {
    kind: mode,
    conviction, price: currentPrice, addDollars,
    strategy: sig.strategy, profile: sig.profile, atr: sig.atr,
    addScale,
    reasoning: `${mode === "ADD_ON" ? "Pyramid" : "Re-entry"} scale ${addScale.toFixed(2)}× | ${sig.reasoning}`,
  };
}

/** Execute an approved add-on / re-entry: merges shares into the open row
 *  with weighted-avg entry, rebases trailing stop, NEVER widens hard stop. */
async function executeAddOn(
  supabase: any,
  pos: Position,
  action: Extract<AddOnAction, { kind: "ADD_ON" | "RE_ENTRY" }>,
  settings: Settings,
): Promise<boolean> {
  if (!isMarketOpen()) return false;
  const live = await fetchLiveQuote(pos.ticker);
  if (!live) return false;
  const fillPrice = live.price;
  const addShares = Math.floor(action.addDollars / fillPrice);
  if (addShares < 1) return false;

  const currentShares = Number(pos.shares);
  const currentEntry = Number(pos.entry_price);
  const newShares = currentShares + addShares;
  const newEntry = (currentEntry * currentShares + fillPrice * addShares) / newShares;

  // Trailing stop rebases off weighted entry but is NEVER widened
  const isLong = pos.position_type === "long";
  const trail = pos.trailing_stop_price ?? pos.hard_stop_price ?? currentEntry;
  const structRail = isLong ? Math.max(trail, newEntry * 0.95) : Math.min(trail, newEntry * 1.05);
  const nextTrail = isLong ? Math.max(trail, structRail) : Math.min(trail, structRail);

  const updates: Record<string, unknown> = {
    shares: newShares,
    entry_price: newEntry,
    trailing_stop_price: nextTrail,
    add_on_count: Number(pos.add_on_count ?? 0) + 1,
    last_add_on_at: new Date().toISOString(),
  };
  if (action.kind === "RE_ENTRY") {
    const trimShares = Number(pos.partial_trim_shares ?? 0);
    const remainingTrim = Math.max(0, trimShares - addShares);
    updates.partial_trim_shares = remainingTrim;
    if (remainingTrim === 0) {
      updates.partial_trim_price = null;
      updates.reentry_deadline = null;
    }
  }

  const { error } = await supabase.from("virtual_positions").update(updates).eq("id", pos.id);
  if (error) { console.error("add-on update failed", error); return false; }

  await supabase.from("autotrade_log").insert({
    user_id: settings.user_id, ticker: pos.ticker, action: action.kind,
    reason: `${action.reasoning} | fill $${fillPrice.toFixed(2)} × ${addShares} sh → new avg $${newEntry.toFixed(2)}`,
    price: fillPrice, shares: addShares,
    conviction: action.conviction, strategy: action.strategy, profile: action.profile,
    position_id: pos.id,
  });
  return true;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { requireCronOrUser } = await import("../_shared/cron-auth.ts");
  const denied = await requireCronOrUser(req);
  if (denied) return denied;

  const startedAt = Date.now();
  const body = await req.json().catch(() => ({}));
  const scanMode: ScanMode = body?.mode === "exits"
    ? "exits"
    : body?.mode === "entries"
    ? "entries"
    : "all";
  const entryShardCount = Math.max(1, Math.min(12, Number(body?.shards ?? 1) || 1));
  const entryShard = Math.max(0, Math.min(entryShardCount - 1, Number(body?.shard ?? 0) || 0));
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary = { users: 0, entries: 0, exits: 0, partials: 0, holds: 0, blocked: 0, errors: 0 };

  try {
    // 1. Load all autotrade_settings rows. We process every user that has either
    //    autotrader enabled (entries+exits) OR any open virtual_position (exits only,
    //    so manual buys also benefit from the autotrader's exit brain).
    const { data: allSettings, error: sErr } = await supabase
      .from("autotrade_settings")
      .select("*");
    if (sErr) throw sErr;

    // Find users with open positions (manual or otherwise)
    const { data: openPosUsers } = await supabase
      .from("virtual_positions")
      .select("user_id")
      .eq("status", "open");
    const userIdsWithOpen = new Set((openPosUsers ?? []).map((r: any) => r.user_id));

    // Tier gate: AutoTrader requires Elite. Filter out non-Elite users.
    const candidateUserIds = (allSettings ?? []).map((s: any) => s.user_id);
    let eliteUserIds = new Set<string>();
    if (candidateUserIds.length > 0) {
      const { data: tierRows } = await supabase
        .from("profiles")
        .select("user_id, subscription_tier")
        .in("user_id", candidateUserIds);
      eliteUserIds = new Set(
        (tierRows ?? [])
          .filter((r: any) => r.subscription_tier === "elite")
          .map((r: any) => r.user_id),
      );
    }

    const settingsRows = (allSettings ?? []).filter((s: any) =>
      eliteUserIds.has(s.user_id) && (s.enabled === true || userIdsWithOpen.has(s.user_id))
    );

    if (!settingsRows || settingsRows.length === 0) {
      await recordHeartbeat("autotrader-scan", startedAt, "ok", "no-active-users");
      return json({ status: "no-active-users", summary });
    }
    summary.users = settingsRows.length;

    // 2. Pre-fetch SPY + VIX + active calibration weights (shared across users)
    const [spy, vixData, weightsRes] = await Promise.all([
      fetchYahooData("SPY"),
      fetchYahooData("^VIX"),
      supabase.from("strategy_weights")
        .select("regime_floors, exit_calibration, calibration_curve, strategy_tilts, ticker_calibration")
        .eq("is_active", true)
        .order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const macro: MacroContext | null = spy ? { spyClose: spy.close } : null;
    const vixValue: number | null = vixData && vixData.close.length > 0
      ? vixData.close[vixData.close.length - 1]
      : null;
    const vixRegime = vixRegimeOf(vixValue);
    const spyTrend = spyTrendOf(macro);
    const { scalar: volScalar, spyVol, spyVolFast } = volTargetScalar(macro);
    if (spyVol != null) {
      const fastStr = spyVolFast != null ? ` (20d=${(spyVolFast*100).toFixed(1)}%)` : "";
      console.log(`[autotrader-scan] vol-target: SPY ${VOL_LOOKBACK}d realized vol=${(spyVol*100).toFixed(1)}%${fastStr} → sizing scalar ${volScalar.toFixed(2)}`);
    }
    const regimeFloors = (weightsRes.data?.regime_floors as Record<string, number> | null) ?? null;
    const exitCalibration = (weightsRes.data?.exit_calibration as Record<string, { trailMultAdjust: number }> | null) ?? null;
    const calibrationCurve = (weightsRes.data?.calibration_curve as Record<string, { adjust: number }> | null) ?? {};
    const strategyTilts = (weightsRes.data?.strategy_tilts as Record<string, { multiplier: number }> | null) ?? {};
    const tickerCalibration = (weightsRes.data?.ticker_calibration as Record<string, { adjust: number }> | null) ?? {};

    if (scanMode !== "exits" && !isMarketOpen()) {
      await recordHeartbeat("autotrader-scan", startedAt, "ok", `entries skipped: market closed mode=${scanMode}`);
      return json({ status: "skipped-market-closed", mode: scanMode, summary });
    }

    // 3. Per-user processing — gated by per-user next_scan_at
    const now = new Date();
    let skippedNotDue = 0;
    let skippedKillSwitch = 0;
    let liquidatedUsers = 0;
    for (const settingsRow of settingsRows) {
      const rawSettings = settingsRow as Settings;

      // ── EMERGENCY MODE ───────────────────────────────────────────────────
      // Resolve effective mode from new `emergency_mode` column; fall back
      // to legacy `kill_switch` boolean (treated as 'freeze_entries') so any
      // user still on the old toggle keeps the same protective behavior.
      const effectiveEmergency: "off" | "freeze_entries" | "liquidate" =
        rawSettings.emergency_mode && rawSettings.emergency_mode !== "off"
          ? rawSettings.emergency_mode
          : rawSettings.kill_switch ? "freeze_entries" : "off";

      if (effectiveEmergency === "liquidate") {
        // Market-sell every open virtual position immediately, then drop the
        // user into freeze_entries so we don't keep liquidating on every scan.
        try {
          const closedCount = await liquidateAllPositions(supabase, rawSettings.user_id);
          liquidatedUsers++;
          await supabase.from("autotrade_settings")
            .update({
              emergency_mode: "freeze_entries",
              kill_switch: true,
              last_scan_at: now.toISOString(),
              next_scan_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
            })
            .eq("user_id", rawSettings.user_id);
          await supabase.from("autotrade_log").insert({
            user_id: rawSettings.user_id,
            ticker: "SCAN",
            action: "LIQUIDATE",
            reason: `Emergency LIQUIDATE: closed ${closedCount} open position${closedCount === 1 ? "" : "s"} at market. Entries now frozen — switch emergency mode to OFF to resume.`,
          });
        } catch (e) {
          console.error(`[liquidate] user ${rawSettings.user_id} failed`, e);
          await supabase.from("autotrade_log").insert({
            user_id: rawSettings.user_id, ticker: "SCAN", action: "ERROR",
            reason: `Liquidation error: ${(e as Error).message ?? "unknown"}`,
          });
        }
        continue;
      }

      if (effectiveEmergency === "freeze_entries") {
        // Entries frozen, but the regular scan loop below would also block
        // *exits*. Run a slim exit-only pass so stop-losses and take-profits
        // still fire and the user keeps risk management.
        skippedKillSwitch++;
        const nextScan = new Date(now.getTime() + 10 * 60_000);
        await supabase.from("autotrade_settings")
          .update({ last_scan_at: now.toISOString(), next_scan_at: nextScan.toISOString() })
          .eq("user_id", rawSettings.user_id);
        try {
          await runExitOnlyPass(supabase, rawSettings, macro, exitCalibration);
        } catch (e) {
          console.warn(`[freeze_entries] exit-pass failed for ${rawSettings.user_id}`, e);
        }
        await supabase.from("autotrade_log").insert({
          user_id: rawSettings.user_id,
          ticker: "SCAN",
          action: "FREEZE_ENTRIES",
          reason: "Emergency: entries frozen. Automated stop-losses & take-profits still active.",
        });
        continue;
      }

      // Per-user cadence gate applies only to entry scans. Exit scans must keep
      // running every cron tick so stops and take-profits are never delayed.
      const shouldApplyCadenceGate = scanMode === "all" || (scanMode === "entries" && entryShardCount <= 1);
      if (shouldApplyCadenceGate && rawSettings.next_scan_at && new Date(rawSettings.next_scan_at) > now) {
        skippedNotDue++;
        continue;
      }

      // Compute 7-day rolling P&L for this user
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: recentClosed } = await supabase
        .from("virtual_positions")
        .select("pnl")
        .eq("user_id", rawSettings.user_id)
        .eq("status", "closed")
        .gte("exit_date", sevenDaysAgo);
      const recentPnlDollars = (recentClosed ?? []).reduce(
        (s: number, p: any) => s + Number(p.pnl ?? 0), 0,
      );
      const recentPnlPct = (recentPnlDollars / Number(rawSettings.starting_nav || 100000)) * 100;

      // 30-day rolling NAV drawdown — peak-to-current from virtual_portfolio_log.
      // Also compute CDaR_0.95 (mean of worst 5% daily drawdowns over the window).
      // Stale-data safe: if we can't compute, treat as 0 so we never falsely block.
      let rollingDrawdownPct = 0;
      let rollingCdarPct = 0;
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: navHistory } = await supabase
          .from("virtual_portfolio_log")
          .select("total_value, date")
          .eq("user_id", rawSettings.user_id)
          .gte("date", thirtyDaysAgo)
          .order("date", { ascending: true });
        const values = (navHistory ?? [])
          .map((r: any) => Number(r.total_value))
          .filter((v: number) => Number.isFinite(v) && v > 0);
        if (values.length >= 2) {
          const peak = Math.max(...values);
          const current = values[values.length - 1];
          if (peak > 0 && current < peak) {
            rollingDrawdownPct = ((peak - current) / peak) * 100;
          }
          // CDaR_α: build per-day drawdown series (running peak − value)/peak,
          // sort descending, take the worst (1−α) tail and average it.
          let runPeak = values[0];
          const ddSeries: number[] = [];
          for (const v of values) {
            if (v > runPeak) runPeak = v;
            ddSeries.push(runPeak > 0 ? ((runPeak - v) / runPeak) * 100 : 0);
          }
          if (ddSeries.length >= 5) {
            const sorted = [...ddSeries].sort((a, b) => b - a);
            const tailN = Math.max(1, Math.ceil(sorted.length * (1 - CDAR_ALPHA)));
            const tail = sorted.slice(0, tailN);
            rollingCdarPct = tail.reduce((s, v) => s + v, 0) / tail.length;
          }
        }
      } catch (e) {
        console.warn("[rolling-dd/cdar] compute failed", e);
      }

      const adaptiveCtx: AdaptiveContext = {
        vix: vixValue,
        vixRegime,
        spyTrend,
        recentPnlPct,
        windowDays: 7,
        rollingDrawdownPct,
        rollingCdarPct,
        adjustments: [],
      };

      const settings = computeEffectiveSettings(rawSettings, adaptiveCtx, regimeFloors);

      // Persist live state for UI transparency (only when adaptive)
      if (rawSettings.adaptive_mode) {
        await supabase.from("autotrader_state").upsert({
          user_id: rawSettings.user_id,
          effective_min_conviction: settings.min_conviction,
          effective_max_positions: settings.max_positions,
          effective_max_nav_exposure_pct: settings.max_nav_exposure_pct,
          effective_max_single_name_pct: settings.max_single_name_pct,
          vix_value: vixValue,
          vix_regime: vixRegime,
          spy_trend: spyTrend,
          recent_pnl_pct: recentPnlPct,
          recent_pnl_window_days: 7,
          adjustments: adaptiveCtx.adjustments,
          reason: adaptiveCtx.adjustments.join(" • "),
          computed_at: now.toISOString(),
        }, { onConflict: "user_id" });
      }

      try {
        const userSummary = { entries: 0, exits: 0, partials: 0, holds: 0, blocked: 0, errors: 0, watchlistSize: 0, openPositions: 0, evaluated: 0 };
        await processUser(
          supabase,
          settings,
          macro,
          summary,
          userSummary,
          exitCalibration,
          volScalar,
          calibrationCurve,
          strategyTilts,
          tickerCalibration,
          scanMode,
          { shard: entryShard, shards: entryShardCount },
        );

        // Always write a per-scan rollup so users see the bot is alive even when
        // no trades fire. This is the single source of "scan happened" visibility.
        const rollupReason = buildScanRollupReason(userSummary, settings, adaptiveCtx);
        await supabase.from("autotrade_log").insert({
          user_id: rawSettings.user_id,
          ticker: "SCAN",
          action: "HOLD",
          reason: rollupReason,
          conviction: settings.min_conviction,
        });

        // Update cadence timestamps
        const timestampPatch: Record<string, string> = { last_scan_at: now.toISOString() };
        if (scanMode === "all" || (scanMode === "entries" && (entryShardCount <= 1 || entryShard === 0))) {
          const intervalMin = rawSettings.advanced_mode
            ? rawSettings.scan_interval_minutes
            : algoScanIntervalMinutes(macro, vixRegime);
          timestampPatch.next_scan_at = new Date(now.getTime() + intervalMin * 60_000).toISOString();
        }
        await supabase.from("autotrade_settings")
          .update(timestampPatch)
          .eq("user_id", rawSettings.user_id);
      } catch (err) {
        // Circuit breaker trips abort the current scan only — no global state is
        // persisted. Each scan re-evaluates Yahoo health from scratch; if the
        // upstream issue is resolved, the next scan proceeds normally.
        if (err instanceof CircuitBreakerTrippedError) {
          // Log a row to every active user's autotrade_log so it surfaces in their UI.
          const allUserIds = settingsRows.map(s => (s as Settings).user_id);
          if (allUserIds.length > 0) {
            await supabase.from("autotrade_log").insert(
              allUserIds.map(uid => ({
                user_id: uid,
                ticker: "SCAN",
                action: "CIRCUIT_BREAKER",
                reason: err.verdictReason,
              })),
            );
          }
          (summary as Record<string, unknown>).circuit_breaker_tripped = true;
          (summary as Record<string, unknown>).reason = err.verdictReason;
          await recordHeartbeat("autotrader-scan", startedAt, "error", `circuit-breaker: ${err.verdictReason}`);
          return json({ status: "circuit-breaker-tripped", reason: err.verdictReason, summary });
        }
        console.error(`User ${rawSettings.user_id} failed:`, err);
        summary.errors++;
        await supabase.from("autotrade_log").insert({
          user_id: rawSettings.user_id, ticker: "—", action: "ERROR",
          reason: (err as Error).message ?? "Unknown error",
        });
      }
    }
    (summary as Record<string, unknown>).skipped_not_due = skippedNotDue;
    (summary as Record<string, unknown>).skipped_kill_switch = skippedKillSwitch;
    (summary as Record<string, unknown>).liquidated_users = liquidatedUsers;

    await recordHeartbeat(
      "autotrader-scan",
      startedAt,
      "ok",
      `users=${summary.users} entries=${summary.entries} exits=${summary.exits} errors=${summary.errors}`,
    );
    return json({ status: "ok", mode: scanMode, shard: entryShard, shards: entryShardCount, summary });
  } catch (err) {
    console.error("AutoTrader top-level error:", err);
    await recordHeartbeat("autotrader-scan", startedAt, "error", (err as Error).message ?? "unknown");
    return json({ status: "error", error: (err as Error).message, summary }, 500);
  }
});

// ── Per-user pipeline ─────────────────────────────────────────────────────
type UserSummary = {
  entries: number; exits: number; partials: number; holds: number;
  blocked: number; errors: number;
  watchlistSize: number; openPositions: number; evaluated: number;
};

function buildScanRollupReason(u: UserSummary, s: Settings, ctx: AdaptiveContext): string {
  if (u.watchlistSize === 0 && u.openPositions === 0) {
    return `Scan ran but watchlist is empty — add tickers to your Watchlist so AutoTrader has something to evaluate.`;
  }
  if (u.entries === 0 && u.exits === 0 && u.partials === 0 && u.blocked === 0) {
    const regimeBits: string[] = [];
    if (ctx.vix != null) regimeBits.push(`VIX ${ctx.vix.toFixed(1)} (${ctx.vixRegime})`);
    if (ctx.spyTrend) regimeBits.push(`SPY ${ctx.spyTrend}`);
    const regime = regimeBits.length ? ` | ${regimeBits.join(" · ")}` : "";
    return `Evaluated ${u.evaluated}/${u.watchlistSize} watchlist tickers · ${u.openPositions} open. No signals cleared conviction floor of ${s.min_conviction}.${regime}`;
  }
  const parts: string[] = [];
  if (u.entries) parts.push(`${u.entries} entry`);
  if (u.exits) parts.push(`${u.exits} exit`);
  if (u.partials) parts.push(`${u.partials} partial`);
  if (u.blocked) parts.push(`${u.blocked} blocked`);
  return `Scan complete · ${parts.join(", ")} · evaluated ${u.evaluated}/${u.watchlistSize} · ${u.openPositions} open`;
}

// ── NYSE market-hours gate ────────────────────────────────────────────────
// Returns true Mon–Fri, 9:30–16:00 America/New_York, with NYSE holiday calendar
// applied (full closures + early-close days at 13:00 ET).
function isMarketOpen(now: Date = new Date()): boolean {
  if (isMarketHoliday(now)) return false;
  // Convert to NY wall-clock via locale string (handles DST automatically)
  const nyStr = now.toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
  // Format: "M/D/YYYY, HH:MM:SS"
  const m = nyStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return false;
  const yr = Number(m[3]), mo = Number(m[1]) - 1, day = Number(m[2]);
  const hh = Number(m[4]), mm = Number(m[5]);
  // Day-of-week using a UTC date with the NY components (close enough for weekday check)
  const dow = new Date(Date.UTC(yr, mo, day)).getUTCDay(); // 0=Sun .. 6=Sat
  if (dow === 0 || dow === 6) return false;
  const minutes = hh * 60 + mm;
  const close = nyseCloseMinute(now); // 16:00 normal, 13:00 on early-close days
  return minutes >= 9 * 60 + 30 && minutes < close;
}

// ── AUTO-DISCOVERY: pull good live_signals into watchlist + prune stale auto-adds ──
async function syncAutoWatchlist(
  supabase: any,
  settings: Settings,
  currentWatch: Array<{ ticker: string; source: string | null }>,
  openPositionTickers: string[],
): Promise<void> {
  const userId = settings.user_id;
  const floor = Math.max(50, Math.min(95, settings.auto_watchlist_consideration_floor ?? 60));
  const staleDays = Math.max(1, Math.min(90, settings.auto_watchlist_stale_days ?? 14));

  // Pull recent qualifying live signals (last 24h)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: sigs, error: sErr } = await supabase
    .from("live_signals")
    .select("ticker, confidence, created_at")
    .gte("confidence", floor)
    .gte("created_at", since)
    .gt("expires_at", new Date().toISOString())
    .order("confidence", { ascending: false });
  if (sErr) {
    console.warn("auto-add: live_signals fetch failed", sErr);
    return;
  }

  // Best signal per ticker (already sorted by confidence desc)
  const bestByTicker = new Map<string, { confidence: number; created_at: string }>();
  for (const s of (sigs ?? []) as Array<{ ticker: string; confidence: number; created_at: string }>) {
    const t = String(s.ticker).toUpperCase();
    if (!bestByTicker.has(t)) {
      bestByTicker.set(t, { confidence: Number(s.confidence), created_at: s.created_at });
    }
  }

  const existingTickers = new Set(currentWatch.map(w => String(w.ticker).toUpperCase()));

  // 1. INSERT new auto-added tickers
  const toInsert: Array<Record<string, unknown>> = [];
  for (const [ticker, info] of bestByTicker.entries()) {
    if (existingTickers.has(ticker)) continue;
    toInsert.push({
      user_id: userId,
      ticker,
      asset_type: "stock",
      source: "auto",
      last_signal_at: info.created_at,
      notes: `Auto-added by AutoTrader (signal conviction ${Math.round(info.confidence)})`,
    });
  }
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from("watchlist").insert(toInsert);
    if (insErr) {
      console.warn("auto-add: watchlist insert failed", insErr);
    } else {
      // Log a single rollup row so users see what happened
      await supabase.from("autotrade_log").insert({
        user_id: userId,
        ticker: "WATCHLIST",
        action: "AUTO_ADD",
        reason: `Added ${toInsert.length} ticker${toInsert.length === 1 ? "" : "s"}: ${toInsert.map(r => r.ticker).join(", ")}`,
      });
    }
  }

  // 2. TOUCH last_signal_at on existing auto rows that fired again today
  for (const [ticker, info] of bestByTicker.entries()) {
    if (!existingTickers.has(ticker)) continue;
    await supabase.from("watchlist")
      .update({ last_signal_at: info.created_at })
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .eq("source", "auto");
  }

  // 3. PRUNE stale auto-added tickers (no signal in N days, not currently held)
  const heldSet = new Set(openPositionTickers.map(t => t.toUpperCase()));
  const staleCutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
  const { data: staleRows } = await supabase
    .from("watchlist")
    .select("id, ticker, last_signal_at, created_at")
    .eq("user_id", userId)
    .eq("source", "auto");

  const toDelete: string[] = [];
  const deletedTickers: string[] = [];
  for (const row of (staleRows ?? []) as Array<{ id: string; ticker: string; last_signal_at: string | null; created_at: string }>) {
    const t = String(row.ticker).toUpperCase();
    if (heldSet.has(t)) continue; // never prune something we own
    const lastSeen = row.last_signal_at ?? row.created_at;
    if (new Date(lastSeen).toISOString() < staleCutoff) {
      toDelete.push(row.id);
      deletedTickers.push(t);
    }
  }
  if (toDelete.length > 0) {
    await supabase.from("watchlist").delete().in("id", toDelete);
    await supabase.from("autotrade_log").insert({
      user_id: userId,
      ticker: "WATCHLIST",
      action: "AUTO_REMOVE",
      reason: `Pruned ${toDelete.length} stale auto-added ticker${toDelete.length === 1 ? "" : "s"} (no signal in ${staleDays}d): ${deletedTickers.join(", ")}`,
    });
  }
}


// ── EMERGENCY MODE HELPERS ──────────────────────────────────────────────────

/** Market-sell every open virtual position for a user at the live quote.
 *  Reuses the same accounting path as a normal FULL_EXIT so unrealized P&L,
 *  cooldowns, and sell_alert notifications stay consistent. */
async function liquidateAllPositions(
  supabase: any,
  userId: string,
): Promise<number> {
  const { data: posRows } = await supabase
    .from("virtual_positions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open");
  const positions = (posRows ?? []) as unknown as Position[];
  if (positions.length === 0) return 0;

  let closed = 0;
  for (const pos of positions) {
    let price: number | null = null;
    try {
      const q = await fetchLiveQuote(pos.ticker);
      price = q?.price ?? null;
    } catch (_e) { /* fall through to entry price */ }
    if (!price || !Number.isFinite(price) || price <= 0) {
      price = Number(pos.entry_price); // last-resort flat exit
    }
    const action: ExitAction = {
      kind: "FULL_EXIT",
      price,
      reason: "Emergency LIQUIDATE",
    } as ExitAction;
    const profile = PROFILE_PARAMS[(pos.entry_profile as StockProfile) ?? "normal"];
    const innerSummary = { exits: 0, partials: 0, holds: 0 };
    await executeExit(supabase, pos, action, profile, innerSummary);
    closed += innerSummary.exits;
  }
  return closed;
}

/** Run only the exit pass (stops, take-profits, partials) for a frozen user.
 *  Skips watchlist, entries, sizing — pure risk management. */
async function runExitOnlyPass(
  supabase: any,
  rawSettings: Settings,
  macro: MacroContext | null,
  exitCalibration: Record<string, { trailMultAdjust: number }> | null,
): Promise<void> {
  const userId = rawSettings.user_id;
  const { data: posRows } = await supabase
    .from("virtual_positions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open");
  const positions = (posRows ?? []) as unknown as Position[];
  if (positions.length === 0) return;

  await batchFetch(positions.map(p => p.ticker.toUpperCase()));

  for (const pos of positions) {
    const data = priceCache.get(pos.ticker.toUpperCase());
    if (!data || data.close.length < 200) continue;
    const currentPrice = data.close[data.close.length - 1];

    let liveBias: "long" | "short" | "flat" | null = null;
    let liveDecision: "BUY" | "SHORT" | "HOLD" | null = null;
    let liveConviction = 0;
    let liveWeeklyAlloc = pos.entry_weekly_alloc ?? 0;
    let liveRsi = 50;
    try {
      const sig = evaluateSignal(data, pos.ticker, undefined, macro);
      if (sig) {
        liveBias = sig.weeklyBias.bias;
        liveDecision = sig.decision;
        liveConviction = sig.conviction ?? 0;
        liveWeeklyAlloc = sig.weeklyBias.targetAllocation;
      }
      const rsiArr = calculateRSI(data.close, 14);
      liveRsi = safeGet(rsiArr, 50);
    } catch (_e) { /* swallow — defensive only */ }

    const cls = classifyStock(data.close, data.high, data.low, pos.ticker);
    const baseProfile = cls.blendedParams ?? PROFILE_PARAMS[
      (pos.entry_profile as StockProfile) ?? cls.classification
    ];
    const stratKey = pos.entry_strategy ?? "unknown";
    const trailAdj = exitCalibration?.[stratKey]?.trailMultAdjust ?? 1.0;
    const profile: ProfileParams = trailAdj !== 1.0
      ? { ...baseProfile, trailingStopATRMult: baseProfile.trailingStopATRMult * trailAdj }
      : baseProfile;

    // Earnings blackout for OPEN positions (audit gap G-3): close before the
    // gap rather than blocking new entries only. Always takes priority.
    let earningsAct: ExitAction | null = null;
    try {
      const eDays = await getEarningsBlackoutDays(pos.ticker.toUpperCase());
      if (eDays !== null && eDays <= 2) {
        earningsAct = {
          kind: "FULL_EXIT",
          reason: `Earnings blackout: report in ~${eDays} trading day${eDays === 1 ? "" : "s"} — closing to avoid gap risk`,
          price: currentPrice,
        };
      }
    } catch (_e) { /* non-fatal */ }

    const lossAct = earningsAct ?? runLossExit(pos, data, currentPrice, profile, liveDecision, liveConviction, liveBias, liveRsi);
    const action: ExitAction = lossAct ?? runWinExit(pos, data, currentPrice, profile, liveWeeklyAlloc);
    const innerSummary = { exits: 0, partials: 0, holds: 0 };
    await executeExit(supabase, pos, action, profile, innerSummary);
  }
}


async function processUser(
  supabase: any,
  settings: Settings,
  macro: MacroContext | null,
  summary: { entries: number; exits: number; partials: number; holds: number; blocked: number; errors: number },
  userSummary: UserSummary,
  exitCalibration: Record<string, { trailMultAdjust: number }> | null,
  volScalar: number,
  calibrationCurve: Record<string, { adjust: number }>,
  strategyTilts: Record<string, { multiplier: number }>,
  tickerCalibration: Record<string, { adjust: number }>,
  scanMode: ScanMode = "all",
  entryShard: { shard: number; shards: number } = { shard: 0, shards: 1 },
) {
  const userId = settings.user_id;

  // Load open positions + watchlist + sector-exposure caps (Phase 3 #14)
  const [posRes, watchRes, capsRes] = await Promise.all([
    supabase.from("virtual_positions").select("*").eq("user_id", userId).eq("status", "open"),
    supabase.from("watchlist").select("ticker, source").eq("user_id", userId).eq("asset_type", "stock"),
    supabase.from("portfolio_caps").select("enabled, enforcement_mode, sector_max_pct, portfolio_beta_max").eq("user_id", userId).maybeSingle(),
  ]);
  const positions = (posRes.data ?? []) as unknown as Position[];
  let watchRows = (watchRes.data ?? []) as Array<{ ticker: string; source: string | null }>;
  const caps = (capsRes.data ?? null) as { enabled: boolean; enforcement_mode: string; sector_max_pct: number; portfolio_beta_max: number } | null;

  // ── AUTO-DISCOVERY: pull promising tickers from live_signals into watchlist ──
  // Run this in the entry cadence, not the 5-min exit cadence, so watchlist
  // refreshes remain cheap and don't compete with risk-management exits.
  if (scanMode !== "exits" && settings.auto_add_watchlist && entryShard.shard === 0) {
    await syncAutoWatchlist(supabase, settings, watchRows, positions.map(p => p.ticker.toUpperCase()));
    // Re-read so the rest of the scan picks up newly-added rows
    const refreshed = await supabase.from("watchlist")
      .select("ticker, source").eq("user_id", userId).eq("asset_type", "stock");
    watchRows = (refreshed.data ?? []) as Array<{ ticker: string; source: string | null }>;
  }

  const watchlist = watchRows.map(w => String(w.ticker).toUpperCase());
  userSummary.watchlistSize = watchlist.length;
  userSummary.openPositions = positions.length;

  // Build deduped ticker list
  const entryCandidatesForShard = watchlist.filter(t =>
    entryShard.shards <= 1 || tickerShard(t, entryShard.shards) === entryShard.shard
  );
  const entryTickers = entryCandidatesForShard.slice(0, MAX_ENTRY_TICKERS_PER_INVOCATION);
  const tickersForThisMode = scanMode === "exits"
    ? positions.map(p => p.ticker.toUpperCase())
    : scanMode === "entries"
    ? entryTickers
    : [...positions.map(p => p.ticker.toUpperCase()), ...entryTickers];
  const allTickers = Array.from(new Set(tickersForThisMode));
  if (allTickers.length === 0) return;

  // C-2 FIX: hydrate the per-ticker signal cooldown tracker from DB so that
  // cooldownBarsRemaining actually carries between cron invocations
  // (edge-function cold starts otherwise reset the in-memory cache and the
  // documented cooldown never fires). Persisted at end of processUser below.
  clearTrackerCache();
  await primeTrackerCacheFromDB(supabase, allTickers);

  await batchFetch(allTickers);

  // ── CIRCUIT BREAKER — evaluate batch fetch health before any decisions ──
  // If any threshold trips (>20% null prices, >50% fetch failures, etc.) we
  // abort the entire scan to protect every user from bad-data fills. The next
  // scheduled scan re-checks Yahoo from scratch — no global state is persisted.
  const nowEt = new Date();
  const marketIsOpen =
    !isMarketHoliday(nowEt) &&
    (() => {
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(nowEt);
      if (wd === "Sat" || wd === "Sun") return false;
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(nowEt);
      const hh = Number(parts.find(p => p.type === "hour")?.value ?? "0");
      const mm = Number(parts.find(p => p.type === "minute")?.value ?? "0");
      const min = hh * 60 + mm;
      return min >= 9 * 60 + 30 && min < nyseCloseMinute(nowEt);
    })();

  const healths: TickerHealth[] = allTickers.map(t => ({
    ticker: t,
    data: priceCache.get(t) ?? null,
  }));
  const verdict = evaluateScanHealth(healths, marketIsOpen);
  if (verdict.trip) {
    const reason = `circuit_breaker: ${verdict.reason} at ${nowEt.toISOString()}`;
    console.error(`[autotrader-scan] CIRCUIT BREAKER TRIPPED — ${reason}`);
    throw new CircuitBreakerTrippedError(reason);
  }

  userSummary.evaluated = allTickers.filter(t => {
    const d = priceCache.get(t);
    return d && d.close.length >= 200 && !verdict.suspectTickers.has(t);
  }).length;

  // Compute today's P&L (realized today + unrealized today vs entry)
  const today = new Date().toISOString().split("T")[0];
  const { data: closedToday } = await supabase
    .from("virtual_positions")
    .select("pnl, exit_date")
    .eq("user_id", userId)
    .eq("status", "closed")
    .gte("exit_date", today);
  const realizedToday = (closedToday ?? []).reduce((s: number, p: any) => s + Number(p.pnl ?? 0), 0);

  // ── EXITS first ─────────────────────────────────────────────────────────
  let totalNavExposureDollars = 0;
  let unrealizedToday = 0;

  if (scanMode !== "entries") for (const pos of positions) {
    const data = priceCache.get(pos.ticker.toUpperCase());
    if (!data || data.close.length < 200) continue;
    const currentPrice = data.close[data.close.length - 1];
    totalNavExposureDollars += currentPrice * Number(pos.shares);
    const pnlDollars = pos.position_type === "long"
      ? (currentPrice - Number(pos.entry_price)) * Number(pos.shares)
      : (Number(pos.entry_price) - currentPrice) * Number(pos.shares);
    unrealizedToday += pnlDollars;

    // Live evaluateSignal output for thesis check
    let liveBias: "long" | "short" | "flat" | null = null;
    let liveDecision: "BUY" | "SHORT" | "HOLD" | null = null;
    let liveConviction = 0;
    let liveWeeklyAlloc = pos.entry_weekly_alloc ?? 0;
    let liveRsi = 50;
    try {
      const sig = evaluateSignal(data, pos.ticker, undefined, macro);
      if (sig) {
        liveBias = sig.weeklyBias.bias;
        liveDecision = sig.decision;
        liveConviction = sig.conviction ?? 0;
        liveWeeklyAlloc = sig.weeklyBias.targetAllocation;
      }
      const rsiArr = calculateRSI(data.close, 14);
      liveRsi = safeGet(rsiArr, 50);
    } catch (e) { console.warn("live signal eval failed", pos.ticker, e); }

    // Profile
    const cls = classifyStock(data.close, data.high, data.low, pos.ticker);
    const baseProfile = cls.blendedParams ?? PROFILE_PARAMS[
      (pos.entry_profile as StockProfile) ?? cls.classification
    ];

    // ── Exit calibration: nightly job learns per-strategy MFE-vs-realized capture
    //    and outputs a trailing-stop multiplier adjustment. Apply it here.
    const stratKey = pos.entry_strategy ?? "unknown";
    const trailAdj = exitCalibration?.[stratKey]?.trailMultAdjust ?? 1.0;
    const profile: ProfileParams = trailAdj !== 1.0
      ? { ...baseProfile, trailingStopATRMult: baseProfile.trailingStopATRMult * trailAdj }
      : baseProfile;

    // Earnings blackout for OPEN positions (audit gap G-3): close 2 trading
    // days before earnings to avoid gap-through-stop risk. Takes priority
    // over both win-exit and loss-exit logic.
    let earningsAct: ExitAction | null = null;
    try {
      const eDays = await getEarningsBlackoutDays(pos.ticker.toUpperCase());
      if (eDays !== null && eDays <= 2) {
        earningsAct = {
          kind: "FULL_EXIT",
          reason: `Earnings blackout: report in ~${eDays} trading day${eDays === 1 ? "" : "s"} — closing to avoid gap risk`,
          price: currentPrice,
        };
      }
    } catch (_e) { /* non-fatal */ }

    // Run loss + win in priority order (earnings → loss → win)
    const lossAct = earningsAct ?? runLossExit(pos, data, currentPrice, profile, liveDecision, liveConviction, liveBias, liveRsi);
    const action: ExitAction = lossAct ?? runWinExit(pos, data, currentPrice, profile, liveWeeklyAlloc);

    const beforeExits = summary.exits, beforePartials = summary.partials, beforeHolds = summary.holds;
    await executeExit(supabase, pos, action, profile, summary);
    userSummary.exits += summary.exits - beforeExits;
    userSummary.partials += summary.partials - beforePartials;
    userSummary.holds += summary.holds - beforeHolds;
  }

  // C-3 / G-2 FIX: cumulative realized PnL across this user's entire closed
  // history. Combined with today's unrealized this gives an accurate MTM NAV
  // used both for position sizing AND for the rolling-drawdown circuit breaker.
  // Computed unconditionally so the disabled-autotrader snapshot below also
  // reports a true MTM equity curve (closes audit gap G-2: breaker previously
  // saw only closed PnL via virtual_portfolio_log snapshots that ignored
  // realized history).
  let cumulativeRealizedPnl = 0;
  try {
    const { data: allClosed } = await supabase
      .from("virtual_positions")
      .select("pnl")
      .eq("user_id", userId)
      .eq("status", "closed");
    cumulativeRealizedPnl = (allClosed ?? []).reduce(
      (s: number, p: any) => s + Number(p.pnl ?? 0), 0,
    );
  } catch (e) {
    console.warn("cumulative pnl query failed", e);
  }
  const currentNav = Math.max(
    settings.starting_nav * 0.1, // sanity floor: never let NAV fall below 10% of start
    settings.starting_nav + cumulativeRealizedPnl + unrealizedToday,
  );

  // ── ENTRIES ─────────────────────────────────────────────────────────────
  // Only users with autotrader enabled get new entries. Users with disabled
  // autotrader still benefit from the exit pass above (manual buys auto-close).
  if (scanMode === "exits") {
    await supabase.from("virtual_portfolio_log").upsert(
      {
        user_id: userId, date: today,
        total_value: currentNav,
        cash: Math.max(0, currentNav - totalNavExposureDollars),
        positions_value: totalNavExposureDollars,
      },
      { onConflict: "user_id,date" },
    );
    await persistTrackerCacheToDB(supabase);
    return;
  }

  if (!settings.enabled) {
    await supabase.from("virtual_portfolio_log").upsert(
      {
        user_id: userId, date: today,
        total_value: currentNav,
        cash: Math.max(0, currentNav - totalNavExposureDollars),
        positions_value: totalNavExposureDollars,
      },
      { onConflict: "user_id,date" },
    );
    return;
  }
  // Per-user open count: positions that survived the exit pass above.
  // (Was previously using global summary.exits which contaminated user B with user A's exits.)
  const refreshedOpenCount = positions.length - userSummary.exits;
  const navExposurePct = (totalNavExposureDollars / currentNav) * 100;
  const todayPnlPct = ((realizedToday + unrealizedToday) / currentNav) * 100;

  const heldTickers = new Set(positions.map(p => p.ticker.toUpperCase()));


  // ── CAPITAL ROTATION GATE ─────────────────────────────────────────────
  // When all slots are full we normally skip the entry scan to conserve API
  // calls. If the user opted into capital rotation we instead let the scan
  // run; rotation candidates are evaluated below in PASS 2. Anything that's
  // not strong enough to rotate still gets skipped efficiently.
  const rotationActive = !!settings.rotation_enabled && refreshedOpenCount >= settings.max_positions;
  if (refreshedOpenCount >= settings.max_positions && !settings.rotation_enabled) {
    userSummary.holds += Math.max(0, watchlist.length - heldTickers.size);
    await supabase.from("autotrade_log").insert({
      user_id: userId, ticker: "—", action: "BLOCKED",
      reason: `All position slots full (${refreshedOpenCount}/${settings.max_positions}) — entry scan skipped to conserve API calls`,
    });
    return;
  }

  // Daily rotation counter — reset when calendar day rolled over.
  let rotationCountToday = settings.rotation_count_today ?? 0;
  if (settings.rotation_day !== today) {
    rotationCountToday = 0;
    await supabase.from("autotrade_settings")
      .update({ rotation_count_today: 0, rotation_day: today })
      .eq("user_id", userId);
  }
  const rotationBudget = Math.max(0, (settings.rotation_max_per_day ?? 3) - rotationCountToday);


  // PASS 1 — gather decisions for every eligible ticker (no DB writes yet).
  // (Entry-stagger cap is computed *after* marketRegime is loaded — see below.)
  type Pending =
    | { kind: "enter"; ticker: string; decision: Extract<EntryAction, { kind: "ENTER" }> }
    | { kind: "blocked"; ticker: string; decision: { kind: "BLOCKED"; reason: string } }
    | { kind: "hold" };
  const pending: Pending[] = [];

  // Pre-load Danelfin AI Scores for the whole watchlist in one query — used
  // as a SUPPORTING conviction factor inside evaluateSignal. Missing scores
  // are neutral (never block).
  const watchlistForEntry = entryTickers;
  if (watchlistForEntry.length < entryCandidatesForShard.length) {
    await supabase.from("autotrade_log").insert({
      user_id: userId,
      ticker: "SCAN",
      action: "HOLD",
      reason: `Entry scan chunked: evaluating ${watchlistForEntry.length}/${entryCandidatesForShard.length} eligible watchlist tickers this run to stay within CPU budget`,
    });
  }

  const danelfinMap = await loadDanelfinScores(watchlistForEntry);
  if (danelfinMap.size > 0) {
    console.log(`autotrader-scan: Danelfin coverage ${danelfinMap.size}/${watchlistForEntry.length}`);
  }

  // Pre-load EPS revision scores — supporting fundamental factor (never blocks).
  const epsRevisionMap = await loadEpsRevisions(watchlistForEntry);
  if (epsRevisionMap.size > 0) {
    console.log(`autotrader-scan: EPS revision coverage ${epsRevisionMap.size}/${watchlistForEntry.length}`);
  }

  // Pre-load short-interest velocity map — supporting factor (never blocks).
  const shortInterestMap = await loadShortInterestMap(watchlistForEntry);
  if (shortInterestMap.size > 0) {
    console.log(`autotrader-scan: short-interest coverage ${shortInterestMap.size}/${watchlistForEntry.length}`);
  }

  // Pre-load current market regime (cached daily) + meta-label model (latest).
  // Both are null-safe → engine treats missing as no-op.
  const marketRegime = await loadLatestRegime();
  const metaModel = await loadLatestMetaModel();
  if (marketRegime) console.log(`autotrader-scan: regime=${marketRegime}`);
  if (metaModel) console.log(`autotrader-scan: meta-model n=${metaModel.sample_size} AUC=${metaModel.auc ?? "n/a"}`);

  // ── ADWIN drift detection (run once at scan start) ─────────────────────
  // Pulls last ~200 closed outcomes (binary hit = realized_pnl_pct > 0) and
  // checks for concept drift. On drift, tighten meta-label thresholds and
  // INSERT a row into drift_events so the UI + nightly trainer can react.
  let metaGate: { pass: number; skip: number } = { pass: 0.45, skip: 0.30 };
  try {
    const { data: recent } = await supabase
      .from("signal_outcomes")
      .select("realized_pnl_pct, entry_date")
      .in("status", ["closed", "stopped_out", "took_profit"])
      .order("entry_date", { ascending: false })
      .limit(200);
    const series: number[] = [];
    for (const o of (recent ?? []) as Array<{ realized_pnl_pct: number | null }>) {
      const p = Number(o.realized_pnl_pct);
      if (Number.isFinite(p)) series.push(p > 0 ? 1 : 0);
    }
    // Reverse so the most-recent obs ends up at the right side of the window.
    series.reverse();
    const drift = detectAdwinDrift(series);
    if (drift.drift) {
      metaGate = adwinGateAdjust(drift.severity);
      console.log(`autotrader-scan: ADWIN drift ${drift.severity} | pre=${drift.preMean} post=${drift.postMean} | gate pass=${metaGate.pass} skip=${metaGate.skip}`);
      await supabase.from("drift_events").insert({
        window_size: drift.windowSize,
        pre_mean: drift.preMean,
        post_mean: drift.postMean,
        severity: drift.severity,
      });
    }
  } catch (e) { console.warn("ADWIN drift check failed", e); }



  // Pre-load realized edges per strategy from signal_outcomes (last 180d, closed).
  // Used to wire realKelly sizing — H-6 audit closure. Empty → cold-start ramp.
  const strategyEdges: Record<string, { winRate: number; avgWin: number; avgLoss: number; sampleSize: number }> = {};
  try {
    const cutoff = new Date(Date.now() - 180 * 86400000).toISOString();
    const { data: outcomes } = await supabase
      .from("signal_outcomes")
      .select("strategy, realized_pnl_pct, exit_reason")
      .gte("entry_date", cutoff)
      .in("status", ["closed", "stopped_out", "took_profit"])
      .limit(5000);
    const buckets: Record<string, { wins: number[]; losses: number[] }> = {};
    for (const o of (outcomes ?? []) as Array<{ strategy: string | null; realized_pnl_pct: number | null; exit_reason: string | null }>) {
      const s = o.strategy ?? "none";
      const p = Number(o.realized_pnl_pct);
      if (!Number.isFinite(p)) continue;
      if (!buckets[s]) buckets[s] = { wins: [], losses: [] };
      if (p > 0) buckets[s].wins.push(p);
      else buckets[s].losses.push(Math.abs(p));
    }
    for (const [s, b] of Object.entries(buckets)) {
      const n = b.wins.length + b.losses.length;
      if (n < 10) continue;
      const winRate = (b.wins.length / n) * 100;
      const avgWin = b.wins.length ? b.wins.reduce((a, c) => a + c, 0) / b.wins.length : 0;
      const avgLoss = b.losses.length ? b.losses.reduce((a, c) => a + c, 0) / b.losses.length : 0;
      strategyEdges[s] = { winRate, avgWin, avgLoss, sampleSize: n };
    }
    if (Object.keys(strategyEdges).length > 0) {
      console.log(`autotrader-scan: realKelly edges`, strategyEdges);
    }
  } catch (e) { console.warn("strategyEdges load failed", e); }

  for (const ticker of watchlistForEntry) {
    if (heldTickers.has(ticker)) continue;

    // Cooldown check (most-recent close)
    const { data: lastClose } = await supabase
      .from("virtual_positions")
      .select("cooldown_until")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .order("closed_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const cd = lastClose?.[0]?.cooldown_until;
    if (cd && new Date(cd as string).getTime() > Date.now()) continue;

    const data = priceCache.get(ticker);
    if (!data || data.close.length < 200) continue;

    const decision = await runEntryDecision(
      ticker, data, macro, settings,
      // When rotation is active we already know slots are full — bypass the
      // hard slot-count block so the candidate can be ranked & compared
      // against the worst open position downstream.
      rotationActive ? 0 : refreshedOpenCount,
      navExposurePct,
      todayPnlPct,
      Array.from(heldTickers),
      volScalar,
      calibrationCurve, strategyTilts, tickerCalibration,
      danelfinMap,
      epsRevisionMap,
      currentNav, // C-3 FIX: dynamic NAV for sizing
      marketRegime,
      metaModel,
      strategyEdges,
      shortInterestMap,
      metaGate,
    );


    if (decision.kind === "ENTER") pending.push({ kind: "enter", ticker, decision });
    else if (decision.kind === "BLOCKED") pending.push({ kind: "blocked", ticker, decision: { kind: "BLOCKED", reason: decision.reason } });
    else pending.push({ kind: "hold" });
  }

  // PASS 2 — sort ENTER candidates by conviction desc, take top N, defer the rest.
  // ADAPTIVE entry-stagger cap (Phase 1 sweep). Scales with regime (rich
  // bull_quiet tapes deserve more fills, bear_volatile deserves fewer) and
  // dampens when the book is drawing down.
  let maxEntriesPerScan = 2;
  if (marketRegime === "bull_quiet") maxEntriesPerScan = 4;
  else if (marketRegime === "bull_volatile" || marketRegime === "neutral") maxEntriesPerScan = 3;
  else if (marketRegime === "bear_quiet") maxEntriesPerScan = 2;
  else if (marketRegime === "bear_volatile") maxEntriesPerScan = 1;
  if (settings.current_drawdown_pct >= 5) maxEntriesPerScan = Math.max(1, maxEntriesPerScan - 1);
  const MAX_ENTRIES_PER_SCAN = maxEntriesPerScan;
  const enterCandidates = pending
    .filter((p): p is Extract<Pending, { kind: "enter" }> => p.kind === "enter")
    .sort((a, b) => b.decision.conviction - a.decision.conviction);
  const toExecute = enterCandidates.slice(0, MAX_ENTRIES_PER_SCAN);
  const deferred = enterCandidates.slice(MAX_ENTRIES_PER_SCAN);

  // ── Sector + portfolio-beta exposure maps (Phase 3 #14 / #15) ───────────
  // Build $-by-sector and weighted-beta accumulator for currently open
  // positions; both update intra-scan as new entries fire so stacking respects
  // the caps too. Cash is treated as beta = 0.
  const sectorDollars = new Map<string, number>();
  const sectorOf = new Map<string, string | null>();
  const betaCapsActive = !!(caps && caps.enabled && (caps.portfolio_beta_max ?? 0) > 0);
  const sectorCapsActive = !!(caps && caps.enabled && caps.sector_max_pct > 0);
  const capsActive = sectorCapsActive || betaCapsActive;
  const capPct = caps?.sector_max_pct ?? 35;
  const betaCap = caps?.portfolio_beta_max ?? 1.5;
  const blockMode = (caps?.enforcement_mode ?? "warn") === "block";

  let bookBetaDollars = 0; // Σ (positionDollars × beta)

  // ── Portfolio heat (total open R-risk) — Phase 4 ────────────────────────
  // Sum of |entry − hard_stop_price| × shares across open positions = the
  // worst-case $ lost if every stop hits today. Capped at 6% of starting_nav
  // (institutional standard: never have >6% of book at risk simultaneously).
  // Falls back to inferHardStopPrice() for legacy positions without stops.
  const PORTFOLIO_HEAT_CAP_PCT = 6;
  let openRiskDollars = 0;
  for (const pos of positions) {
    const entry = Number(pos.entry_price);
    const stop = inferHardStopPrice(pos);
    if (!Number.isFinite(entry) || stop == null || !Number.isFinite(stop)) continue;
    openRiskDollars += Math.abs(entry - stop) * Number(pos.shares);
  }
  if (capsActive) {
    for (const pos of positions) {
      const t = pos.ticker.toUpperCase();
      const data = priceCache.get(t);
      if (!data) continue;
      const px = data.close[data.close.length - 1];
      const dollars = px * Number(pos.shares);
      if (sectorCapsActive) {
        let sector: string | null;
        try { sector = await getSector(t); } catch { sector = null; }
        sectorOf.set(t, sector);
        if (sector) sectorDollars.set(sector, (sectorDollars.get(sector) ?? 0) + dollars);
      }
      if (betaCapsActive) {
        let b: number | null;
        try { b = await getBeta(t); } catch { b = null; }
        bookBetaDollars += dollars * (b ?? 1);
      }
    }
  }

  // ── Rotation bookkeeping ─────────────────────────────────────────────────
  // Build a mutable view of open positions so rotation closes update the book
  // and downstream NAV / correlation re-checks see the new state.
  const livePositions: Position[] = [...positions];
  let rotationsDoneThisScan = 0;
  // ADAPTIVE rotation floor (Phase 1 sweep): base 85, but lifts with the
  // effective min_conviction (which already moves with regime + drawdown in
  // computeEffectiveSettings) so we never rotate on a marginally-above-floor
  // candidate. Bear-vol regimes get an extra +5 because displacement costs
  // (slippage + tax) hurt more when the tape is punishing.
  const HIGH_CONVICTION_ROTATION_FLOOR =
    Math.max(85, settings.min_conviction + 15) + (marketRegime === "bear_volatile" ? 5 : 0);
  // ADAPTIVE min-age gate: fresh entries are protected from immediate
  // rotation, but the "fresh" horizon should scale with volatility. High-vol
  // names need less time to prove themselves (a 5% ATR move plays out fast),
  // low-vol names deserve longer. Base 30 min → scaled by SPY realized vol.
  const _spyVolAnn = macro ? (realizedVolAnnualized(macro.spyClose, 20) ?? 0.18) : 0.18;
  const MIN_POSITION_AGE_MS = Math.round(
    30 * 60_000 * Math.max(0.5, Math.min(2.0, 0.18 / Math.max(0.05, _spyVolAnn))),
  );

  // ── Engine-speed: fire-and-forget log inserts ────────────────────────────
  // Each candidate may emit a BLOCKED/HOLD/WARN row to autotrade_log; awaiting
  // each round-trip serialises the loop on network latency. Queue them and
  // settle once after the loop instead.
  const logInserts: Promise<unknown>[] = [];
  const queueLog = (row: Record<string, unknown>) => {
    logInserts.push(
      Promise.resolve(supabase.from("autotrade_log").insert(row)).then(() => {}, (e: unknown) => {
        console.warn("autotrade_log insert failed", e);
      }),
    );
  };

  // ── Engine-speed: CVaR base/marginal caching ─────────────────────────────
  // Build the base sim (open book only) once per scan, reuse across all
  // candidates. Invalidate on rotation close or successful entry so the next
  // gate evaluation re-seeds from the updated book.
  let cvarBase: CvarBase | null = null;
  let cvarBaseDirty = true;
  const buildCvarBase = (): CvarBase | null => {
    const basePositions: CvarPosition[] = [];
    for (const pos of livePositions) {
      const d = priceCache.get(pos.ticker.toUpperCase());
      if (!d) continue;
      const px = d.close[d.close.length - 1];
      const dirSign = pos.position_type === "long" ? 1 : -1;
      const rets = closeToReturns(d.close.slice(-61));
      basePositions.push({
        ticker: pos.ticker,
        dollars: dirSign * px * Number(pos.shares),
        returns: rets,
      });
    }
    return computePortfolioCvarBase(basePositions);
  };

  for (const p of toExecute) {
    // ── ROTATION GATE: if slots are full and rotation enabled, evaluate
    // whether this candidate is strong enough to displace the weakest open
    // position. If not, log and skip.
    if (rotationActive) {
      if (rotationsDoneThisScan >= rotationBudget) {
        summary.blocked++; userSummary.blocked++;
        queueLog({
          user_id: userId, ticker: p.ticker, action: "BLOCKED",
          reason: `Rotation cap reached for today (${rotationCountToday + rotationsDoneThisScan}/${settings.rotation_max_per_day})`,
          conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
        });
        continue;
      }
      if (p.decision.conviction < HIGH_CONVICTION_ROTATION_FLOOR) {
        summary.holds++; userSummary.holds++;
        queueLog({
          user_id: userId, ticker: p.ticker, action: "HOLD",
          reason: `Rotation skipped — conviction ${p.decision.conviction} < floor ${HIGH_CONVICTION_ROTATION_FLOOR}`,
          conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
        });
        continue;
      }
      // Find worst-performing eligible position
      const nowMs = Date.now();
      const ranked = livePositions
        .map(pos => {
          const d = priceCache.get(pos.ticker.toUpperCase());
          if (!d) return null;
          const px = d.close[d.close.length - 1];
          const entry = Number(pos.entry_price);
          const pnlPct = pos.position_type === "long"
            ? ((px - entry) / entry) * 100
            : ((entry - px) / entry) * 100;
          const ageMs = nowMs - new Date(pos.created_at).getTime();
          return { pos, pnlPct, ageMs };
        })
        .filter((r): r is { pos: Position; pnlPct: number; ageMs: number } =>
          !!r && !r.pos.opened_by_rotation && r.ageMs >= MIN_POSITION_AGE_MS && r.pnlPct > 0,
        )
        .sort((a, b) => a.pnlPct - b.pnlPct);
      const worst = ranked[0];
      if (!worst) {
        summary.blocked++; userSummary.blocked++;
        queueLog({
          user_id: userId, ticker: p.ticker, action: "BLOCKED",
          reason: `Rotation skipped — no eligible GREEN position to displace (never rotate on a loss)`,
          conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
        });
        continue;
      }
      const incumbentConv = worst.pos.entry_conviction ?? 0;
      const delta = p.decision.conviction - incumbentConv;
      if (delta < settings.rotation_min_delta_conviction) {
        summary.holds++; userSummary.holds++;
        queueLog({
          user_id: userId, ticker: p.ticker, action: "HOLD",
          reason: `Rotation skipped — Δconv ${delta} < min ${settings.rotation_min_delta_conviction} (incumbent ${worst.pos.ticker} @ conv ${incumbentConv}, P&L ${worst.pnlPct.toFixed(1)}%)`,
          conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
        });
        continue;
      }
      // ROTATE: close worst, open candidate with opened_by_rotation=true
      const worstData = priceCache.get(worst.pos.ticker.toUpperCase())!;
      const worstPx = worstData.close[worstData.close.length - 1];
      const profile = PROFILE_PARAMS[(worst.pos.entry_profile as StockProfile) ?? "normal"];
      const innerSummary = { exits: 0, partials: 0, holds: 0 };
      await executeExit(supabase, worst.pos, {
        kind: "FULL_EXIT",
        price: worstPx,
        reason: `Capital rotation: replaced by ${p.ticker} (Δconv +${delta})`,
      } as ExitAction, profile, innerSummary);
      userSummary.exits += innerSummary.exits;
      // Update live book state
      const removeIdx = livePositions.findIndex(x => x.id === worst.pos.id);
      if (removeIdx >= 0) livePositions.splice(removeIdx, 1);
      heldTickers.delete(worst.pos.ticker.toUpperCase());
      const worstDollars = worstPx * Number(worst.pos.shares);
      totalNavExposureDollars = Math.max(0, totalNavExposureDollars - worstDollars);
      if (sectorCapsActive) {
        const sec = sectorOf.get(worst.pos.ticker.toUpperCase());
        if (sec) sectorDollars.set(sec, Math.max(0, (sectorDollars.get(sec) ?? 0) - worstDollars));
      }
      if (betaCapsActive) {
        let b: number | null;
        try { b = await getBeta(worst.pos.ticker); } catch { b = null; }
        bookBetaDollars = Math.max(0, bookBetaDollars - worstDollars * (b ?? 1));
      }
      rotationsDoneThisScan++;
      cvarBaseDirty = true; // book just lost a position

    }

    // Re-check correlation against the live book — including any positions
    // opened earlier in this same scan loop. Prevents stacking 2 highly
    // correlated names just because both passed the gate independently.
    const liveBook = Array.from(heldTickers);
    if (liveBook.length > 0) {
      const corr = maxCorrelationToBook(p.ticker, liveBook);
      const corrCutoff = adaptiveCorrThreshold(marketRegime, macro?.stressed ? "elevated" : "normal");
      if (corr && corr.maxAbs >= corrCutoff) {
        summary.blocked++; userSummary.blocked++;
        queueLog({
          user_id: userId, ticker: p.ticker, action: "BLOCKED",
          reason: `Correlation gate (intra-scan): |ρ|=${corr.maxAbs.toFixed(2)} vs ${corr.against} ≥ ${corrCutoff.toFixed(2)} (regime-adaptive)`,
          conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
        });
        continue;
      }
    }

    const candidateDollars = p.decision.kellyFraction * settings.starting_nav;

    // ── Sector cap gate (G-5 hard block) ──
    // Sector concentration is a non-negotiable rail when ≥cap, matching the
    // portfolio-heat-cap precedent. Always blocks regardless of
    // enforcement_mode — the warn-mode toggle only applies to portfolio_beta.
    let candidateSector: string | null = null;
    if (sectorCapsActive) {
      try { candidateSector = await getSector(p.ticker); } catch { candidateSector = null; }
      if (candidateSector) {
        const projected = (sectorDollars.get(candidateSector) ?? 0) + candidateDollars;
        const projectedPct = (projected / settings.starting_nav) * 100;
        if (projectedPct > capPct) {
          summary.blocked++; userSummary.blocked++;
          queueLog({
            user_id: userId, ticker: p.ticker, action: "BLOCKED",
            reason: `Sector cap: ${candidateSector} would reach ${projectedPct.toFixed(0)}% NAV (cap ${capPct}%)`,
            conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
          });
          continue;
        }
      }
    }

    // ── Portfolio beta cap gate (Phase 3 #15) ──
    // Weighted portfolio beta = Σ(posDollars × beta) / starting_nav
    // (cash carries beta 0). Block/warn when projected exceeds cap.
    let candidateBeta: number | null = null;
    if (betaCapsActive) {
      try { candidateBeta = await getBeta(p.ticker); } catch { candidateBeta = null; }
      const useBeta = candidateBeta ?? 1;
      const projectedBetaDollars = bookBetaDollars + candidateDollars * useBeta;
      const projectedPortBeta = projectedBetaDollars / settings.starting_nav;
      if (projectedPortBeta > betaCap) {
        if (blockMode) {
          summary.blocked++; userSummary.blocked++;
          queueLog({
            user_id: userId, ticker: p.ticker, action: "BLOCKED",
            reason: `Beta cap: portfolio β would reach ${projectedPortBeta.toFixed(2)} (cap ${betaCap}, ${p.ticker} β=${useBeta.toFixed(2)})`,
            conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
          });
          continue;
        } else {
          queueLog({
            user_id: userId, ticker: p.ticker, action: "WARN",
            reason: `Beta warning: portfolio β → ${projectedPortBeta.toFixed(2)} (cap ${betaCap}, mode=warn)`,
            conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
          });
        }
      }
    }

    // ── Portfolio heat gate ──
    // Candidate $ at risk = |price − hardStop| × shares, shares = $/price
    const candidateRisk = Math.abs(p.decision.price - p.decision.hardStop)
                        * (candidateDollars / p.decision.price);
    const projectedHeatPct = ((openRiskDollars + candidateRisk) / settings.starting_nav) * 100;
    if (projectedHeatPct > PORTFOLIO_HEAT_CAP_PCT) {
      if (blockMode || !caps?.enabled) {
        // Heat is a hard safety rail — block even when caps disabled or in warn mode,
        // because the user explicitly disabling caps doesn't justify a margin call.
        summary.blocked++; userSummary.blocked++;
        queueLog({
          user_id: userId, ticker: p.ticker, action: "BLOCKED",
          reason: `Portfolio heat: open R-risk would reach ${projectedHeatPct.toFixed(1)}% NAV (cap ${PORTFOLIO_HEAT_CAP_PCT}%)`,
          conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
        });
        continue;
      }
    }

    // ── Portfolio CVaR gate (95% Expected Shortfall over 5-day horizon) ──
    // Caps EXPECTED tail loss on the LIVE book at 2% NAV. Hard block: cannot
    // be disabled via enforcement_mode='warn'. Skipped silently when any
    // open position has <20 return obs (cold-start safe).
    if (livePositions.length > 0) {
      try {
        if (cvarBaseDirty) {
          cvarBase = buildCvarBase();
          cvarBaseDirty = false;
        }
        const candD = priceCache.get(p.ticker.toUpperCase());
        if (cvarBase && candD) {
          const candSign = p.decision.decision === "BUY" ? 1 : -1;
          const cvar = computePortfolioCvarMarginal(
            cvarBase,
            {
              ticker: p.ticker,
              dollars: candSign * candidateDollars,
              returns: closeToReturns(candD.close.slice(-61)),
            },
            currentNav,
          );
          if (cvar && cvar.cvarPct > DEFAULT_CVAR_CAP_PCT) {
            summary.blocked++; userSummary.blocked++;
            queueLog({
              user_id: userId, ticker: p.ticker, action: "BLOCKED",
              reason: `Portfolio CVaR: 95% ES would reach ${cvar.cvarPct.toFixed(2)}% NAV (cap ${DEFAULT_CVAR_CAP_PCT}%, worst=${cvar.worstPathPct.toFixed(1)}%)`,
              conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
              cvar_block_count: 1,
            });
            continue;
          }
        }
      } catch (e) { console.warn("cvar gate failed", e); }
    }



    const beforeEntries = summary.entries;
    await executeEntry(supabase, settings, p.ticker, p.decision, summary, rotationActive);
    userSummary.entries += summary.entries - beforeEntries;
    if (summary.entries > beforeEntries) {
      totalNavExposureDollars += candidateDollars;
      openRiskDollars += candidateRisk;
      heldTickers.add(p.ticker);
      if (sectorCapsActive && candidateSector) {
        sectorDollars.set(candidateSector, (sectorDollars.get(candidateSector) ?? 0) + candidateDollars);
      }
      if (betaCapsActive) {
        bookBetaDollars += candidateDollars * (candidateBeta ?? 1);
      }
      // Invalidate CVaR base — the open book just gained a position.
      cvarBaseDirty = true;
    }
  }

  // Drain any queued log inserts from the gate loop. Use allSettled so a
  // single failed write never aborts the scan.
  if (logInserts.length > 0) {
    await Promise.allSettled(logInserts);
    logInserts.length = 0;
  }



  for (const p of deferred) {
    summary.holds++;
    userSummary.holds++;
    await supabase.from("autotrade_log").insert({
      user_id: userId, ticker: p.ticker, action: "HOLD",
      reason: `Deferred — entry stagger cap (${MAX_ENTRIES_PER_SCAN}/scan); will retry next cycle (conviction ${p.decision.conviction})`,
      conviction: p.decision.conviction,
      strategy: p.decision.strategy,
      profile: p.decision.profile,
    });
  }

  for (const p of pending) {
    if (p.kind !== "blocked") continue;
    summary.blocked++;
    userSummary.blocked++;
    await supabase.from("autotrade_log").insert({
      user_id: userId, ticker: p.ticker, action: "BLOCKED", reason: p.decision.reason,
    });
  }

  for (const p of pending) {
    if (p.kind === "hold") { summary.holds++; userSummary.holds++; }
  }

  // ── ADD-ON / RE-ENTRY PASS ──────────────────────────────────────────────
  // Re-query open positions so we see updated trim state written during the
  // exit pass (partial_trim_shares / reentry_deadline). Restricted to this
  // shard so CPU stays bounded across cron shards.
  try {
    const { data: freshPositions } = await supabase
      .from("virtual_positions").select("*")
      .eq("user_id", userId).eq("status", "open");
    const openList = (freshPositions ?? []) as unknown as Position[];
    const openTix = openList.map(p => p.ticker.toUpperCase());
    const nowMs = Date.now();
    const MAX_ADDS_PER_SCAN = 2;
    let addsDone = 0;

    for (const pos of openList) {
      if (addsDone >= MAX_ADDS_PER_SCAN) break;
      const ticker = pos.ticker.toUpperCase();
      if (entryShard.shards > 1 && tickerShard(ticker, entryShard.shards) !== entryShard.shard) continue;
      const data = priceCache.get(ticker);
      if (!data || data.close.length < 200) continue;

      const trimShares = Number(pos.partial_trim_shares ?? 0);
      const deadlineOk = pos.reentry_deadline
        ? new Date(pos.reentry_deadline).getTime() > nowMs
        : false;
      const canReenter = trimShares > 0 && deadlineOk;
      const mode: "ADD_ON" | "RE_ENTRY" = canReenter ? "RE_ENTRY" : "ADD_ON";

      // Portfolio heat + single-name headroom pre-check (cheap gate before
      // running signal engine). Uses starting_nav from settings for heat.
      const stopPx = inferHardStopPrice(pos);
      const currentPx = data.close[data.close.length - 1];
      const posDollars = currentPx * Number(pos.shares);
      const singleNameHeadroomPct = settings.max_single_name_pct - (posDollars / currentNav) * 100;
      if (singleNameHeadroomPct <= 0.5) {
        // Already at single-name cap
        continue;
      }
      const navHeadroomPct = settings.max_nav_exposure_pct - navExposurePct;
      if (navHeadroomPct <= 0.5) continue;

      const decision = await evaluateAddOnCandidate(
        ticker, data, pos, macro, settings,
        danelfinMap, epsRevisionMap, marketRegime, metaModel,
        strategyEdges, metaGate,
        calibrationCurve, strategyTilts, tickerCalibration,
        openTix, mode,
      );

      if (decision.kind === "SKIP") continue;
      if (decision.kind === "BLOCKED") {
        await supabase.from("autotrade_log").insert({
          user_id: userId, ticker, action: "BLOCKED",
          reason: `${mode}: ${decision.reason}`,
        });
        continue;
      }

      // Clamp add dollars to headroom + heat cap
      const maxByHeadroom = Math.min(
        currentNav * (singleNameHeadroomPct / 100),
        currentNav * (navHeadroomPct / 100),
      );
      const stopDist = stopPx != null ? Math.abs(currentPx - stopPx) : currentPx * 0.05;
      const heatBudgetRemaining = Math.max(0, currentNav * 0.06 - openRiskDollars);
      const maxByHeat = stopDist > 0 ? (heatBudgetRemaining / stopDist) * currentPx : maxByHeadroom;
      const cappedDollars = Math.min(decision.addDollars, maxByHeadroom, maxByHeat);
      if (cappedDollars < currentPx) {
        await supabase.from("autotrade_log").insert({
          user_id: userId, ticker, action: "BLOCKED",
          reason: `${mode} blocked: sizing shrunk below 1 share by heat/headroom caps`,
        });
        continue;
      }

      const ok = await executeAddOn(supabase, pos, {
        ...decision,
        addDollars: cappedDollars,
      }, settings);
      if (ok) {
        addsDone++;
        // Update running exposure for subsequent iterations
        const addShares = Math.floor(cappedDollars / currentPx);
        totalNavExposureDollars += addShares * currentPx;
        openRiskDollars += stopDist * addShares;
      }
    }
  } catch (e) {
    console.warn("add-on/re-entry pass failed", e);
  }



  // Portfolio snapshot — true MTM equity (closes audit gap G-2 so the rolling
  // drawdown circuit breaker reacts to UNrealized losses too, not just closed).
  await supabase.from("virtual_portfolio_log").upsert(
    {
      user_id: userId, date: today,
      total_value: currentNav,
      cash: Math.max(0, currentNav - totalNavExposureDollars),
      positions_value: totalNavExposureDollars,
    },
    { onConflict: "user_id,date" },
  );

  // C-2 FIX: flush updated cooldown state back to DB for next invocation.
  await persistTrackerCacheToDB(supabase);
}

// ── Execute helpers ───────────────────────────────────────────────────────
async function executeExit(
  supabase: any,
  pos: Position, action: ExitAction, profile: ProfileParams,
  summary: { exits: number; partials: number; holds: number },
) {
  if (action.kind === "HOLD") {
    summary.holds++;
    // Persist trailing/peak updates if changed
    const updates: Record<string, number> = {};
    if (action.peakUpdate != null && action.peakUpdate !== pos.peak_price) updates.peak_price = action.peakUpdate;
    if (action.trailingUpdate != null && action.trailingUpdate !== pos.trailing_stop_price) updates.trailing_stop_price = action.trailingUpdate;
    if (Object.keys(updates).length > 0) {
      await supabase.from("virtual_positions").update(updates).eq("id", pos.id);
    }
    return;
  }

  const isLong = pos.position_type === "long";
  const entry = Number(pos.entry_price);
  const pnlPct = isLong
    ? ((action.price - entry) / entry) * 100
    : ((entry - action.price) / entry) * 100;

  if (action.kind === "FULL_EXIT") {
    summary.exits++;
    const pnl = isLong
      ? (action.price - entry) * Number(pos.shares)
      : (entry - action.price) * Number(pos.shares);

    // Cooldown: 5–15 trading days based on profile
    const baseCdDays = pos.entry_profile === "value" ? 21
      : pos.entry_profile === "volatile" ? 11
      : pos.entry_profile === "index" ? 7
      : 14;
    // L-3 fix: extend cooldown on losing exits (revenge-entry guard). Stops
    // hit because the thesis broke — re-entering the same name 14d later
    // ignores that, especially in volatile regimes. 1.5x for losses, 2.0x
    // for hard-stop exits (T1 hard_stop / regime breaker).
    const isLossExit = pnl < 0;
    const isHardStop = /hard[_ ]?stop|stop[_ ]?loss|regime[_ ]?breaker|cdar/i.test(action.reason ?? "");
    const cdMult = isHardStop ? 2.0 : isLossExit ? 1.5 : 1.0;
    const cdDays = Math.round(baseCdDays * cdMult);
    const cooldownUntil = new Date(Date.now() + cdDays * 86400000).toISOString();

    await supabase.from("virtual_positions").update({
      status: "closed",
      exit_price: action.price,
      exit_date: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      exit_reason: action.reason,
      pnl,
      cooldown_until: cooldownUntil,
    }).eq("id", pos.id);

    await supabase.from("autotrade_log").insert({
      user_id: pos.user_id, ticker: pos.ticker, action: "FULL_EXIT",
      reason: action.reason, price: action.price, shares: pos.shares,
      pnl_pct: pnlPct, conviction: pos.entry_conviction, strategy: pos.entry_strategy,
      profile: pos.entry_profile, position_id: pos.id,
    });

    // Notify via sell_alerts (existing notification center reads this)
    await supabase.from("sell_alerts").insert({
      user_id: pos.user_id, ticker: pos.ticker,
      reason: `🤖 AutoTrader closed: ${action.reason}`,
      current_price: action.price, position_id: pos.id,
    });
    return;
  }

  if (action.kind === "PARTIAL_EXIT") {
    summary.partials++;
    const sharesToClose = Math.floor(Number(pos.shares) * action.pct);
    if (sharesToClose < 1) return;
    const remaining = Number(pos.shares) - sharesToClose;
    const partialPnl = isLong
      ? (action.price - entry) * sharesToClose
      : (entry - action.price) * sharesToClose;

    // ── Track trimmed slice for potential re-entry ─────────────────────────
    // VWAP-blend across successive R1/R2 trims so re-entry compares against
    // the average price we sold at, not just the last rung.
    const priorTrimShares = Number(pos.partial_trim_shares ?? 0);
    const priorTrimPx = Number(pos.partial_trim_price ?? 0);
    const newTrimShares = priorTrimShares + sharesToClose;
    const newTrimPx = priorTrimShares > 0 && priorTrimPx > 0
      ? (priorTrimPx * priorTrimShares + action.price * sharesToClose) / newTrimShares
      : action.price;
    // Re-entry window scales inversely with volatility (ATR%): low-vol names
    // get up to ~10 trading days, high-vol get ~1 day. Clamp [1..10] days.
    const atrForWindow = Number(pos.entry_atr ?? 0);
    const atrPctApprox = entry > 0 && atrForWindow > 0 ? atrForWindow / entry : 0.02;
    const windowDays = Math.max(1, Math.min(10, Math.round(3 / Math.max(0.005, atrPctApprox))));
    const reentryDeadline = new Date(Date.now() + windowDays * 86400000).toISOString();

    // Reduce shares on the open row
    const partialUpdates: Record<string, unknown> = {
      shares: remaining,
      partial_trim_shares: newTrimShares,
      partial_trim_price: newTrimPx,
      reentry_deadline: reentryDeadline,
    };
    if (action.nextRung != null) partialUpdates.partial_exits_taken = action.nextRung;
    if (action.trailingUpdate != null) partialUpdates.trailing_stop_price = action.trailingUpdate;
    await supabase.from("virtual_positions").update(partialUpdates).eq("id", pos.id);
    // Insert paired closed row for accounting
    await supabase.from("virtual_positions").insert({
      user_id: pos.user_id, ticker: pos.ticker,
      entry_price: entry, shares: sharesToClose,
      position_type: pos.position_type, signal_id: pos.signal_id,
      status: "closed", exit_price: action.price,
      exit_date: new Date().toISOString(), closed_at: new Date().toISOString(),
      exit_reason: `partial: ${action.reason}`, pnl: partialPnl,
      opened_by: pos.opened_by, entry_strategy: pos.entry_strategy,
      entry_profile: pos.entry_profile, entry_conviction: pos.entry_conviction,
    });

    await supabase.from("autotrade_log").insert({
      user_id: pos.user_id, ticker: pos.ticker, action: "PARTIAL_EXIT",
      reason: `${action.reason} | re-entry window: ${windowDays}d`,
      price: action.price, shares: sharesToClose,
      pnl_pct: pnlPct, conviction: pos.entry_conviction, strategy: pos.entry_strategy,
      profile: pos.entry_profile, position_id: pos.id,
    });
  }
}

async function executeEntry(
  supabase: any,
  settings: Settings, ticker: string, e: Extract<EntryAction, { kind: "ENTER" }>,
  summary: { entries: number },
  openedByRotation = false,
) {
  if (!settings.paper_mode) {
    // Live broker integration not implemented in v1
    await supabase.from("autotrade_log").insert({
      user_id: settings.user_id, ticker, action: "BLOCKED",
      reason: "Live mode not yet supported — enable paper_mode",
    });
    return;
  }

  // Market-hours gate: never open new positions when the cash market is closed.
  // Yahoo daily closes are stale outside RTH and would create fictional fills.
  if (!isMarketOpen()) {
    await supabase.from("autotrade_log").insert({
      user_id: settings.user_id, ticker, action: "BLOCKED",
      reason: "Market closed (NYSE 09:30–16:00 ET, Mon–Fri) — entry deferred",
    });
    return;
  }

  // ── LIVE QUOTE: replace stale daily close with a tradable intraday price ──
  // The signal-engine's `e.price` is the last daily-bar close (or moving intraday last
  // from the daily endpoint), which is noisy and prone to single-tick spikes. We refetch
  // the live quote at execution time and use it as the actual fill.
  const live = await fetchLiveQuote(ticker);
  if (!live) {
    await supabase.from("autotrade_log").insert({
      user_id: settings.user_id, ticker, action: "BLOCKED",
      reason: "Live quote unavailable — entry deferred to next scan",
      conviction: e.conviction, strategy: e.strategy, profile: e.profile,
    });
    return;
  }

  // ── SANITY CHECK: reject obviously broken quotes (data glitch / halted / wide gap) ──
  if (live.previousClose && live.previousClose > 0) {
    const gapPct = Math.abs(live.price - live.previousClose) / live.previousClose;
    if (gapPct > 0.08) {
      await supabase.from("autotrade_log").insert({
        user_id: settings.user_id, ticker, action: "BLOCKED",
        reason: `Live quote diverges ${(gapPct * 100).toFixed(1)}% from prev close ($${live.price.toFixed(2)} vs $${live.previousClose.toFixed(2)}) — possible bad tick or halt`,
        price: live.price,
        conviction: e.conviction, strategy: e.strategy, profile: e.profile,
      });
      return;
    }
  }

  // Recompute fill + stop against the live price (preserve the original ATR multiplier).
  const fillPrice = live.price;
  const isLong = e.decision !== "SHORT";
  const stopATRMult = e.atr > 0 ? Math.abs(e.price - e.hardStop) / e.atr : 2;
  const hardStop = isLong
    ? fillPrice - e.atr * stopATRMult
    : fillPrice + e.atr * stopATRMult;

  const dollars = settings.starting_nav * e.kellyFraction;
  const shares = Math.floor(dollars / fillPrice);
  if (shares < 1) return;

  // Direction comes directly from the signal — never parse free-form reasoning.
  const positionType: "long" | "short" = e.decision === "SHORT" ? "short" : "long";

  const { data: ins, error: insErr } = await supabase.from("virtual_positions").insert({
    user_id: settings.user_id, ticker, entry_price: fillPrice, shares,
    position_type: positionType,
    status: "open",
    opened_by: "autotrader",
    opened_by_rotation: openedByRotation,
    entry_atr: e.atr,
    entry_conviction: e.conviction,
    entry_strategy: e.strategy,
    entry_profile: e.profile,
    entry_weekly_alloc: e.weeklyAlloc,
    hard_stop_price: hardStop,
    trailing_stop_price: hardStop,
    peak_price: fillPrice,
    original_shares: shares,
  }).select("id").single();
  if (insErr) {
    // P-4: the partial unique index `uniq_open_position_per_user_ticker` rejects
    // a second open position for the same (user, ticker). A 23505 here means a
    // sibling scan already opened this position — that's the correct outcome,
    // log + bail instead of erroring loudly.
    if ((insErr as { code?: string }).code === "23505") {
      console.log(`[entry] duplicate open suppressed for ${ticker} — sibling scan already opened`);
      return;
    }
    console.error("entry insert failed", insErr); return;
  }
  if (openedByRotation) {
    // Increment per-day counter atomically-enough (single-writer scan loop).
    const today = new Date().toISOString().split("T")[0];
    const { data: cur } = await supabase
      .from("autotrade_settings")
      .select("rotation_count_today, rotation_day")
      .eq("user_id", settings.user_id)
      .maybeSingle();
    const base = cur?.rotation_day === today ? Number(cur?.rotation_count_today ?? 0) : 0;
    await supabase.from("autotrade_settings")
      .update({ rotation_count_today: base + 1, rotation_day: today })
      .eq("user_id", settings.user_id);
  }

  summary.entries++;
  const signalPrice = e.price;
  const slipPct = ((fillPrice - signalPrice) / signalPrice) * 100;
  await supabase.from("autotrade_log").insert({
    user_id: settings.user_id, ticker, action: "ENTRY",
    reason: `${e.reasoning} | live fill $${fillPrice.toFixed(2)} (signal $${signalPrice.toFixed(2)}, ${slipPct >= 0 ? "+" : ""}${slipPct.toFixed(2)}%)`,
    price: fillPrice, shares,
    conviction: e.conviction, strategy: e.strategy, profile: e.profile,
    position_id: ins.id,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
