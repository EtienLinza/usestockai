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
import { getQuoteWithFallback, getEarningsBlackoutDays, getSector } from "../_shared/finnhub.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

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
  signal_id: string | null;
  partial_exits_taken: number;
}

interface Settings {
  user_id: string; enabled: boolean;
  kill_switch: boolean;
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
}

interface AdaptiveContext {
  vix: number | null;
  vixRegime: "calm" | "normal" | "elevated" | "crisis";
  spyTrend: "up" | "down" | "flat";
  recentPnlPct: number;        // last 7-day realized P&L % vs starting NAV
  windowDays: number;
  /** 30-day rolling NAV drawdown % from peak (positive number). */
  rollingDrawdownPct: number;
  adjustments: string[];       // human-readable reasons applied
}

// ── Rolling drawdown circuit breaker (Phase 3 #16) ─────────────────────────
// Hard-block all new entries once trailing 30-day NAV drawdown exceeds this
// threshold. Independent of daily_loss_limit (intraday) and recentPnlPct
// (7-day realized) — catches slow bleeds the other two miss.
const ROLLING_DD_HARD_BLOCK_PCT = 10;

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
const VOL_TARGET_ANNUAL = 0.16;
const VOL_LOOKBACK = 20;
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

function volTargetScalar(macro: MacroContext | null): { scalar: number; spyVol: number | null } {
  if (!macro) return { scalar: 1, spyVol: null };
  const spyVol = realizedVolAnnualized(macro.spyClose, VOL_LOOKBACK);
  if (spyVol == null || spyVol <= 0) return { scalar: 1, spyVol: null };
  const raw = VOL_TARGET_ANNUAL / spyVol;
  const scalar = Math.max(VOL_SCALAR_MIN, Math.min(VOL_SCALAR_MAX, raw));
  return { scalar, spyVol };
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
  };
}

