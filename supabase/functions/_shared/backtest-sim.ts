// ============================================================================
// BACKTEST-SIM — portfolio-mode simulator core.
//
// Walks days in chronological order over a universe of tickers, applies a
// simplified but faithful copy of the autotrader gate stack, opens/manages
// positions with an ATR-based R-ladder, and returns updated state + emitted
// trades. Designed to run in CPU-budgeted chunks: caller invokes
// simulateChunk() with a wall-clock budget; when the budget is hit the
// function returns the current cursor and the caller checkpoints & re-invokes.
//
// Reuses the LIVE signal engine via evaluateSignal() so entry decisions match
// the production autotrader within engine-version bounds.
// ============================================================================
import {
  evaluateSignal,
  type DataSet,
  type MacroContext,
} from "./signal-engine-v2.ts";
import {
  computeEffectiveSettings,
  vixRegimeOf,
  spyTrendOf,
  volTargetScalar,
  adaptiveCorrThreshold,
  computeRollingDrawdown,
  ROLLING_DD_HARD_BLOCK_PCT,
  CDAR_HARD_BLOCK_PCT,
  CORR_LOOKBACK_BARS,
  type AdaptiveSettings,
  type AdaptiveContext,
  type RiskProfileName,
} from "./adaptive-context.ts";

export interface SimParams {
  starting_nav: number;
  max_positions: number;
  min_conviction: number;                 // 0..100
  max_single_name_pct: number;            // e.g. 20
  max_nav_exposure_pct: number;           // e.g. 200 (2x)
  portfolio_heat_pct: number;             // e.g. 6 => 6% NAV worst-case
  stop_atr_mult: number;                  // e.g. 2.5
  trail_atr_mult: number;                 // e.g. 2.0
  time_stop_bars: number;                 // e.g. 20
  correlation_cutoff: number;             // e.g. 0.75 (fallback when no adaptive)
  atr_ceiling: Record<string, number>;    // per profile fallback -> 0.06
  allow_shorts: boolean;
  // Adaptive-mode toggle. When true, per-day min_conviction / max_positions /
  // max_nav_exposure / max_single_name / correlation cutoff are computed from
  // the live-shared adaptive engine (VIX/SPY/drawdown/CDaR/profile).
  adaptive_mode: boolean;
  advanced_mode: boolean;
  risk_profile: RiskProfileName;
  daily_loss_limit_pct: number;
}

export const DEFAULT_PARAMS: SimParams = {
  starting_nav: 100_000,
  max_positions: 8,
  min_conviction: 68,
  max_single_name_pct: 20,
  max_nav_exposure_pct: 150,
  portfolio_heat_pct: 6,
  stop_atr_mult: 2.5,
  trail_atr_mult: 2.0,
  time_stop_bars: 20,
  correlation_cutoff: 0.80,
  atr_ceiling: { momentum: 0.06, trend: 0.07, value: 0.05, volatile: 0.10, index: 0.04 },
  allow_shorts: true,
  adaptive_mode: true,
  advanced_mode: false,
  risk_profile: "balanced",
  daily_loss_limit_pct: 3,
};

// Optional inputs to make the sim match live behavior exactly.
export interface AdaptiveInputs {
  // Full SPY history covering the sim window PLUS 200-bar warmup before.
  spyBars: DataSet | null;
  // Full ^VIX history aligned to trading days.
  vixBars: DataSet | null;
  // Active nightly calibration row (strategy_weights.regime_floors etc.).
  regimeFloors: Record<string, number> | null;
  // Optional per-strategy tilts and calibration curve (reserved for future use).
  strategyTilts?: Record<string, { multiplier: number }> | null;
  calibrationCurve?: Record<string, { adjust: number }> | null;
  tickerCalibration?: Record<string, { adjust: number }> | null;
}


export interface Position {
  ticker: string;
  side: "long" | "short";
  shares: number;
  entryPrice: number;
  entryDate: string;
  entryConviction: number;
  hardStop: number;
  trail: number;                          // trailing stop level
  rung: number;                           // 0..3 — how many R-ladder rungs taken
  atr: number;                            // entry-time ATR
  strategy: string;
  profile: string;
  peakR: number;                          // best excursion in R
  barsHeld: number;
}

