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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Yahoo fetch with caching (per invocation) ─────────────────────────────
const priceCache = new Map<string, DataSet | null>();

async function fetchYahooData(ticker: string): Promise<DataSet | null> {
  if (priceCache.has(ticker)) return priceCache.get(ticker)!;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) { priceCache.set(ticker, null); return null; }
    const j = await r.json();
    if (j.chart?.error) { priceCache.set(ticker, null); return null; }
    const res = j.chart.result[0];
    const q = res.indicators.quote[0];
    const ts = res.timestamp.map((x: number) => new Date(x * 1000).toISOString().split("T")[0]);
    const ds: DataSet = { timestamps: [], close: [], high: [], low: [], open: [], volume: [] };
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] != null && q.high[i] != null && q.low[i] != null && q.open[i] != null) {
        ds.timestamps.push(ts[i]);
        ds.close.push(q.close[i]); ds.high.push(q.high[i]); ds.low.push(q.low[i]);
        ds.open.push(q.open[i]); ds.volume.push(q.volume[i] || 0);
      }
    }
    priceCache.set(ticker, ds);
    return ds;
  } catch {
    priceCache.set(ticker, null);
    return null;
  }
}

async function batchFetch(tickers: string[]): Promise<void> {
  const need = tickers.filter(t => !priceCache.has(t));
  for (let i = 0; i < need.length; i += 5) {
    const batch = need.slice(i, i + 5);
    await Promise.all(batch.map(fetchYahooData));
    if (i + 5 < need.length) await new Promise(r => setTimeout(r, 200));
  }
}

// ── Live intraday quote (used at entry execution to get an actual fillable price) ──
// Yahoo's /v8/chart with intraday interval returns meta.regularMarketPrice (live, ~15min
// delayed but tradable). The /v7/quote endpoint now requires a crumb cookie so we avoid it.
interface LiveQuote { price: number; previousClose: number | null; marketState: string | null }
async function fetchLiveQuote(ticker: string): Promise<LiveQuote | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") return null;
    return {
      price: meta.regularMarketPrice,
      previousClose: typeof meta.previousClose === "number"
        ? meta.previousClose
        : (typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null),
      marketState: meta.marketState ?? null,
    };
  } catch {
    return null;
  }
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
}