// Autopilot scan cadence — tighter on volatile/open, looser on calm afternoons
function algoScanIntervalMinutes(macro: MacroContext | null, vixRegime: string): number {
  const utcHour = new Date().getUTCHours();
  const nyHour = (utcHour - 4 + 24) % 24;
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
const CORR_THRESHOLD = 0.75;

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
  if (n < 30) return null;
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
  if (candRet.length < 30) return null;

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
      decision: "BUY" | "SHORT" }
  | { kind: "HOLD" | "BLOCKED"; reason: string };

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

  // Trailing-stop ratchet
  const atr = pos.entry_atr ?? 0;
  let trailing = pos.trailing_stop_price ?? pos.hard_stop_price ?? (isLong ? entry * 0.95 : entry * 1.05);
  if (atr > 0) {
    const candidate = isLong
      ? newPeak - atr * profile.trailingStopATRMult
      : newPeak + atr * profile.trailingStopATRMult;
    trailing = isLong ? Math.max(trailing, candidate) : Math.min(trailing, candidate);
  }
  const trailingHit = isLong ? currentPrice <= trailing : currentPrice >= trailing;

  // ── R-multiple partial-exit ladder (Phase 2 #7) ────────────────────────
  // Scale out 1/3 at +1R, another 1/3 at +2R, let runner/peak handle the rest.
  // Tightens trailing to breakeven after rung 1 fires (free trade).
  // Initial risk per share = |entry − hard_stop_price|. Skipped if no hard stop.
  if (pos.hard_stop_price != null && entry > 0) {
    const initRisk = Math.abs(entry - Number(pos.hard_stop_price));
    if (initRisk > 0) {
      const rMult = (isLong ? currentPrice - entry : entry - currentPrice) / initRisk;
      const rung = pos.partial_exits_taken ?? 0;
      if (rung === 0 && rMult >= 1.0) {
        // Rung 1: take ⅓, ratchet trailing to breakeven (entry)
        const newTrail = isLong ? Math.max(trailing, entry) : Math.min(trailing, entry);
        return {
          kind: "PARTIAL_EXIT",
          reason: `R-ladder rung 1: +1R hit (${(pnlPct * 100).toFixed(1)}%), trail → breakeven`,
          pct: 1 / 3,
          price: currentPrice,
          nextRung: 1,
          trailingUpdate: newTrail,
        };
      }
      if (rung === 1 && rMult >= 2.0) {
        // Rung 2: take another ⅓, ratchet trailing to +1R (lock first R)
        const lockPx = isLong ? entry + initRisk : entry - initRisk;
        const newTrail = isLong ? Math.max(trailing, lockPx) : Math.min(trailing, lockPx);
        return {
          kind: "PARTIAL_EXIT",
          reason: `R-ladder rung 2: +2R hit (${(pnlPct * 100).toFixed(1)}%), trail → +1R locked`,
          pct: 0.5, // ½ of remaining = ⅓ of original
          price: currentPrice,
          nextRung: 2,
          trailingUpdate: newTrail,
        };
      }
    }
  }

  // Below +6% we don't try to time a peak — hold or let loss-engine cut
  const MIN_PROFIT_FOR_PEAK = 0.06;
  if (pnlPct < MIN_PROFIT_FOR_PEAK) {
    return { kind: "HOLD", reason: "below peak-detection floor", trailingUpdate: trailing, peakUpdate: newPeak };
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
  liveWeeklyBias: "long" | "short" | "flat" | null,
  liveRsi: number,
): ExitAction | null {
  const isLong = pos.position_type === "long";
  const entry = Number(pos.entry_price);
  const pnlPct = isLong ? (currentPrice - entry) / entry : (entry - currentPrice) / entry;

  // T1: Hard stop — non-negotiable
  if (pos.hard_stop_price != null) {
    const hit = isLong ? currentPrice <= pos.hard_stop_price : currentPrice >= pos.hard_stop_price;
    if (hit) {
      return { kind: "FULL_EXIT", reason: `Hard stop hit (${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
    }
  }

  // T1.5: Intent flip — live engine fires the OPPOSITE side decision (Phase 2 #11).
  // This is a pure-signal exit: the same engine that opened the position now says
  // the trade should reverse. Exit immediately regardless of PnL (the engine
  // already requires high conviction + bias agreement to flip, so it's rare and
  // meaningful). Skips for tiny gains < 0.5% to avoid round-trip churn.
  if (liveDecision && Math.abs(pnlPct) > 0.005) {
    const opposite =
      (isLong && liveDecision === "SHORT") ||
      (!isLong && liveDecision === "BUY");
    if (opposite) {
      return {
        kind: "FULL_EXIT",
        reason: `Engine flipped to ${liveDecision} (intent reversal, pnl ${(pnlPct * 100).toFixed(1)}%)`,
        price: currentPrice,
      };
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
  if (pos.hard_stop_price != null && entry > 0 && barsHeld >= Math.max(3, Math.floor(maxHold / 2))) {
    const initRiskPerShare = Math.abs(entry - Number(pos.hard_stop_price));
    if (initRiskPerShare > 0) {
      const progressR = (isLong ? currentPrice - entry : entry - currentPrice) / initRiskPerShare;
      if (progressR < 0.5) {
        return {
          kind: "FULL_EXIT",
          reason: `R-progress stall: only ${progressR.toFixed(2)}R after ${barsHeld}/${maxHold} bars`,
          price: currentPrice,
        };
      }
    }
  }

  // T3: Time stop
  if (barsHeld >= maxHold) {
    return {
      kind: "FULL_EXIT",
      reason: pnlPct > 0
        ? `Time stop — taking the profit (+${(pnlPct * 100).toFixed(1)}%)`
        : `Time stop — dead capital (${(pnlPct * 100).toFixed(1)}%)`,
      price: currentPrice,
    };
  }

  return null; // no loss-exit triggered
}

function businessDaysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  const days = ms / 86400000;
  return Math.max(1, Math.round(days * (5 / 7)));
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
    if (corr && corr.maxAbs >= CORR_THRESHOLD) {
      return {
        kind: "BLOCKED",
        reason: `Correlation gate: |ρ|=${corr.maxAbs.toFixed(2)} vs ${corr.against} ≥ ${CORR_THRESHOLD} over ${CORR_LOOKBACK_BARS}d`,
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

  const sig = evaluateSignal(data, ticker, undefined, macro);
  if (!sig) return { kind: "HOLD", reason: "Insufficient data" };
  if (sig.decision === "HOLD") return { kind: "HOLD", reason: sig.reasoning };

  // ── Honest conviction calibration (Phase 1 #5) ──────────────────────────
  // Apply the same nightly-learned adjustments the scanner uses so the
  // autotrader's min_conviction gate compares apples-to-apples. Order:
  // strategy tilt × → bucket adjust + → per-ticker adjust +. Clamped 0..100.
  let conviction = sig.conviction;
  const tiltMult = strategyTilts[sig.strategy]?.multiplier ?? 1.0;
  conviction = conviction * tiltMult;
  const bucketAdj = calibrationCurve[bucketKeyAT(conviction)]?.adjust ?? 0;
  conviction = conviction + bucketAdj;
  const tickAdj = tickerCalibration[ticker.toUpperCase()]?.adjust ?? 0;
  conviction = Math.max(0, Math.min(100, Math.round(conviction + tickAdj)));

  if (conviction < settings.min_conviction) {
    return { kind: "HOLD", reason: `Calibrated conviction ${conviction} (raw ${sig.conviction}) < min ${settings.min_conviction}` };
  }

  const effectiveConviction = conviction;

  // Size — apply portfolio-level vol-target scalar (improvement #7) BEFORE
  // single-name and headroom caps so the user-facing caps remain absolute
  // ceilings while sizing breathes with realized SPY vol.
  const headroom = (settings.max_nav_exposure_pct - totalNavExposurePct) / 100;
  const baseFrac = sig.kellyFraction * volScalar;
  const cappedFrac = Math.min(baseFrac, settings.max_single_name_pct / 100, headroom);
  const currentPrice = data.close[data.close.length - 1];
  const targetDollars = settings.starting_nav * cappedFrac;

  if (targetDollars < currentPrice) {
    return { kind: "HOLD", reason: "Position too small after caps" };
  }

  // Hard stop at entry — STRUCTURAL (Phase 2 #10)
  // Pure-ATR stops fire on noise. We anchor the stop to actual market
  // structure: the more conservative (tighter) of swing-low / EMA20 buffer,
  // then clamp the resulting risk into [0.8·ATR, hardStopATRMult·ATR] so
  // we neither stop on a tick nor blow our risk budget.
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
    reasoning: sig.reasoning,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
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

    const settingsRows = (allSettings ?? []).filter((s: any) =>
      s.enabled === true || userIdsWithOpen.has(s.user_id)
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
    const { scalar: volScalar, spyVol } = volTargetScalar(macro);
    if (spyVol != null) {
      console.log(`[autotrader-scan] vol-target: SPY ${VOL_LOOKBACK}d realized vol=${(spyVol*100).toFixed(1)}% → sizing scalar ${volScalar.toFixed(2)}`);
    }
    const regimeFloors = (weightsRes.data?.regime_floors as Record<string, number> | null) ?? null;
    const exitCalibration = (weightsRes.data?.exit_calibration as Record<string, { trailMultAdjust: number }> | null) ?? null;
    const calibrationCurve = (weightsRes.data?.calibration_curve as Record<string, { adjust: number }> | null) ?? {};
    const strategyTilts = (weightsRes.data?.strategy_tilts as Record<string, { multiplier: number }> | null) ?? {};
    const tickerCalibration = (weightsRes.data?.ticker_calibration as Record<string, { adjust: number }> | null) ?? {};

    // 3. Per-user processing — gated by per-user next_scan_at
    const now = new Date();
    let skippedNotDue = 0;
    let skippedKillSwitch = 0;
    for (const settingsRow of settingsRows) {
      const rawSettings = settingsRow as Settings;

      // PER-USER KILL SWITCH — halt entries AND freeze automated exits.
      // User must manage positions manually until they flip it off.
      if (rawSettings.kill_switch) {
        skippedKillSwitch++;
        const nextScan = new Date(now.getTime() + 10 * 60_000);
        await supabase.from("autotrade_settings")
          .update({ last_scan_at: now.toISOString(), next_scan_at: nextScan.toISOString() })
          .eq("user_id", rawSettings.user_id);
        await supabase.from("autotrade_log").insert({
          user_id: rawSettings.user_id,
          ticker: "SCAN",
          action: "KILL_SWITCH",
          reason: "Emergency stop active — no entries, no automated exits. Manage positions manually.",
        });
        continue;
      }

      // Per-user cadence gate
      if (rawSettings.next_scan_at && new Date(rawSettings.next_scan_at) > now) {
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
      // Stale-data safe: if we can't compute it, treat as 0 so we never falsely block.
      let rollingDrawdownPct = 0;
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
        }
      } catch (e) {
        console.warn("[rolling-dd] compute failed", e);
      }

      const adaptiveCtx: AdaptiveContext = {
        vix: vixValue,
        vixRegime,
        spyTrend,
        recentPnlPct,
        windowDays: 7,
        rollingDrawdownPct,
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
        await processUser(supabase, settings, macro, summary, userSummary, exitCalibration, volScalar, calibrationCurve, strategyTilts, tickerCalibration);

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
        const intervalMin = rawSettings.advanced_mode
          ? rawSettings.scan_interval_minutes
          : algoScanIntervalMinutes(macro, vixRegime);
        const nextScan = new Date(now.getTime() + intervalMin * 60_000);
        await supabase.from("autotrade_settings")
          .update({ last_scan_at: now.toISOString(), next_scan_at: nextScan.toISOString() })
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

    await recordHeartbeat(
      "autotrader-scan",
      startedAt,
      "ok",
      `users=${summary.users} entries=${summary.entries} exits=${summary.exits} errors=${summary.errors}`,
    );
    return json({ status: "ok", summary });
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
  supabase: ReturnType<typeof createClient>,
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


async function processUser(
  supabase: ReturnType<typeof createClient>,
  settings: Settings,
  macro: MacroContext | null,
  summary: { entries: number; exits: number; partials: number; holds: number; blocked: number; errors: number },
  userSummary: UserSummary,
  exitCalibration: Record<string, { trailMultAdjust: number }> | null,
  volScalar: number,
  calibrationCurve: Record<string, { adjust: number }>,
  strategyTilts: Record<string, { multiplier: number }>,
  tickerCalibration: Record<string, { adjust: number }>,
) {
  const userId = settings.user_id;

  // Load open positions + watchlist + sector-exposure caps (Phase 3 #14)
  const [posRes, watchRes, capsRes] = await Promise.all([
    supabase.from("virtual_positions").select("*").eq("user_id", userId).eq("status", "open"),
    supabase.from("watchlist").select("ticker, source").eq("user_id", userId).eq("asset_type", "stock"),
    supabase.from("portfolio_caps").select("enabled, enforcement_mode, sector_max_pct").eq("user_id", userId).maybeSingle(),
  ]);
  const positions = (posRes.data ?? []) as unknown as Position[];
  let watchRows = (watchRes.data ?? []) as Array<{ ticker: string; source: string | null }>;
  const caps = (capsRes.data ?? null) as { enabled: boolean; enforcement_mode: string; sector_max_pct: number } | null;

  // ── AUTO-DISCOVERY: pull promising tickers from live_signals into watchlist ──
  if (settings.auto_add_watchlist) {
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
  const allTickers = Array.from(new Set([
    ...positions.map(p => p.ticker.toUpperCase()),
    ...watchlist,
  ]));
  if (allTickers.length === 0) return;

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

  for (const pos of positions) {
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
    let liveWeeklyAlloc = pos.entry_weekly_alloc ?? 0;
    let liveRsi = 50;
    try {
      const sig = evaluateSignal(data, pos.ticker, undefined, macro);
      if (sig) {
        liveBias = sig.weeklyBias.bias;
        liveDecision = sig.decision;
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

    // Run loss + win in priority order (loss wins ties)
    const lossAct = runLossExit(pos, data, currentPrice, profile, liveDecision, liveBias, liveRsi);
    const action: ExitAction = lossAct ?? runWinExit(pos, data, currentPrice, profile, liveWeeklyAlloc);

    const beforeExits = summary.exits, beforePartials = summary.partials, beforeHolds = summary.holds;
    await executeExit(supabase, pos, action, profile, summary);
    userSummary.exits += summary.exits - beforeExits;
    userSummary.partials += summary.partials - beforePartials;
    userSummary.holds += summary.holds - beforeHolds;
  }

  // ── ENTRIES ─────────────────────────────────────────────────────────────
  // Only users with autotrader enabled get new entries. Users with disabled
  // autotrader still benefit from the exit pass above (manual buys auto-close).
  if (!settings.enabled) {
    await supabase.from("virtual_portfolio_log").upsert(
      {
        user_id: userId, date: today,
        total_value: settings.starting_nav + unrealizedToday,
        cash: settings.starting_nav - totalNavExposureDollars,
        positions_value: totalNavExposureDollars,
      },
      { onConflict: "user_id,date" },
    );
    return;
  }
  // Per-user open count: positions that survived the exit pass above.
  // (Was previously using global summary.exits which contaminated user B with user A's exits.)
  const refreshedOpenCount = positions.length - userSummary.exits;
  const navExposurePct = (totalNavExposureDollars / settings.starting_nav) * 100;
  const todayPnlPct = ((realizedToday + unrealizedToday) / settings.starting_nav) * 100;

  const heldTickers = new Set(positions.map(p => p.ticker.toUpperCase()));

  // ── EARLY EXIT — all slots full ───────────────────────────────────────
  // If the user already holds max_positions after the exit pass, skip the entire
  // entry evaluation loop. Saves Yahoo quote fetches, news-sentiment API calls,
  // and per-ticker cooldown queries. New entries can't fit anyway.
  if (refreshedOpenCount >= settings.max_positions) {
    userSummary.holds += Math.max(0, watchlist.length - heldTickers.size);
    await supabase.from("autotrade_log").insert({
      user_id: userId, ticker: "—", action: "BLOCKED",
      reason: `All position slots full (${refreshedOpenCount}/${settings.max_positions}) — entry scan skipped to conserve API calls`,
    });
    return;
  }

  // PASS 1 — gather decisions for every eligible ticker (no DB writes yet).
  // This lets us rank ENTER candidates by conviction and stagger entries
  // (cap at MAX_ENTRIES_PER_SCAN per run) so we don't open 4–8 positions in a
  // single tick at correlated highs.
  const MAX_ENTRIES_PER_SCAN = 2;
  type Pending =
    | { kind: "enter"; ticker: string; decision: Extract<EntryAction, { kind: "ENTER" }> }
    | { kind: "blocked"; ticker: string; decision: Extract<EntryAction, { kind: "BLOCKED" }> }
    | { kind: "hold" };
  const pending: Pending[] = [];

  for (const ticker of watchlist) {
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
      refreshedOpenCount,
      navExposurePct,
      todayPnlPct,
      Array.from(heldTickers),
      volScalar,
      calibrationCurve, strategyTilts, tickerCalibration,
    );

    if (decision.kind === "ENTER") pending.push({ kind: "enter", ticker, decision });
    else if (decision.kind === "BLOCKED") pending.push({ kind: "blocked", ticker, decision });
    else pending.push({ kind: "hold" });
  }

  // PASS 2 — sort ENTER candidates by conviction desc, take top N, defer the rest.
  const enterCandidates = pending
    .filter((p): p is Extract<Pending, { kind: "enter" }> => p.kind === "enter")
    .sort((a, b) => b.decision.conviction - a.decision.conviction);
  const toExecute = enterCandidates.slice(0, MAX_ENTRIES_PER_SCAN);
  const deferred = enterCandidates.slice(MAX_ENTRIES_PER_SCAN);

  // ── Sector exposure map (Phase 3 #14) ───────────────────────────────────
  // Build $-by-sector for currently open positions; we'll incrementally update
  // it as new entries fire so intra-scan stacking respects the cap too.
  const sectorDollars = new Map<string, number>();
  const sectorOf = new Map<string, string | null>();
  const capsActive = !!(caps && caps.enabled && caps.sector_max_pct > 0);
  const capPct = caps?.sector_max_pct ?? 35;
  const blockMode = (caps?.enforcement_mode ?? "warn") === "block";
  if (capsActive) {
    for (const pos of positions) {
      const t = pos.ticker.toUpperCase();
      const data = priceCache.get(t);
      if (!data) continue;
      const px = data.close[data.close.length - 1];
      const dollars = px * Number(pos.shares);
      let sector: string | null;
      try { sector = await getSector(t); } catch { sector = null; }
      sectorOf.set(t, sector);
      if (sector) sectorDollars.set(sector, (sectorDollars.get(sector) ?? 0) + dollars);
    }
  }

  for (const p of toExecute) {
    // Re-check correlation against the live book — including any positions
    // opened earlier in this same scan loop. Prevents stacking 2 highly
    // correlated names just because both passed the gate independently.
    const liveBook = Array.from(heldTickers);
    if (liveBook.length > 0) {
      const corr = maxCorrelationToBook(p.ticker, liveBook);
      if (corr && corr.maxAbs >= CORR_THRESHOLD) {
        summary.blocked++; userSummary.blocked++;
        await supabase.from("autotrade_log").insert({
          user_id: userId, ticker: p.ticker, action: "BLOCKED",
          reason: `Correlation gate (intra-scan): |ρ|=${corr.maxAbs.toFixed(2)} vs ${corr.against} ≥ ${CORR_THRESHOLD}`,
          conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
        });
        continue;
      }
    }

    // ── Sector cap gate ──
    let candidateSector: string | null = null;
    if (capsActive) {
      try { candidateSector = await getSector(p.ticker); } catch { candidateSector = null; }
      if (candidateSector) {
        const candidateDollars = p.decision.kellyFraction * settings.starting_nav;
        const projected = (sectorDollars.get(candidateSector) ?? 0) + candidateDollars;
        const projectedPct = (projected / settings.starting_nav) * 100;
        if (projectedPct > capPct) {
          if (blockMode) {
            summary.blocked++; userSummary.blocked++;
            await supabase.from("autotrade_log").insert({
              user_id: userId, ticker: p.ticker, action: "BLOCKED",
              reason: `Sector cap: ${candidateSector} would reach ${projectedPct.toFixed(0)}% NAV (cap ${capPct}%)`,
              conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
            });
            continue;
          } else {
            await supabase.from("autotrade_log").insert({
              user_id: userId, ticker: p.ticker, action: "WARN",
              reason: `Sector exposure warning: ${candidateSector} → ${projectedPct.toFixed(0)}% NAV (cap ${capPct}%, mode=warn)`,
              conviction: p.decision.conviction, strategy: p.decision.strategy, profile: p.decision.profile,
            });
          }
        }
      }
    }

    const beforeEntries = summary.entries;
    await executeEntry(supabase, settings, p.ticker, p.decision, summary);
    userSummary.entries += summary.entries - beforeEntries;
    if (summary.entries > beforeEntries) {
      const dollars = p.decision.kellyFraction * settings.starting_nav;
      totalNavExposureDollars += dollars;
      heldTickers.add(p.ticker);
      if (capsActive && candidateSector) {
        sectorDollars.set(candidateSector, (sectorDollars.get(candidateSector) ?? 0) + dollars);
      }
    }
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

  // Portfolio snapshot
  await supabase.from("virtual_portfolio_log").upsert(
    {
      user_id: userId, date: today,
      total_value: settings.starting_nav - totalNavExposureDollars + totalNavExposureDollars + unrealizedToday,
      cash: settings.starting_nav - totalNavExposureDollars,
      positions_value: totalNavExposureDollars,
    },
    { onConflict: "user_id,date" },
  );
}

// ── Execute helpers ───────────────────────────────────────────────────────
async function executeExit(
  supabase: ReturnType<typeof createClient>,
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
    const cdDays = pos.entry_profile === "value" ? 21
      : pos.entry_profile === "volatile" ? 11
      : pos.entry_profile === "index" ? 7
      : 14;
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

    // Reduce shares on the open row
    const partialUpdates: Record<string, unknown> = { shares: remaining };
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
      reason: action.reason, price: action.price, shares: sharesToClose,
      pnl_pct: pnlPct, conviction: pos.entry_conviction, strategy: pos.entry_strategy,
      profile: pos.entry_profile, position_id: pos.id,
    });
  }
}

async function executeEntry(
  supabase: ReturnType<typeof createClient>,
  settings: Settings, ticker: string, e: Extract<EntryAction, { kind: "ENTER" }>,
  summary: { entries: number },
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
    entry_atr: e.atr,
    entry_conviction: e.conviction,
    entry_strategy: e.strategy,
    entry_profile: e.profile,
    entry_weekly_alloc: e.weeklyAlloc,
    hard_stop_price: hardStop,
    trailing_stop_price: hardStop,
    peak_price: fillPrice,
  }).select("id").single();
  if (insErr) { console.error("entry insert failed", insErr); return; }

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