export interface ClosedTrade {
  ticker: string;
  side: "long" | "short";
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  conviction: number;
  strategy: string;
  profile: string;
  barsHeld: number;
  rMultiple: number;
}

export interface SimState {
  cash: number;
  positions: Position[];
  closedTrades: ClosedTrade[];
  navHistory: { date: string; nav: number }[];
}

export interface SimCursor {
  dayIdx: number;
  totalDays: number;
}

export function initState(params: SimParams): SimState {
  return {
    cash: params.starting_nav,
    positions: [],
    closedTrades: [],
    navHistory: [],
  };
}

// Build a per-ticker sliced DataSet ending at endIdx (inclusive) with a
// minimum lookback the engine needs (200 bars for SMA200).
function sliceDataUpTo(full: DataSet, endIdx: number): DataSet | null {
  if (endIdx < 200) return null;
  const start = Math.max(0, endIdx - 400); // 400 bars is plenty for all indicators
  return {
    timestamps: full.timestamps.slice(start, endIdx + 1),
    open: full.open.slice(start, endIdx + 1),
    high: full.high.slice(start, endIdx + 1),
    low: full.low.slice(start, endIdx + 1),
    close: full.close.slice(start, endIdx + 1),
    volume: full.volume.slice(start, endIdx + 1),
  };
}

// Build union of all trading dates across universe (some tickers may skip days).
export function unionDates(bars: Map<string, DataSet>): string[] {
  const set = new Set<string>();
  for (const d of bars.values()) for (const ts of d.timestamps) set.add(ts);
  return Array.from(set).sort();
}

// Map from date → per-ticker bar index (or -1 if that ticker has no bar that day)
export function buildDateIndex(bars: Map<string, DataSet>, dates: string[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [tk, d] of bars) {
    const m = new Map<string, number>();
    for (let i = 0; i < d.timestamps.length; i++) m.set(d.timestamps[i], i);
    out.set(tk, m);
  }
  // dates isn't used per-ticker; the outer caller iterates `dates`.
  void dates;
  return out;
}

// Simple 60-day return correlation between two aligned close series.
function pearsonReturns(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 20) return 0;
  const ra: number[] = [], rb: number[] = [];
  for (let i = 1; i < n; i++) {
    if (a[i - 1] > 0 && b[i - 1] > 0) {
      ra.push((a[i] - a[i - 1]) / a[i - 1]);
      rb.push((b[i] - b[i - 1]) / b[i - 1]);
    }
  }
  if (ra.length < 20) return 0;
  const mA = ra.reduce((s, x) => s + x, 0) / ra.length;
  const mB = rb.reduce((s, x) => s + x, 0) / rb.length;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < ra.length; i++) {
    const xa = ra[i] - mA, xb = rb[i] - mB;
    num += xa * xb; dA += xa * xa; dB += xb * xb;
  }
  const den = Math.sqrt(dA * dB);
  return den > 0 ? num / den : 0;
}

function maxAbsCorrToBook(
  ticker: string,
  book: Position[],
  bars: Map<string, DataSet>,
  endIdx: Map<string, number>,
): number {
  const dCand = bars.get(ticker);
  const iCand = endIdx.get(ticker);
  if (!dCand || iCand == null || iCand < 60) return 0;
  const candSlice = dCand.close.slice(Math.max(0, iCand - 60), iCand + 1);
  let maxAbs = 0;
  for (const p of book) {
    const dBook = bars.get(p.ticker);
    const iBook = endIdx.get(p.ticker);
    if (!dBook || iBook == null || iBook < 60) continue;
    const bs = dBook.close.slice(Math.max(0, iBook - 60), iBook + 1);
    const c = Math.abs(pearsonReturns(candSlice, bs));
    if (c > maxAbs) maxAbs = c;
  }
  return maxAbs;
}