interface AdaptiveContext {
  vix: number | null;
  vixRegime: "calm" | "normal" | "elevated" | "crisis";
  spyTrend: "up" | "down" | "flat";
  recentPnlPct: number;        // last 7-day realized P&L % vs starting NAV
  windowDays: number;
  adjustments: string[];       // human-readable reasons applied
}

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
    switch (ctx.vixRegime) {
      case "calm":
        minConv -= 2; maxPos += 1; maxNav += 5;
        adjustments.push(`calm VIX (${ctx.vix?.toFixed(1) ?? "?"}): −2 conv, +1 pos, +5% NAV`);
        break;
      case "normal":
        // no adjustment
        break;
      case "elevated":
        minConv += 4; maxPos -= 1; maxNav -= 10; maxSingle -= 3;
        adjustments.push(`elevated VIX (${ctx.vix?.toFixed(1) ?? "?"}): +4 conv, −1 pos, −10% NAV`);
        break;
      case "crisis":
        minConv += 10; maxPos = Math.min(maxPos, 3); maxNav = Math.min(maxNav, 40); maxSingle = Math.min(maxSingle, 10);
        adjustments.push(`crisis VIX (${ctx.vix?.toFixed(1) ?? "?"}): +10 conv, hard caps applied`);
        break;
    }

    // ── Layer 2: SPY trend ──
    if (ctx.spyTrend === "down") {
      minConv += 4; maxNav -= 10;
      adjustments.push(`SPY downtrend: +4 conv, −10% NAV`);
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
  | { kind: "PARTIAL_EXIT"; reason: string; pct: number; price: number };

type EntryAction =
  | { kind: "ENTER"; conviction: number; kellyFraction: number; price: number;
      strategy: string; profile: StockProfile; atr: number; hardStop: number;
      weeklyAlloc: number; reasoning: string;
      decision: "BUY" | "SHORT" }
  | { kind: "HOLD" | "BLOCKED"; reason: string };

// ============================================================================
// WIN EXIT — peak detection (5 signals, 3-of-5 fires FULL_EXIT)
// Improvements over the basic ATR-trail:
//   • RSI bearish divergence (5-bar lookback)
//   • Volume climax + close-near-low candle
//   • MACD histogram rollover (2-bar decline)
//   • Strategy-aware thesis completion
//   • Peak detection only kicks in after +6% — below that, just hold/cut
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

  // Hard ceiling: take-profit × 1.5 — always exits regardless of signals
  if (pnlPct >= profile.takeProfitPct / 100 * 1.5) {
    return { kind: "FULL_EXIT", reason: `Hard take-profit ceiling hit (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
  }

  // Below +6% we don't try to time a peak — hold or let loss-engine cut
  const MIN_PROFIT_FOR_PEAK = 0.06;
  if (pnlPct < MIN_PROFIT_FOR_PEAK) {
    return { kind: "HOLD", reason: "below peak-detection floor", trailingUpdate: trailing, peakUpdate: newPeak };
  }

  const n = data.close.length;
  const close = data.close, vol = data.volume;

  // SIGNAL 1: trailing hit
  // (already computed)

  // SIGNAL 2: RSI bearish divergence (long) / bullish divergence (short)
  let rsiDivergence = false;
  const rsi = calculateRSI(close, 14);
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
  const strat = pos.entry_strategy ?? "trend";
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

  // T3: Time stop
  const maxHold = pos.entry_strategy === "mean_reversion"
    ? profile.maxHoldMR
    : pos.entry_strategy === "breakout"
    ? profile.maxHoldBreakout
    : profile.maxHoldTrend;
  const barsHeld = businessDaysSince(pos.created_at);
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
async function runEntryDecision(
  ticker: string,
  data: DataSet,
  macro: MacroContext | null,
  settings: Settings,
  openCount: number,
  totalNavExposurePct: number,
  todayPnlPct: number,
): Promise<EntryAction> {
  // Daily loss limit — block all new entries
  if (todayPnlPct <= -settings.daily_loss_limit_pct) {
    return { kind: "BLOCKED", reason: `Daily loss limit (${todayPnlPct.toFixed(1)}% vs −${settings.daily_loss_limit_pct}% cap)` };
  }
  if (openCount >= settings.max_positions) {
    return { kind: "BLOCKED", reason: `Max positions reached (${openCount}/${settings.max_positions})` };
  }
  if (totalNavExposurePct >= settings.max_nav_exposure_pct) {
    return { kind: "BLOCKED", reason: `NAV exposure cap reached (${totalNavExposurePct.toFixed(0)}% / ${settings.max_nav_exposure_pct}%)` };
  }

  const sig = evaluateSignal(data, ticker, undefined, macro);
  if (!sig) return { kind: "HOLD", reason: "Insufficient data" };
  if (sig.decision === "HOLD") return { kind: "HOLD", reason: sig.reasoning };
  if (sig.conviction < settings.min_conviction) {
    return { kind: "HOLD", reason: `Conviction ${sig.conviction} < min ${settings.min_conviction}` };
  }

  // ── News sentiment layer (only when technicals already passed) ─────────
  let sentiment: SentimentRead | null = null;
  let effectiveConviction = sig.conviction;
  if (settings.use_news_sentiment) {
    sentiment = await getSentiment(ticker);
    if (sentiment) {
      // Hard veto on extreme negative news with high confidence
      if (sentiment.score <= -60 && sentiment.confidence >= 0.7) {
        return {
          kind: "BLOCKED",
          reason: `News veto: ${sentiment.reasoning || "extreme negative sentiment"} (score ${sentiment.score}, conf ${sentiment.confidence.toFixed(2)})`,
          sentiment,
        };
      }
      // Bounded conviction adjustment: -10..+5 (don't chase hype)
      const raw = sentiment.score * 0.1 * sentiment.confidence;
      const adj = Math.max(-10, Math.min(5, raw));
      effectiveConviction = Math.round(sig.conviction + adj);
      if (effectiveConviction < settings.min_conviction) {
        return {
          kind: "HOLD",
          reason: `Conviction after news (${effectiveConviction}) < min ${settings.min_conviction} — ${sentiment.reasoning || "negative drag"}`,
          sentiment,
        };
      }
    }
  }

  // Size
  const headroom = (settings.max_nav_exposure_pct - totalNavExposurePct) / 100;
  const baseFrac = sig.kellyFraction;
  const cappedFrac = Math.min(baseFrac, settings.max_single_name_pct / 100, headroom);
  const currentPrice = data.close[data.close.length - 1];
  const targetDollars = settings.starting_nav * cappedFrac;

  if (targetDollars < currentPrice) {
    return { kind: "HOLD", reason: "Position too small after caps", sentiment };
  }

  // Hard stop at entry
  const profile = PROFILE_PARAMS[sig.profile];
  const params = sig.blendedParams ?? profile;
  const atr = sig.atr;
  const isLong = sig.decision === "BUY";
  const hardStop = isLong
    ? currentPrice - atr * params.hardStopATRMult
    : currentPrice + atr * params.hardStopATRMult;

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
    reasoning: sentiment && sentiment.reasoning
      ? `${sig.reasoning} | news: ${sentiment.reasoning}`
      : sig.reasoning,
    sentiment,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary = { users: 0, entries: 0, exits: 0, partials: 0, holds: 0, blocked: 0, errors: 0 };

  try {
    // 1. Active users
    const { data: settingsRows, error: sErr } = await supabase
      .from("autotrade_settings")
      .select("*")
      .eq("enabled", true);
    if (sErr) throw sErr;
    if (!settingsRows || settingsRows.length === 0) {
      return json({ status: "no-active-users", summary });
    }
    summary.users = settingsRows.length;

    // 2. Pre-fetch SPY + VIX + active calibration weights (shared across users)
    const [spy, vixData, weightsRes] = await Promise.all([
      fetchYahooData("SPY"),
      fetchYahooData("^VIX"),
      supabase.from("strategy_weights").select("regime_floors").eq("is_active", true)
        .order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const macro: MacroContext | null = spy ? { spyClose: spy.close } : null;
    const vixValue: number | null = vixData && vixData.close.length > 0
      ? vixData.close[vixData.close.length - 1]
      : null;
    const vixRegime = vixRegimeOf(vixValue);
    const spyTrend = spyTrendOf(macro);
    const regimeFloors = (weightsRes.data?.regime_floors as Record<string, number> | null) ?? null;

    // 3. Per-user processing — gated by per-user next_scan_at
    const now = new Date();
    let skippedNotDue = 0;
    for (const settingsRow of settingsRows) {
      const rawSettings = settingsRow as Settings;

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

      const adaptiveCtx: AdaptiveContext = {
        vix: vixValue,
        vixRegime,
        spyTrend,
        recentPnlPct,
        windowDays: 7,
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
        await processUser(supabase, settings, macro, summary, userSummary);

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
        console.error(`User ${rawSettings.user_id} failed:`, err);
        summary.errors++;
        await supabase.from("autotrade_log").insert({
          user_id: rawSettings.user_id, ticker: "—", action: "ERROR",
          reason: (err as Error).message ?? "Unknown error",
        });
      }
    }
    (summary as Record<string, unknown>).skipped_not_due = skippedNotDue;

    return json({ status: "ok", summary });
  } catch (err) {
    console.error("AutoTrader top-level error:", err);
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
) {
  const userId = settings.user_id;

  // Load open positions + watchlist
  const [posRes, watchRes] = await Promise.all([
    supabase.from("virtual_positions").select("*").eq("user_id", userId).eq("status", "open"),
    supabase.from("watchlist").select("ticker, source").eq("user_id", userId).eq("asset_type", "stock"),
  ]);
  const positions = (posRes.data ?? []) as unknown as Position[];
  let watchRows = (watchRes.data ?? []) as Array<{ ticker: string; source: string | null }>;

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
  userSummary.evaluated = allTickers.filter(t => {
    const d = priceCache.get(t);
    return d && d.close.length >= 200;
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
    const profile = cls.blendedParams ?? PROFILE_PARAMS[
      (pos.entry_profile as StockProfile) ?? cls.classification
    ];

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
  // Per-user open count: positions that survived the exit pass above.
  // (Was previously using global summary.exits which contaminated user B with user A's exits.)
  const refreshedOpenCount = positions.length - userSummary.exits;
  const navExposurePct = (totalNavExposureDollars / settings.starting_nav) * 100;
  const todayPnlPct = ((realizedToday + unrealizedToday) / settings.starting_nav) * 100;

  const heldTickers = new Set(positions.map(p => p.ticker.toUpperCase()));

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

  for (const p of toExecute) {
    const beforeEntries = summary.entries;
    await executeEntry(supabase, settings, p.ticker, p.decision, summary);
    userSummary.entries += summary.entries - beforeEntries;
    if (summary.entries > beforeEntries) {
      const dollars = p.decision.kellyFraction * settings.starting_nav;
      totalNavExposureDollars += dollars;
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
      sentiment_score: p.decision.sentiment?.score ?? null,
      sentiment_confidence: p.decision.sentiment?.confidence ?? null,
      sentiment_headlines: p.decision.sentiment?.headlines ?? null,
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
    await supabase.from("virtual_positions").update({ shares: remaining }).eq("id", pos.id);
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
    sentiment_score: e.sentiment?.score ?? null,
    sentiment_confidence: e.sentiment?.confidence ?? null,
    sentiment_headlines: e.sentiment?.headlines ?? null,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