function openRiskDollars(positions: Position[]): number {
  let r = 0;
  for (const p of positions) {
    r += Math.abs(p.entryPrice - p.hardStop) * p.shares;
  }
  return r;
}

// Manage existing positions for the current bar. Returns updated position list
// (open) plus any closed trades emitted.
function managePositions(
  positions: Position[],
  bars: Map<string, DataSet>,
  endIdx: Map<string, number>,
  date: string,
  params: SimParams,
): { open: Position[]; closed: ClosedTrade[]; cashDelta: number } {
  const open: Position[] = [];
  const closed: ClosedTrade[] = [];
  let cashDelta = 0;

  for (const p of positions) {
    const d = bars.get(p.ticker);
    const i = endIdx.get(p.ticker);
    if (!d || i == null) { open.push(p); continue; }
    const o = d.open[i], h = d.high[i], l = d.low[i], c = d.close[i];
    p.barsHeld += 1;

    const dir = p.side === "long" ? 1 : -1;
    const rDist = Math.abs(p.entryPrice - p.hardStop);
    const excursion = dir * (h - p.entryPrice);
    const rNow = rDist > 0 ? excursion / rDist : 0;
    if (rNow > p.peakR) p.peakR = rNow;

    // Gap-through hard stop → fill at the open
    const gappedStop = p.side === "long" ? o <= p.hardStop : o >= p.hardStop;
    // Intraday hit
    const hitStop = p.side === "long" ? l <= Math.max(p.hardStop, p.trail) : h >= Math.min(p.hardStop, p.trail);

    let exitPx: number | null = null;
    let reason = "";
    if (gappedStop) { exitPx = o; reason = "Gap through stop"; }
    else if (hitStop) {
      const level = p.side === "long" ? Math.max(p.hardStop, p.trail) : Math.min(p.hardStop, p.trail);
      exitPx = level;
      reason = level === p.hardStop ? "Hard stop hit" : "Trailing stop hit";
    }

    if (exitPx == null) {
      // R-ladder scale-outs at 1R, 2R, 3R (33/33/final)
      const rungTargets = [1, 2, 3];
      while (p.rung < 3 && exitPx == null) {
        const rTarget = rungTargets[p.rung];
        const priceTarget = p.entryPrice + dir * rTarget * rDist;
        const hitTarget = p.side === "long" ? h >= priceTarget : l <= priceTarget;
        if (!hitTarget) break;
        const isLast = p.rung === 2;
        const sharesOut = isLast ? p.shares : Math.max(1, Math.floor(p.shares * (1 / 3)));
        const actualOut = Math.min(sharesOut, p.shares);
        const px = priceTarget;
        const pnl = (px - p.entryPrice) * dir * actualOut;
        cashDelta += (p.side === "long" ? px * actualOut : -px * actualOut) + (p.side === "short" ? p.entryPrice * actualOut * 2 : 0);
        // Simplify: cash accounting done in a wrapper — just emit closed trade for the slice.
        closed.push({
          ticker: p.ticker, side: p.side,
          entryDate: p.entryDate, exitDate: date,
          entryPrice: p.entryPrice, exitPrice: px,
          shares: actualOut,
          pnl,
          pnlPct: (px / p.entryPrice - 1) * dir * 100,
          exitReason: `R-ladder ${rTarget}R`,
          conviction: p.entryConviction,
          strategy: p.strategy, profile: p.profile,
          barsHeld: p.barsHeld,
          rMultiple: rTarget,
        });
        p.shares -= actualOut;
        p.rung += 1;
        // After first rung: move stop to breakeven and start trailing
        if (p.rung === 1) {
          if (p.side === "long") p.hardStop = Math.max(p.hardStop, p.entryPrice);
          else p.hardStop = Math.min(p.hardStop, p.entryPrice);
        }
        if (p.shares <= 0) { exitPx = px; reason = "R-ladder final"; break; }
      }

      // Update trailing stop after breakeven
      if (p.shares > 0 && p.rung >= 1) {
        if (p.side === "long") {
          const newTrail = h - params.trail_atr_mult * p.atr;
          if (newTrail > p.trail) p.trail = newTrail;
        } else {
          const newTrail = l + params.trail_atr_mult * p.atr;
          if (p.trail === 0 || newTrail < p.trail) p.trail = newTrail;
        }
      }

      // Time stop
      if (exitPx == null && p.barsHeld >= params.time_stop_bars) {
        exitPx = c;
        reason = `Time stop (${params.time_stop_bars} bars)`;
      }
    }

    if (exitPx != null && p.shares > 0) {
      const pnl = (exitPx - p.entryPrice) * dir * p.shares;
      const rMult = rDist > 0 ? (exitPx - p.entryPrice) * dir / rDist : 0;
      closed.push({
        ticker: p.ticker, side: p.side,
        entryDate: p.entryDate, exitDate: date,
        entryPrice: p.entryPrice, exitPrice: exitPx,
        shares: p.shares,
        pnl,
        pnlPct: (exitPx / p.entryPrice - 1) * dir * 100,
        exitReason: reason,
        conviction: p.entryConviction,
        strategy: p.strategy, profile: p.profile,
        barsHeld: p.barsHeld,
        rMultiple: rMult,
      });
      p.shares = 0;
    }

    if (p.shares > 0) open.push(p);
  }

  // Recompute cashDelta cleanly from closed trades
  cashDelta = 0;
  for (const t of closed) {
    if (t.side === "long") {
      cashDelta += t.exitPrice * t.shares; // sell → +cash (entry cost was already debited at open)
    } else {
      cashDelta -= t.exitPrice * t.shares; // buy-to-cover → -cash (short sale credited at open)
    }
  }
  return { open, closed, cashDelta };
}

// Mark-to-market NAV
function computeNav(state: SimState, bars: Map<string, DataSet>, endIdx: Map<string, number>): number {
  let equity = state.cash;
  for (const p of state.positions) {
    const d = bars.get(p.ticker);
    const i = endIdx.get(p.ticker);
    if (!d || i == null) { equity += p.entryPrice * p.shares * (p.side === "long" ? 1 : -1) * 0; continue; }
    const px = d.close[i];
    if (p.side === "long") equity += px * p.shares;
    else equity += (p.entryPrice - px) * p.shares + p.entryPrice * p.shares; // short: locked-in credit + PnL
  }
  return equity;
}

// Build a MacroContext from SPY bars sliced up to `date` inclusive.
function macroAt(spy: DataSet | null, date: string): MacroContext | null {
  if (!spy) return null;
  const idx = spy.timestamps.findIndex(t => t > date);
  const end = idx === -1 ? spy.timestamps.length : idx;
  if (end < 50) return null;
  return { spyClose: spy.close.slice(0, end) };
}

// VIX value at `date` (last known bar on or before date).
function vixAt(vix: DataSet | null, date: string): number | null {
  if (!vix) return null;
  let val: number | null = null;
  for (let i = 0; i < vix.timestamps.length; i++) {
    if (vix.timestamps[i] <= date) val = vix.close[i];
    else break;
  }
  return val;
}

// Rolling 7-day realized P&L % vs starting NAV (from navHistory tail).
function recentPnl7d(state: SimState, startingNav: number): number {
  const n = state.navHistory.length;
  if (n < 2) return 0;
  const cur = state.navHistory[n - 1].nav;
  const lookback = Math.min(n - 1, 5); // ~5 trading days ≈ 7 cal days
  const past = state.navHistory[n - 1 - lookback].nav;
  return past > 0 ? ((cur - past) / startingNav) * 100 : 0;
}

// One trading day: manage first, then evaluate candidates, then open new
// positions. Uses per-day adaptive settings and per-day vol-target scalar
// so behavior matches the live autotrader exactly.
function stepDay(
  state: SimState,
  bars: Map<string, DataSet>,
  endIdx: Map<string, number>,
  date: string,
  tickers: string[],
  params: SimParams,
  adaptive?: AdaptiveInputs,
): void {
  // 1. Manage existing positions (stops / R-ladder)
  const { open, closed, cashDelta } = managePositions(state.positions, bars, endIdx, date, params);
  state.positions = open;
  state.closedTrades.push(...closed);
  state.cash += cashDelta;

  // 2. Per-day adaptive tuning (live parity)
  const macro = adaptive ? macroAt(adaptive.spyBars, date) : null;
  const vix = adaptive ? vixAt(adaptive.vixBars, date) : null;
  const vixRegime = vixRegimeOf(vix);
  const spyTrend = spyTrendOf(macro);
  const { scalar: volScalar } = volTargetScalar(macro);

  // Rolling drawdown + CDaR over last ~30 NAV points
  const navSeries = state.navHistory.map(n => n.nav);
  const { drawdownPct, cdarPct } = computeRollingDrawdown(navSeries, 30);
  const recentPnlPct = recentPnl7d(state, params.starting_nav);

  const ctx: AdaptiveContext = {
    vix,
    vixRegime,
    spyTrend,
    recentPnlPct,
    windowDays: 7,
    rollingDrawdownPct: drawdownPct,
    rollingCdarPct: cdarPct,
    adjustments: [],
  };

  const baseSettings: AdaptiveSettings = {
    adaptive_mode: params.adaptive_mode,
    advanced_mode: params.advanced_mode,
    risk_profile: params.risk_profile,
    starting_nav: params.starting_nav,
    min_conviction: params.min_conviction,
    max_positions: params.max_positions,
    max_nav_exposure_pct: params.max_nav_exposure_pct,
    max_single_name_pct: params.max_single_name_pct,
    daily_loss_limit_pct: params.daily_loss_limit_pct,
  };
  const eff = computeEffectiveSettings(baseSettings, ctx, adaptive?.regimeFloors ?? null);

  // 3. Circuit breakers (live parity): hard-block new entries under rolling
  // drawdown or CDaR breaches — exits already fired above.
  const entryBlocked = drawdownPct >= ROLLING_DD_HARD_BLOCK_PCT
    || cdarPct >= CDAR_HARD_BLOCK_PCT;

  // 4. Candidate scan
  const nav = computeNav(state, bars, endIdx);
  const heatCapDollars = nav * (params.portfolio_heat_pct / 100);
  let heatUsed = openRiskDollars(state.positions);
  const corrCutoff = adaptive ? adaptiveCorrThreshold(null, vixRegime) : params.correlation_cutoff;

  if (!entryBlocked) {
    for (const ticker of tickers) {
      if (state.positions.length >= eff.max_positions) break;
      if (state.positions.some(p => p.ticker === ticker)) continue;
      const d = bars.get(ticker);
      const i = endIdx.get(ticker);
      if (!d || i == null || i < 200) continue;

      const slice = sliceDataUpTo(d, i);
      if (!slice) continue;

      let sig: any;
      try { sig = evaluateSignal(slice, ticker, macro ?? undefined, null); }
      catch { continue; }
      if (!sig || sig.decision === "HOLD") continue;
      if (!params.allow_shorts && sig.decision === "SHORT") continue;
      if (sig.conviction < eff.min_conviction) continue;

      // ATR ceiling
      const ceiling = params.atr_ceiling[sig.profile] ?? 0.06;
      if (sig.atrPct > ceiling) continue;

      // Correlation gate (adaptive cutoff)
      const corr = maxAbsCorrToBook(ticker, state.positions, bars, endIdx);
      if (corr >= corrCutoff) continue;

      // Sizing — LIVE PARITY: kellyFraction × volScalar, then cap by
      // effective single-name and remaining NAV headroom.
      const currentPrice = d.close[i];
      let curExposure = 0;
      for (const p of state.positions) curExposure += p.entryPrice * p.shares;
      const totalNavExposurePct = (curExposure / Math.max(1, nav)) * 100;
      const headroom = Math.max(0, (eff.max_nav_exposure_pct - totalNavExposurePct) / 100);
      const baseFrac = (sig.kellyFraction ?? 0.05) * volScalar;
      const cappedFrac = Math.max(0, Math.min(baseFrac, eff.max_single_name_pct / 100, headroom));
      if (cappedFrac <= 0) continue;
      const targetDollars = nav * cappedFrac;
      if (targetDollars < currentPrice) continue;

      // Hard stop = stop_atr_mult * ATR from entry
      const dir = sig.decision === "BUY" ? 1 : -1;
      const stopDist = params.stop_atr_mult * sig.atr;
      const hardStop = currentPrice - dir * stopDist;
      const shares = Math.floor(targetDollars / currentPrice);
      if (shares <= 0) continue;

      // Portfolio heat check
      const candidateRisk = stopDist * shares;
      if (heatUsed + candidateRisk > heatCapDollars) continue;

      // Cash check for longs
      const cost = shares * currentPrice;
      if (sig.decision === "BUY" && cost > state.cash) continue;

      state.positions.push({
        ticker,
        side: sig.decision === "BUY" ? "long" : "short",
        shares,
        entryPrice: currentPrice,
        entryDate: date,
        entryConviction: sig.conviction,
        hardStop,
        trail: 0,
        rung: 0,
        atr: sig.atr,
        strategy: sig.strategy,
        profile: sig.profile,
        peakR: 0,
        barsHeld: 0,
      });
      if (sig.decision === "BUY") state.cash -= cost;
      else state.cash += cost;
      heatUsed += candidateRisk;
    }
  }

  state.navHistory.push({ date, nav: computeNav(state, bars, endIdx) });
}

// Public API — run days from cursor.dayIdx forward until CPU budget expires.
// activeWindows: per-ticker inclusive [from, to] date window during which the
// ticker was a member of the target index. Tickers with no window are treated
// as always-active (back-compat for small custom universes).
// adaptive: optional inputs (SPY/VIX/weights) to enable live-parity per-day
// adaptive tuning. Without them the sim uses fixed params (legacy behavior).
export function simulateChunk(
  state: SimState,
  bars: Map<string, DataSet>,
  dates: string[],
  params: SimParams,
  cursor: SimCursor,
  cpuBudgetMs: number,
  activeWindows?: Map<string, { from: string; to: string | null }[]>,
  adaptive?: AdaptiveInputs,
): { state: SimState; cursor: SimCursor; done: boolean } {
  const start = Date.now();
  const endIdxMap = new Map<string, Map<string, number>>();
  for (const [tk, d] of bars) {
    const m = new Map<string, number>();
    for (let i = 0; i < d.timestamps.length; i++) m.set(d.timestamps[i], i);
    endIdxMap.set(tk, m);
  }
  const tickers = Array.from(bars.keys());

  const isActive = (tk: string, date: string): boolean => {
    if (!activeWindows || activeWindows.size === 0) return true;
    const wins = activeWindows.get(tk);
    if (!wins || wins.length === 0) return true;
    for (const w of wins) {
      if (date >= w.from && (w.to == null || date < w.to)) return true;
    }
    return false;
  };

  for (; cursor.dayIdx < dates.length; cursor.dayIdx++) {
    const date = dates[cursor.dayIdx];
    const perTickerIdx = new Map<string, number>();
    const activeTickers: string[] = [];
    for (const tk of tickers) {
      const mi = endIdxMap.get(tk)!;
      const idx = mi.get(date);
      if (idx != null) perTickerIdx.set(tk, idx);
      if (isActive(tk, date)) activeTickers.push(tk);
    }
    if (perTickerIdx.size === 0) continue;
    stepDay(state, bars, perTickerIdx, date, activeTickers, params, adaptive);

    if (cursor.dayIdx % 5 === 0 && Date.now() - start > cpuBudgetMs) {
      cursor.dayIdx += 1;
      return { state, cursor, done: false };
    }
  }
  return { state, cursor, done: true };
}



// Close everything at the last available price → for finalize stage
export function forceCloseAll(state: SimState, bars: Map<string, DataSet>): void {
  for (const p of state.positions) {
    if (p.shares <= 0) continue;
    const d = bars.get(p.ticker);
    if (!d) continue;
    const px = d.close[d.close.length - 1];
    const date = d.timestamps[d.timestamps.length - 1];
    const dir = p.side === "long" ? 1 : -1;
    const rDist = Math.abs(p.entryPrice - p.hardStop);
    const pnl = (px - p.entryPrice) * dir * p.shares;
    state.closedTrades.push({
      ticker: p.ticker, side: p.side,
      entryDate: p.entryDate, exitDate: date,
      entryPrice: p.entryPrice, exitPrice: px,
      shares: p.shares, pnl,
      pnlPct: (px / p.entryPrice - 1) * dir * 100,
      exitReason: "End of backtest (forced close)",
      conviction: p.entryConviction,
      strategy: p.strategy, profile: p.profile,
      barsHeld: p.barsHeld,
      rMultiple: rDist > 0 ? (px - p.entryPrice) * dir / rDist : 0,
    });
    if (p.side === "long") state.cash += px * p.shares;
    else state.cash -= px * p.shares;
  }
  state.positions = [];
}

// Compute final metrics from closedTrades + navHistory
export function computeReport(state: SimState, startNav: number) {
  const trades = state.closedTrades;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const finalNav = state.navHistory.length > 0
    ? state.navHistory[state.navHistory.length - 1].nav
    : startNav;
  const totalReturn = (finalNav / startNav - 1) * 100;
  const winRate = trades.length > 0 ? wins.length / trades.length * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length || 1) : 0;
  // Sharpe from daily NAV returns
  const rets: number[] = [];
  for (let i = 1; i < state.navHistory.length; i++) {
    const prev = state.navHistory[i - 1].nav;
    if (prev > 0) rets.push((state.navHistory[i].nav - prev) / prev);
  }
  const mean = rets.length > 0 ? rets.reduce((s, x) => s + x, 0) / rets.length : 0;
  const variance = rets.length > 1
    ? rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1)
    : 0;
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
  // Max drawdown
  let peak = startNav, mdd = 0;
  for (const n of state.navHistory) {
    if (n.nav > peak) peak = n.nav;
    const dd = (peak - n.nav) / peak;
    if (dd > mdd) mdd = dd;
  }
  const days = state.navHistory.length;
  const years = days / 252;
  const cagr = years > 0 ? (Math.pow(finalNav / startNav, 1 / years) - 1) * 100 : 0;

  // Strategy attribution
  const byStrategy: Record<string, { trades: number; pnl: number; wins: number }> = {};
  for (const t of trades) {
    if (!byStrategy[t.strategy]) byStrategy[t.strategy] = { trades: 0, pnl: 0, wins: 0 };
    byStrategy[t.strategy].trades += 1;
    byStrategy[t.strategy].pnl += t.pnl;
    if (t.pnl > 0) byStrategy[t.strategy].wins += 1;
  }
  const strategyBreakdown = Object.entries(byStrategy).map(([k, v]) => ({
    strategy: k, trades: v.trades, pnl: Number(v.pnl.toFixed(2)),
    winRate: v.trades > 0 ? Number((v.wins / v.trades * 100).toFixed(1)) : 0,
  }));

  return {
    startNav, finalNav: Number(finalNav.toFixed(2)),
    totalReturn: Number(totalReturn.toFixed(2)),
    cagr: Number(cagr.toFixed(2)),
    totalTrades: trades.length,
    winRate: Number(winRate.toFixed(1)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    totalPnl: Number(totalPnl.toFixed(2)),
    sharpeRatio: Number(sharpe.toFixed(2)),
    maxDrawdown: Number((mdd * 100).toFixed(2)),
    tradingDays: days,
    strategyBreakdown,
    equityCurve: state.navHistory.map(n => ({ date: n.date, nav: Number(n.nav.toFixed(2)) })),
    trades: trades.map(t => ({
      ...t,
      pnl: Number(t.pnl.toFixed(2)),
      pnlPct: Number(t.pnlPct.toFixed(2)),
      rMultiple: Number(t.rMultiple.toFixed(2)),
    })),
  };
}
