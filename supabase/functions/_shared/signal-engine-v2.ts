// ============================================================================
// SIGNAL ENGINE V2 — SINGLE SOURCE OF TRUTH
// Used by: market-scanner, check-sell-alerts, stock-predict, backtest
//
// This is the canonical signal engine. All four call sites import from here
// so the behaviour you see in the backtest is the same behaviour the live
// autotrader runs. No more "backtest engine" vs "live engine" drift.
//
// Lifted (verbatim where possible) from supabase/functions/backtest/index.ts
// to preserve the exact logic that produced validated backtest results.
// ============================================================================

import {
  calculateEMA,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateVolatility,
  calculateADX,
  calculateStochastic,
  calculateATR,
  safeGet,
} from "./indicators.ts";

// ============================================================================
// SHARED DATA TYPES
// ============================================================================

export type DataSet = {
  timestamps: string[];
  close: number[];
  high: number[];
  low: number[];
  open: number[];
  volume: number[];
};

export type StockProfile = "momentum" | "value" | "index" | "volatile";

export interface WeeklyBias {
  bias: "long" | "flat" | "short";
  targetAllocation: number; // -1.0 to 1.0
}

export interface StockClassification {
  classification: StockProfile;
  trendPersistence: number;
  meanReversionRate: number;
  avgVolatility: number;
  atrPctAvg: number;
  blendedParams?: ProfileParams;
}

export interface ProfileParams {
  adxThreshold: number;
  rsiOversold: number;
  rsiOverbought: number;
  maxHoldTrend: number;
  maxHoldMR: number;
  maxHoldBreakout: number;
  takeProfitPct: number;
  trailingStopATRMult: number;
  buyThreshold: number;
  shortThreshold: number;
  trendConvictionBonus: number;
  mrConvictionBonus: number;
  breakoutConvictionBonus: number;
  weeklyFastMA: number;
  weeklySlowMA: number;
  weeklyRSILong: number;
  hardStopATRMult: number;
}

// ============================================================================
// PROFILE PARAMETERS (canonical, full 16-field record)
// ============================================================================

export const PROFILE_PARAMS: Record<StockProfile, ProfileParams> = {
  momentum: {
    adxThreshold: 20, rsiOversold: 28, rsiOverbought: 72,
    maxHoldTrend: 50, maxHoldMR: 8, maxHoldBreakout: 25,
    takeProfitPct: 16, trailingStopATRMult: 3.0,
    buyThreshold: 68, shortThreshold: 66,
    trendConvictionBonus: 5, mrConvictionBonus: 0, breakoutConvictionBonus: 0,
    weeklyFastMA: 10, weeklySlowMA: 40, weeklyRSILong: 45, hardStopATRMult: 3.0,
  },
  value: {
    adxThreshold: 32, rsiOversold: 22, rsiOverbought: 78,
    maxHoldTrend: 20, maxHoldMR: 18, maxHoldBreakout: 12,
    takeProfitPct: 8, trailingStopATRMult: 2.5,
    buyThreshold: 68, shortThreshold: 66,
    trendConvictionBonus: 0, mrConvictionBonus: 12, breakoutConvictionBonus: 0,
    weeklyFastMA: 13, weeklySlowMA: 50, weeklyRSILong: 35, hardStopATRMult: 2.5,
  },
  index: {
    adxThreshold: 26, rsiOversold: 28, rsiOverbought: 72,
    maxHoldTrend: 40, maxHoldMR: 14, maxHoldBreakout: 18,
    takeProfitPct: 12, trailingStopATRMult: 2.8,
    buyThreshold: 68, shortThreshold: 66,
    trendConvictionBonus: 5, mrConvictionBonus: 5, breakoutConvictionBonus: 0,
    weeklyFastMA: 10, weeklySlowMA: 40, weeklyRSILong: 40, hardStopATRMult: 2.8,
  },
  volatile: {
    adxThreshold: 18, rsiOversold: 22, rsiOverbought: 78,
    maxHoldTrend: 30, maxHoldMR: 6, maxHoldBreakout: 12,
    takeProfitPct: 14, trailingStopATRMult: 3.5,
    buyThreshold: 68, shortThreshold: 66,
    trendConvictionBonus: 0, mrConvictionBonus: 0, breakoutConvictionBonus: 5,
    weeklyFastMA: 8, weeklySlowMA: 30, weeklyRSILong: 50, hardStopATRMult: 3.5,
  },
};

export const INDEX_TICKERS = new Set(["SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "IVV", "RSP"]);

// Backwards-compat: the legacy `PROFILE_WEEKLY_PARAMS` shape used by the
// old shared engine. Derived from the full PROFILE_PARAMS so callers that
// only need {fastMA, slowMA, rsiLong} keep working.
export const PROFILE_WEEKLY_PARAMS: Record<StockProfile, { fastMA: number; slowMA: number; rsiLong: number }> = {
  momentum: { fastMA: PROFILE_PARAMS.momentum.weeklyFastMA, slowMA: PROFILE_PARAMS.momentum.weeklySlowMA, rsiLong: PROFILE_PARAMS.momentum.weeklyRSILong },
  value:    { fastMA: PROFILE_PARAMS.value.weeklyFastMA,    slowMA: PROFILE_PARAMS.value.weeklySlowMA,    rsiLong: PROFILE_PARAMS.value.weeklyRSILong },
  index:    { fastMA: PROFILE_PARAMS.index.weeklyFastMA,    slowMA: PROFILE_PARAMS.index.weeklySlowMA,    rsiLong: PROFILE_PARAMS.index.weeklyRSILong },
  volatile: { fastMA: PROFILE_PARAMS.volatile.weeklyFastMA, slowMA: PROFILE_PARAMS.volatile.weeklySlowMA, rsiLong: PROFILE_PARAMS.volatile.weeklyRSILong },
};

export function blendProfiles(a: ProfileParams, b: ProfileParams, weight: number): ProfileParams {
  const lerp = (x: number, y: number) => x + (y - x) * weight;
  return {
    adxThreshold: Math.round(lerp(a.adxThreshold, b.adxThreshold)),
    rsiOversold: Math.round(lerp(a.rsiOversold, b.rsiOversold)),
    rsiOverbought: Math.round(lerp(a.rsiOverbought, b.rsiOverbought)),
    maxHoldTrend: Math.round(lerp(a.maxHoldTrend, b.maxHoldTrend)),
    maxHoldMR: Math.round(lerp(a.maxHoldMR, b.maxHoldMR)),
    maxHoldBreakout: Math.round(lerp(a.maxHoldBreakout, b.maxHoldBreakout)),
    takeProfitPct: lerp(a.takeProfitPct, b.takeProfitPct),
    trailingStopATRMult: lerp(a.trailingStopATRMult, b.trailingStopATRMult),
    buyThreshold: Math.round(lerp(a.buyThreshold, b.buyThreshold)),
    shortThreshold: Math.round(lerp(a.shortThreshold, b.shortThreshold)),
    trendConvictionBonus: Math.round(lerp(a.trendConvictionBonus, b.trendConvictionBonus)),
    mrConvictionBonus: Math.round(lerp(a.mrConvictionBonus, b.mrConvictionBonus)),
    breakoutConvictionBonus: Math.round(lerp(a.breakoutConvictionBonus, b.breakoutConvictionBonus)),
    weeklyFastMA: Math.round(lerp(a.weeklyFastMA, b.weeklyFastMA)),
    weeklySlowMA: Math.round(lerp(a.weeklySlowMA, b.weeklySlowMA)),
    weeklyRSILong: Math.round(lerp(a.weeklyRSILong, b.weeklyRSILong)),
    hardStopATRMult: lerp(a.hardStopATRMult, b.hardStopATRMult),
  };
}

// ============================================================================
// WEEKLY BAR AGGREGATION
// ============================================================================

export function aggregateToWeekly(data: DataSet): DataSet {
  const weeks: { open: number; high: number; low: number; close: number; volume: number; date: string }[] = [];
  let weekOpen = data.open[0], weekHigh = data.high[0], weekLow = data.low[0];
  let weekVolume = data.volume[0];
  let weekStartDate = data.timestamps[0];

  for (let i = 1; i < data.close.length; i++) {
    const prevDay = new Date(data.timestamps[i - 1]);
    const currDay = new Date(data.timestamps[i]);
    const isNewWeek = currDay.getUTCDay() < prevDay.getUTCDay() || (currDay.getTime() - prevDay.getTime() > 4 * 86400000);

    if (isNewWeek) {
      weeks.push({ open: weekOpen, high: weekHigh, low: weekLow, close: data.close[i - 1], volume: weekVolume, date: weekStartDate });
      weekOpen = data.open[i]; weekHigh = data.high[i]; weekLow = data.low[i];
      weekVolume = data.volume[i]; weekStartDate = data.timestamps[i];
    } else {
      weekHigh = Math.max(weekHigh, data.high[i]);
      weekLow = Math.min(weekLow, data.low[i]);
      weekVolume += data.volume[i];
    }
  }
  weeks.push({ open: weekOpen, high: weekHigh, low: weekLow, close: data.close[data.close.length - 1], volume: weekVolume, date: weekStartDate });

  return {
    timestamps: weeks.map(w => w.date), open: weeks.map(w => w.open),
    high: weeks.map(w => w.high), low: weeks.map(w => w.low),
    close: weeks.map(w => w.close), volume: weeks.map(w => w.volume),
  };
}

// ============================================================================
// STOCK CLASSIFICATION (full version with blended profiles)
// Replaces the broken 3-condition classifyStockSimple. Real value names now
// actually classify as "value" because the gate uses meanReversionRate +
// trendScore instead of three near-impossible simultaneous conditions.
// ============================================================================

export function classifyStock(close: number[], high: number[], low: number[], ticker?: string): StockClassification {
  const n = close.length;

  // 1. Daily returns
  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push((close[i] - close[i - 1]) / close[i - 1]);

  // 2. Average daily volatility (std of returns)
  const retMean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const avgVolatility = Math.sqrt(returns.reduce((a, b) => a + (b - retMean) ** 2, 0) / returns.length);

  // 3. Trend Score: MA alignment + higher-highs
  const sma50 = calculateSMA(close, 50);
  const sma200 = calculateSMA(close, 200);

  // Use a rolling ~1-year window so a stock that was a momentum name 3 years
  // ago doesn't drag on today's classification.
  let maAlignedCount = 0, maValidCount = 0;
  const maStart = Math.max(199, n - 252);
  for (let i = maStart; i < n; i++) {
    if (!isNaN(sma50[i]) && !isNaN(sma200[i])) {
      maValidCount++;
      if (close[i] > sma50[i] && sma50[i] > sma200[i]) maAlignedCount++;
    }
  }
  const maAlignment = maValidCount > 0 ? maAlignedCount / maValidCount : 0;

  const hhWindow = 20;
  let hhCount = 0, hhTotal = 0;
  for (let i = hhWindow * 2; i < n; i += hhWindow) {
    const currentHigh = Math.max(...close.slice(i - hhWindow, i));
    const prevHigh = Math.max(...close.slice(i - hhWindow * 2, i - hhWindow));
    hhTotal++;
    if (currentHigh > prevHigh) hhCount++;
  }
  const higherHighsRatio = hhTotal > 0 ? hhCount / hhTotal : 0.5;
  const trendScore = maAlignment * 0.6 + higherHighsRatio * 0.4;

  // 4. Mean reversion rate: how often RSI extremes revert toward 50
  const rsi = calculateRSI(close, 14);
  let extremeCount = 0, revertCount = 0;
  for (let i = 14; i < n - 5; i++) {
    if (!isNaN(rsi[i]) && (rsi[i] < 30 || rsi[i] > 70)) {
      extremeCount++;
      for (let j = 1; j <= 5 && i + j < n; j++) {
        if (!isNaN(rsi[i + j]) && Math.abs(rsi[i + j] - 50) < Math.abs(rsi[i] - 50) * 0.6) {
          revertCount++;
          break;
        }
      }
    }
  }
  const meanReversionRate = extremeCount > 0 ? revertCount / extremeCount : 0.5;

  // 5. Average ATR as % of price
  const atr = calculateATR(high, low, close, 14);
  let atrPctSum = 0, atrPctCount = 0;
  for (let i = 14; i < n; i++) {
    if (!isNaN(atr[i]) && close[i] > 0) {
      atrPctSum += atr[i] / close[i];
      atrPctCount++;
    }
  }
  const atrPctAvg = atrPctCount > 0 ? atrPctSum / atrPctCount : 0.02;

  // 6. Classification logic with blending zones
  let classification: StockProfile;
  let blendedParams: ProfileParams | undefined;

  if (ticker && INDEX_TICKERS.has(ticker.toUpperCase())) {
    classification = "index";
  } else if (atrPctAvg > 0.025 && trendScore < 0.4) {
    classification = "volatile";
  } else if (trendScore > 0.6) {
    classification = "momentum";
  } else if (trendScore > 0.5) {
    // Blend zone: mix momentum with value/index based on meanReversionRate
    classification = "momentum";
    const secondProfile = meanReversionRate > 0.40 ? "value" : "index";
    const blendWeight = (0.6 - trendScore) / 0.1;
    blendedParams = blendProfiles(PROFILE_PARAMS["momentum"], PROFILE_PARAMS[secondProfile], blendWeight * 0.6);
  } else if (meanReversionRate > 0.40 && trendScore < 0.4) {
    classification = "value";
    if (meanReversionRate < 0.50) {
      const blendWeight = (0.50 - meanReversionRate) / 0.10;
      blendedParams = blendProfiles(PROFILE_PARAMS["value"], PROFILE_PARAMS["index"], blendWeight * 0.4);
    }
  } else {
    classification = "index";
  }

  return { classification, trendPersistence: trendScore, meanReversionRate, avgVolatility, atrPctAvg, blendedParams };
}

// Backwards-compat alias for the simple classifier signature used by the
// previous shared engine. Returns the StockProfile only — callers that need
// the full classification should call classifyStock() directly.
export function classifyStockSimple(close: number[], high: number[], low: number[], ticker: string): StockProfile {
  if (close.length < 200) {
    return INDEX_TICKERS.has(ticker.toUpperCase()) ? "index" : "index";
  }
  return classifyStock(close, high, low, ticker).classification;
}

// ============================================================================
// MACRO CONTEXT — explicit SPY-driven regime filter
// Optional: when callers pass raw SPY closes here, weekly bias and the
// strategy engine will block counter-trend entries automatically.
// ============================================================================

export interface MacroContext {
  /** SPY (or chosen benchmark) daily closes */
  spyClose: number[];
  /** Optional stress flag — set true when VIX > 30 or HYG drawdown is severe */
  stressed?: boolean;
}

/**
 * Returns true when the macro environment permits the requested direction.
 * Long entries are blocked when SPY is below 50- and 200-SMA AND momentum
 * is negative. Short entries are blocked in confirmed bull regimes.
 * Returns true (no block) when ctx is null or insufficient data.
 */
export function macroPermitsEntry(
  direction: "long" | "short",
  ctx: MacroContext | null | undefined,
): boolean {
  if (!ctx || !ctx.spyClose || ctx.spyClose.length < 200) return true;

  const spy = ctx.spyClose;
  const sma50 = calculateSMA(spy, 50);
  const sma200 = calculateSMA(spy, 200);
  const n = spy.length - 1;
  const spyPrice = spy[n];
  const s50 = safeGet(sma50, spyPrice);
  const s200 = safeGet(sma200, spyPrice);
  const spyMomentum = n >= 5 ? (spy[n] - spy[n - 5]) / spy[n - 5] : 0;

  const bearRegime = spyPrice < s50 && spyPrice < s200 && spyMomentum < -0.02;
  const bullRegime = spyPrice > s50 && s50 > s200;

  if (direction === "long" && bearRegime) return false;
  if (direction === "short" && bullRegime) return false;
  if (ctx.stressed && direction === "long") return false;

  return true;
}

// ============================================================================
// WEEKLY BIAS COMPUTATION
// ============================================================================

export function computeWeeklyBias(
  weeklyClose: number[], weeklyHigh: number[], weeklyLow: number[],
  idx: number,
  params: { fastMA: number; slowMA: number; rsiLong: number },
  isLowVol: boolean = false,
  macro: MacroContext | null = null,
): WeeklyBias {
  if (idx < params.slowMA + 10) return { bias: "flat", targetAllocation: 0 };

  const slice = weeklyClose.slice(0, idx + 1);
  const hSlice = weeklyHigh.slice(0, idx + 1);
  const lSlice = weeklyLow.slice(0, idx + 1);
  const fastEMA = calculateEMA(slice, params.fastMA);
  const slowEMA = calculateEMA(slice, params.slowMA);
  const rsi = calculateRSI(slice, 14);
  const adxData = calculateADX(hSlice, lSlice, slice, 14);

  const c = slice[slice.length - 1];
  const fast = safeGet(fastEMA, c);
  const slow = safeGet(slowEMA, c);
  const rsiVal = safeGet(rsi, 50);
  const adxVal = safeGet(adxData.adx, 0);

  // DEFENSIVE MEAN-REVERSION MODE for low-volatility stocks
  if (isLowVol) {
    if (rsiVal < 30 && c > slow && macroPermitsEntry("long", macro))
      return { bias: "long", targetAllocation: 0.75 };
    if (rsiVal < 35 && c > slow && adxVal < 25 && macroPermitsEntry("long", macro))
      return { bias: "long", targetAllocation: 0.5 };
    if (rsiVal > 70 && macroPermitsEntry("short", macro))
      return { bias: "short", targetAllocation: -0.5 }; // symmetric short on overbought low-vol
    if (rsiVal >= 35 && rsiVal <= 65 && c > slow && macroPermitsEntry("long", macro))
      return { bias: "long", targetAllocation: 0.25 };
    return { bias: "flat", targetAllocation: 0 };
  }

  // STANDARD TREND-FOLLOWING MODE
  if (c > fast && fast > slow) {
    if (!macroPermitsEntry("long", macro)) return { bias: "flat", targetAllocation: 0 };
    if (rsiVal >= params.rsiLong && rsiVal <= 75 && adxVal > 20) return { bias: "long", targetAllocation: 1.0 };
    if (rsiVal > 75) return { bias: "long", targetAllocation: 0.25 };
    if (adxVal <= 20 || rsiVal < params.rsiLong) return { bias: "long", targetAllocation: 0.5 };
    return { bias: "long", targetAllocation: 0.5 };
  }

  if (fast > slow && c <= fast && c > slow)
    return macroPermitsEntry("long", macro)
      ? { bias: "long", targetAllocation: 0.25 }
      : { bias: "flat", targetAllocation: 0 };

  // FULLY SYMMETRIC SHORT LADDER (matches long side magnitudes)
  if (c < fast && fast < slow) {
    if (!macroPermitsEntry("short", macro)) return { bias: "flat", targetAllocation: 0 };
    if (rsiVal < 25) return { bias: "short", targetAllocation: -0.25 }; // oversold — reduce
    if (rsiVal < 40 && adxVal > 20) return { bias: "short", targetAllocation: -1.0 };
    if (rsiVal < 50 && adxVal > 15) return { bias: "short", targetAllocation: -0.5 };
    return { bias: "short", targetAllocation: -0.25 };
  }

  // (Removed unreachable bearish-stack short — its condition is a strict subset
  // of the symmetric short ladder above, which already returns either a short
  // or a macro-blocked flat.)

  return { bias: "flat", targetAllocation: 0 };
}

// ============================================================================
// DAILY ENTRY SIGNALS (timing within the weekly trend)
// ============================================================================

export function hasDailyEntrySignal(
  close: number[], high: number[], low: number[], volume: number[],
  idx: number, direction: "long" | "short"
): boolean {
  if (idx < 30) return false;
  const n = Math.min(idx + 1, close.length);
  const slice = close.slice(Math.max(0, n - 60), n);
  if (slice.length < 26) return false;

  const ema12 = calculateEMA(slice, 12);
  const ema26 = calculateEMA(slice, 26);
  const rsi = calculateRSI(slice, 14);
  const macdData = calculateMACD(slice);

  const e12 = safeGet(ema12, 0);
  const e26 = safeGet(ema26, 0);
  const rsiVal = safeGet(rsi, 50);
  const macdH = safeGet(macdData.histogram, 0);

  // Volume confirmation: current bar volume vs 20-bar average
  const volSlice = volume.slice(Math.max(0, n - 20), n);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0;
  const curVol = volume[n - 1] ?? 0;
  const volOK = avgVol === 0 ? true : curVol >= avgVol * 0.7; // soft floor — block only on truly anaemic volume

  // Range expansion: current bar's true range vs 14-bar ATR (intra-day momentum)
  const hSlice = high.slice(Math.max(0, n - 30), n);
  const lSlice = low.slice(Math.max(0, n - 30), n);
  const cSlice = close.slice(Math.max(0, n - 30), n);
  const atr14 = calculateATR(hSlice, lSlice, cSlice, 14);
  const lastATR = safeGet(atr14, 0);
  const todaysRange = (high[n - 1] ?? 0) - (low[n - 1] ?? 0);
  const rangeOK = lastATR === 0 ? true : todaysRange >= lastATR * 0.5; // not a doji-like inside bar

  if (direction === "long") {
    const core = [e12 > e26, rsiVal >= 35 && rsiVal <= 60, macdH > 0].filter(Boolean).length >= 2;
    return core && volOK && rangeOK;
  } else {
    const core = [e12 < e26, rsiVal >= 40 && rsiVal <= 65, macdH < 0].filter(Boolean).length >= 2;
    return core && volOK && rangeOK;
  }
}

// Mean-reversion daily entry for low-vol stocks: RSI pullback confirmation
export function hasDailyMeanReversionEntry(
  close: number[], idx: number, direction: "long" | "short"
): boolean {
  if (idx < 30) return false;
  const n = Math.min(idx + 1, close.length);
  const slice = close.slice(Math.max(0, n - 60), n);
  if (slice.length < 20) return false;

  const rsi = calculateRSI(slice, 14);
  const sma20 = calculateSMA(slice, 20);
  const rsiVal = safeGet(rsi, 50);
  const smaVal = safeGet(sma20, slice[slice.length - 1]);
  const price = slice[slice.length - 1];

  if (direction === "long") {
    // Real pullback: oversold-ish RSI AND price near/below the 20-day mean
    return rsiVal < 40 && price < smaVal * 1.01;
  } else {
    // Real bounce-to-fade: overbought-ish RSI AND price near/above the 20-day mean
    return rsiVal > 60 && price > smaVal * 0.99;
  }
}

// ============================================================================
// MULTI-STRATEGY CONVICTION ENGINE
// Runs trend / mean-reversion / breakout in parallel, picks the highest
// conviction signal. Returns 0–100 conviction, the chosen strategy, the
// volatility-adjusted position size multiplier and the regime label.
// ============================================================================

export interface SignalState {
  lastDirection: "BUY" | "SHORT" | "HOLD";
  consecutiveCount: number;
  cooldownBarsRemaining: number;
}

export function createSignalTracker(): SignalState {
  return { lastDirection: "HOLD", consecutiveCount: 0, cooldownBarsRemaining: 0 };
}

export function computeStrategySignal(
  close: number[], high: number[], low: number[], volume: number[],
  signalState: SignalState, step: number,
  signalParams?: { adxThreshold?: number; rsiOversold?: number; rsiOverbought?: number; buyThreshold?: number; shortThreshold?: number; forceValueMR?: boolean },
  profileBonuses?: { trendConvictionBonus?: number; mrConvictionBonus?: number; breakoutConvictionBonus?: number },
  adaptiveContext?: { spyBearish?: boolean; spySMADeclining?: boolean; isLeader?: boolean }
): {
  consensusScore: number;
  regime: string;
  confidence: number;
  strategy: "trend" | "mean_reversion" | "breakout" | "none";
  positionSizeMultiplier: number;
  atr: number;
} {
  const HOLD_RESULT = (regime: string) => ({
    consensusScore: 0, regime, confidence: 0,
    strategy: "none" as const, positionSizeMultiplier: 1, atr: 0,
  });

  if (signalState.cooldownBarsRemaining > 0) {
    signalState.cooldownBarsRemaining -= step;
    return HOLD_RESULT("cooldown");
  }

  const n = close.length;
  const currentPrice = close[n - 1];

  const ema12 = calculateEMA(close, 12);
  const ema26 = calculateEMA(close, 26);
  const sma50 = calculateSMA(close, 50);
  const sma200 = calculateSMA(close, 200);
  const rsi = calculateRSI(close, 14);
  const macdData = calculateMACD(close);
  const bb = calculateBollingerBands(close, 20, 2);
  const adxData = calculateADX(high, low, close, 14);
  const stochK = calculateStochastic(close, high, low, 14);
  const vol = calculateVolatility(close, 20);
  const atrArr = calculateATR(high, low, close, 14);
  const currentATR = safeGet(atrArr, currentPrice * 0.02);
  const rsiVal = safeGet(rsi, 50);
  const adxVal = safeGet(adxData.adx, 0);
  const pdi = safeGet(adxData.plusDI, 0);
  const mdi = safeGet(adxData.minusDI, 0);
  const e12 = safeGet(ema12, currentPrice);
  const e26 = safeGet(ema26, currentPrice);
  const s50 = safeGet(sma50, currentPrice);
  const s200 = safeGet(sma200, currentPrice);
  const bbU = safeGet(bb.upper, currentPrice * 1.1);
  const bbL = safeGet(bb.lower, currentPrice * 0.9);
  const bbBW = safeGet(bb.bandwidth, 0.1);
  const sk = safeGet(stochK.k, 50);
  const macdH = safeGet(macdData.histogram, 0);
  const prevMacdH = macdData.histogram.length >= 2 ? macdData.histogram[macdData.histogram.length - 2] : 0;
  const currentVol = safeGet(vol, 0.02);

  const volSlice = volume.slice(Math.max(0, n - 20));
  const avgVolume = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
  const currentVolume = volume[n - 1] || 0;
  const volRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  const bwSlice = bb.bandwidth.filter(v => !isNaN(v));
  const bwAvg50 = bwSlice.length >= 50
    ? bwSlice.slice(-50).reduce((a, b) => a + b, 0) / 50
    : bwSlice.length > 0 ? bwSlice.reduce((a, b) => a + b, 0) / bwSlice.length : 0.1;

  const smaDeviation = s50 > 0 ? (currentPrice - s50) / s50 : 0;

  let regime = "neutral";
  if (adxVal > 40 && pdi > mdi && rsiVal > 60) regime = "strong_bullish";
  else if (adxVal > 40 && mdi > pdi && rsiVal < 40) regime = "strong_bearish";
  else if (adxVal > 25 && pdi > mdi) regime = "bullish";
  else if (adxVal > 25 && mdi > pdi) regime = "bearish";
  else if (rsiVal > 70) regime = "overbought";
  else if (rsiVal < 30) regime = "oversold";

  const above200 = currentPrice > s200;
  const below200 = currentPrice < s200;

  let sma200Slope = 0;
  if (sma200.length >= 21 && !isNaN(sma200[sma200.length - 1]) && !isNaN(sma200[sma200.length - 21]) && sma200[sma200.length - 21] > 0) {
    sma200Slope = (sma200[sma200.length - 1] - sma200[sma200.length - 21]) / sma200[sma200.length - 21];
  }
  const sma200Declining = sma200Slope < -0.01;
  const sma200Rising = sma200Slope > 0.01;

  const ctx = adaptiveContext || {};
  const spyConfirmsBear = ctx.spyBearish === true;
  const spySMAConfirmsDeclining = ctx.spySMADeclining === true;
  const dualRegimeBearBlock = below200 && spyConfirmsBear;
  const dualSMADeclining = sma200Declining && spySMAConfirmsDeclining;

  const SP = signalParams || {};
  const ADX_THRESH = SP.adxThreshold ?? 25;
  const RSI_OS = SP.rsiOversold ?? 30;
  const RSI_OB = SP.rsiOverbought ?? 70;
  const CONV_BUY_THRESH = SP.buyThreshold ?? 65;
  const CONV_SHORT_THRESH = SP.shortThreshold ?? 65;

  // OBV (On-Balance Volume) trend confirmation — only the *delta* over the
  // last 20 bars matters, so we sum signed volumes in a single 20-bar pass
  // instead of building an n-length OBV array on every call.
  let obvRising = true;
  if (volume.length >= 21 && close.length >= 21) {
    let obvDelta = 0;
    const start = Math.max(1, close.length - 20);
    for (let oi = start; oi < close.length; oi++) {
      if (close[oi] > close[oi - 1]) obvDelta += volume[oi];
      else if (close[oi] < close[oi - 1]) obvDelta -= volume[oi];
    }
    obvRising = obvDelta >= 0;
  }

  // Bonus pool: bonus magnitude scales with the *strength* of the base signal,
  // not the headroom. A 60-conviction signal earns less from the same pool than
  // an 85-conviction signal — stronger base, larger absolute bonus. Capped at 100.
  const applyBonusPool = (base: number, bonusPool: number, maxPool: number) => {
    if (maxPool <= 0) return base;
    const fillRatio = Math.min(1, bonusPool / maxPool);
    return Math.min(100, base + base * fillRatio * 0.25);
  };

  // --- Strategy A: Trend Following ---
  const forceValueMR = SP.forceValueMR === true;
  let trendSignal: "BUY" | "SHORT" | "HOLD" = "HOLD";
  let trendConviction = 0;
  if (adxVal > ADX_THRESH && !forceValueMR) {
    const trendBuyConditions = [
      e12 > e26,
      currentPrice > s50,
      macdH > 0 && macdH > prevMacdH,
      rsiVal >= 35 && rsiVal <= 75,
    ];
    const trendBuyScore = trendBuyConditions.filter(Boolean).length;

    const trendShortConditions = [
      e12 < e26,
      currentPrice < s50,
      macdH < 0 && macdH < prevMacdH,
      rsiVal >= 25 && rsiVal <= 60,
    ];
    const trendShortScore = trendShortConditions.filter(Boolean).length;

    if (trendBuyScore >= 3 && above200 && !dualSMADeclining && obvRising) {
      trendSignal = "BUY";
      const base = trendBuyScore * 15;
      const adxBonus = Math.min((adxVal - ADX_THRESH) * 0.5, 10);
      const macdBonus = Math.min(Math.abs(macdH) * 5, 8);
      const rsiSweet = (rsiVal >= 40 && rsiVal <= 60) ? 5 : 0;
      trendConviction = applyBonusPool(base, adxBonus + macdBonus + rsiSweet, 23);
    } else if (trendShortScore >= 3 && below200 && !(sma200Rising && ctx.spyBearish === false)) {
      trendSignal = "SHORT";
      const base = trendShortScore * 15;
      const adxBonus = Math.min((adxVal - ADX_THRESH) * 0.5, 10);
      const macdBonus = Math.min(Math.abs(macdH) * 5, 8);
      const rsiSweet = (rsiVal >= 40 && rsiVal <= 55) ? 5 : 0;
      trendConviction = applyBonusPool(base, adxBonus + macdBonus + rsiSweet, 23);
    }
  }

  // --- Strategy B: Mean Reversion ---
  let mrSignal: "BUY" | "SHORT" | "HOLD" = "HOLD";
  let mrConviction = 0;

  // Phase 1 #3 — Breadth-aware divergence over last 20 bars on BOTH RSI and
  // MACD-histogram. Treat each as a discrete contributing rule used across
  // strategies (trend gets a bonus/penalty, breakout gets a confirmation
  // bonus, MR uses it as a scoring condition). Confirmed = both indicators
  // agree, which is the higher-quality variant we weight more heavily.
  let bullishDivergence = false, bearishDivergence = false;
  let bullishDivConfirmed = false, bearishDivConfirmed = false;
  const macdHistArr = macdData.histogram;
  if (n >= 21 && rsi.length >= 21) {
    const argMin = (from: number, toExcl: number) => {
      let mi = from, mv = close[from];
      for (let i = from + 1; i < toExcl; i++) if (close[i] < mv) { mv = close[i]; mi = i; }
      return mi;
    };
    const argMax = (from: number, toExcl: number) => {
      let mi = from, mv = close[from];
      for (let i = from + 1; i < toExcl; i++) if (close[i] > mv) { mv = close[i]; mi = i; }
      return mi;
    };
    const recentLowIdx = argMin(n - 5, n);
    const priorLowIdx  = argMin(n - 20, n - 5);
    const recentHighIdx = argMax(n - 5, n);
    const priorHighIdx  = argMax(n - 20, n - 5);

    const rsiBullDiv =
      !isNaN(rsi[recentLowIdx]) && !isNaN(rsi[priorLowIdx]) &&
      close[recentLowIdx] < close[priorLowIdx] && rsi[recentLowIdx] > rsi[priorLowIdx] + 2;
    const rsiBearDiv =
      !isNaN(rsi[recentHighIdx]) && !isNaN(rsi[priorHighIdx]) &&
      close[recentHighIdx] > close[priorHighIdx] && rsi[recentHighIdx] < rsi[priorHighIdx] - 2;

    // MACD histogram is right-aligned to close (length matches), so index
    // directly. Require a meaningful gap on the histogram (5% of recent |hist|
    // range) so we don't fire on noise.
    let macdBullDiv = false, macdBearDiv = false;
    if (macdHistArr && macdHistArr.length === close.length) {
      const window = macdHistArr.slice(n - 20, n).filter(v => !isNaN(v));
      const histAbsMax = window.length ? Math.max(...window.map(Math.abs)) : 0;
      const eps = Math.max(0.0001, histAbsMax * 0.05);
      const hRecLow = macdHistArr[recentLowIdx], hPrLow = macdHistArr[priorLowIdx];
      const hRecHi  = macdHistArr[recentHighIdx], hPrHi = macdHistArr[priorHighIdx];
      if (!isNaN(hRecLow) && !isNaN(hPrLow) &&
          close[recentLowIdx] < close[priorLowIdx] && hRecLow > hPrLow + eps) macdBullDiv = true;
      if (!isNaN(hRecHi) && !isNaN(hPrHi) &&
          close[recentHighIdx] > close[priorHighIdx] && hRecHi < hPrHi - eps) macdBearDiv = true;
    }

    bullishDivergence = rsiBullDiv || macdBullDiv;
    bearishDivergence = rsiBearDiv || macdBearDiv;
    bullishDivConfirmed = rsiBullDiv && macdBullDiv;
    bearishDivConfirmed = rsiBearDiv && macdBearDiv;
  }

  const mrRsiOverride = rsiVal < RSI_OS || rsiVal > RSI_OB;
  if (adxVal < ADX_THRESH || mrRsiOverride || forceValueMR) {
    const mrConvictionMultiplier = (adxVal >= ADX_THRESH && !forceValueMR && mrRsiOverride) ? 0.8
      : (forceValueMR && adxVal >= ADX_THRESH) ? 0.9 : 1.0;
    const atrDevThreshold = currentPrice > 0 ? (1.5 * currentATR) / currentPrice : 0.02;
    const mrBuyConditions = [
      rsiVal < RSI_OS,
      currentPrice < bbL,
      smaDeviation < -atrDevThreshold,
      sk < 20,
      volRatio > 1.2,
      bullishDivergence, // Phase 1 #3
    ];
    const mrBuyScore = mrBuyConditions.filter(Boolean).length;

    const mrShortConditions = [
      rsiVal > RSI_OB,
      currentPrice > bbU,
      smaDeviation > atrDevThreshold,
      sk > 80,
      volRatio > 1.2,
      bearishDivergence, // Phase 1 #3
    ];
    const mrShortScore = mrShortConditions.filter(Boolean).length;

    const mrMinScore = forceValueMR ? 2 : 3;

    if (mrBuyScore >= mrMinScore && !dualRegimeBearBlock) {
      mrSignal = "BUY";
      const base = mrBuyScore * 14; // slightly reduced per-condition weight (was 16) since pool is now 6 not 5
      const rsiBonus = Math.min(Math.abs(rsiVal - 50) * 0.3, 10);
      const smaBonus = Math.min(Math.abs(smaDeviation) * 100, 10);
      const divBonus = bullishDivergence ? 6 : 0;
      const pooled = applyBonusPool(base, rsiBonus + smaBonus + divBonus, 26);
      mrConviction = Math.round(pooled * mrConvictionMultiplier);
    } else if (mrShortScore >= mrMinScore && !(above200 && ctx.spyBearish === false)) {
      mrSignal = "SHORT";
      const base = mrShortScore * 14;
      const rsiBonus = Math.min(Math.abs(rsiVal - 50) * 0.3, 10);
      const smaBonus = Math.min(Math.abs(smaDeviation) * 100, 10);
      const divBonus = bearishDivergence ? 6 : 0;
      const pooled = applyBonusPool(base, rsiBonus + smaBonus + divBonus, 26);
      mrConviction = Math.round(pooled * mrConvictionMultiplier);
    }
  }

  // --- Strategy C: Breakout ---
  let boSignal: "BUY" | "SHORT" | "HOLD" = "HOLD";
  let boConviction = 0;
  const isSqueeze = bbBW < bwAvg50 * 0.7;
  if (isSqueeze) {
    const adxRising = adxData.adx.length >= 3
      && !isNaN(adxData.adx[adxData.adx.length - 1])
      && !isNaN(adxData.adx[adxData.adx.length - 3])
      && adxData.adx[adxData.adx.length - 1] > adxData.adx[adxData.adx.length - 3];

    const currentRange = high[n - 1] - low[n - 1];
    const rangeExpansion = currentRange > 1.5 * currentATR;
    const hasVolumeConfirm = volRatio > 1.5;
    const hasBreakoutFilter = hasVolumeConfirm || rangeExpansion;

    if (currentPrice > bbU && adxRising && hasBreakoutFilter) {
      boSignal = "BUY";
      const base = 50;
      const volBonus = Math.min((volRatio - 1) * 20, 25);
      const rngBonus = Math.min((currentRange / currentATR - 1) * 20, 25);
      boConviction = applyBonusPool(base, volBonus + rngBonus, 50);
    } else if (currentPrice < bbL && adxRising && hasBreakoutFilter) {
      boSignal = "SHORT";
      const base = 50;
      const volBonus = Math.min((volRatio - 1) * 20, 25);
      const rngBonus = Math.min((currentRange / currentATR - 1) * 20, 25);
      boConviction = applyBonusPool(base, volBonus + rngBonus, 50);
    }
  }

  // Phase 1 #3 — Apply divergence as a discrete cross-strategy modifier on
  // Trend and Breakout (MR already uses it as a scoring condition above).
  // Confirmed (RSI + MACD agree) doubles the bonus / deepens the penalty.
  const divBonusBase = 6;
  const divPenaltyMult = 0.85;
  const divPenaltyMultConfirmed = 0.75;
  const applyDiv = (sig: "BUY" | "SHORT" | "HOLD", conv: number): number => {
    if (sig === "HOLD" || conv <= 0) return conv;
    if (sig === "BUY") {
      if (bullishDivergence) {
        const bonus = bullishDivConfirmed ? divBonusBase * 2 : divBonusBase;
        return applyBonusPool(conv, bonus, 12);
      }
      if (bearishDivergence) {
        return conv * (bearishDivConfirmed ? divPenaltyMultConfirmed : divPenaltyMult);
      }
    } else { // SHORT
      if (bearishDivergence) {
        const bonus = bearishDivConfirmed ? divBonusBase * 2 : divBonusBase;
        return applyBonusPool(conv, bonus, 12);
      }
      if (bullishDivergence) {
        return conv * (bullishDivConfirmed ? divPenaltyMultConfirmed : divPenaltyMult);
      }
    }
    return conv;
  };
  trendConviction = applyDiv(trendSignal, trendConviction);
  boConviction = applyDiv(boSignal, boConviction);

  // Profile-specific conviction bonuses (pooled, not raw additive)
  const pb = profileBonuses || {};
  if (trendSignal !== "HOLD" && pb.trendConvictionBonus) {
    trendConviction = applyBonusPool(trendConviction, pb.trendConvictionBonus, 15);
  }
  if (mrSignal !== "HOLD" && pb.mrConvictionBonus) {
    mrConviction = applyBonusPool(mrConviction, pb.mrConvictionBonus, 15);
  }
  if (boSignal !== "HOLD" && pb.breakoutConvictionBonus) {
    boConviction = applyBonusPool(boConviction, pb.breakoutConvictionBonus, 15);
  }

  // Select best strategy by conviction
  let bestSignal: "BUY" | "SHORT" | "HOLD" = "HOLD";
  let bestConviction = 0;
  let bestStrategy: "trend" | "mean_reversion" | "breakout" | "none" = "none";

  if (trendConviction > bestConviction && trendSignal !== "HOLD") {
    bestSignal = trendSignal; bestConviction = trendConviction; bestStrategy = "trend";
  }
  if (mrConviction > bestConviction && mrSignal !== "HOLD") {
    bestSignal = mrSignal; bestConviction = mrConviction; bestStrategy = "mean_reversion";
  }
  if (boConviction > bestConviction && boSignal !== "HOLD") {
    bestSignal = boSignal; bestConviction = boConviction; bestStrategy = "breakout";
  }

  if (bestSignal === "HOLD") {
    signalState.lastDirection = "HOLD";
    signalState.consecutiveCount = 0;
    return HOLD_RESULT(regime);
  }

  // Counter-trend penalty
  let adjustedConviction = bestConviction;
  const isBearishRegime = regime === "bearish" || regime === "strong_bearish";
  const isBullishRegime = regime === "bullish" || regime === "strong_bullish";
  const isLeader = ctx.isLeader === true;

  if (bestSignal === "BUY" && isBearishRegime && !isLeader) {
    adjustedConviction *= 0.7;
  } else if (bestSignal === "SHORT" && isBullishRegime && !isLeader) {
    adjustedConviction *= 0.7;
  }

  // Own-trend bonus pooled
  if (above200 && sma200Slope > 0.02 && rsiVal > 40 && rsiVal < 70 && bestSignal === "BUY") {
    adjustedConviction = applyBonusPool(adjustedConviction, 8, 8);
  }
  if (below200 && sma200Slope < -0.02 && rsiVal > 30 && rsiVal < 60 && bestSignal === "SHORT") {
    adjustedConviction = applyBonusPool(adjustedConviction, 8, 8);
  }

  const cappedConviction = Math.min(100, adjustedConviction);
  const convThresh = bestSignal === "BUY" ? CONV_BUY_THRESH : CONV_SHORT_THRESH;
  if (cappedConviction < convThresh) {
    signalState.lastDirection = "HOLD";
    signalState.consecutiveCount = 0;
    return HOLD_RESULT(regime);
  }

  signalState.lastDirection = bestSignal;
  signalState.consecutiveCount = 1;

  const TARGET_VOL = 0.015;
  let positionSizeMultiplier = currentVol > 0 ? TARGET_VOL / currentVol : 1;
  positionSizeMultiplier *= 0.7 + (cappedConviction / 100) * 0.8;
  positionSizeMultiplier = Math.max(0.25, Math.min(2.0, positionSizeMultiplier));

  const consensusScore = bestSignal === "BUY" ? cappedConviction : -cappedConviction;

  let confidence = cappedConviction;
  if (regime.includes("strong")) confidence += 3;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return { consensusScore, regime, confidence, strategy: bestStrategy, positionSizeMultiplier, atr: currentATR };
}

// (EvaluateSignalResult is declared once below — single canonical interface.)

// ============================================================================
// POSITION SIZING — volatility-targeted Kelly
// Optional alternative to the strategy engine's positionSizeMultiplier.
// Returns a fraction of NAV (signed) suitable for a single-name allocation.
// Maps conviction 60–100 → Kelly fraction 0.10–0.25, then scales by ATR%
// to target a constant per-name daily vol contribution.
// ============================================================================

export function computePositionSize(
  conviction: number,
  atrPct: number,
  direction: "long" | "short",
  targetVol: number = 0.01,
): number {
  if (conviction < 60 || atrPct <= 0) return 0;
  const kellyBase = 0.10 + ((conviction - 60) / 40) * 0.15;
  const volScalar = Math.min(1.5, targetVol / atrPct);
  const raw = kellyBase * volScalar;
  const capped = Math.min(0.25, Math.max(0, raw));
  return direction === "short" ? -capped : capped;
}

// ============================================================================
// EVALUATE SIGNAL — top-level convenience function
// Combines weekly bias (macro filter) + daily strategy signal (entry timing
// with conviction) + adaptive context. The single function the scanner,
// sell-alerts, predict and backtest can all call to get the canonical
// trade decision for a ticker.
//
// SIZING: returns a single sizing output — `kellyFraction` (signed NAV
// fraction, range -0.25 … +0.25). The legacy `positionSizeMultiplier` has
// been removed to avoid two conflicting sizing systems. Multi-name
// portfolios should size positions directly from `kellyFraction`.
// ============================================================================

export interface EvaluateSignalResult {
  decision: "BUY" | "SHORT" | "HOLD";
  conviction: number;        // 0–100
  weeklyBias: WeeklyBias;
  profile: StockProfile;
  blendedParams: ProfileParams;
  strategy: "trend" | "mean_reversion" | "breakout" | "none";
  regime: string;
  /** Volatility-targeted Kelly fraction — single canonical sizing output.
   *  Range: 0…+0.25 for longs, 0…-0.25 for shorts. 0 when no entry. */
  kellyFraction: number;
  atr: number;
  atrPct: number;
  reasoning: string;
}

// ----------------------------------------------------------------------------
// Per-ticker signal tracker cache (in-memory, persists across evaluateSignal
// calls within the same edge-function invocation). Keeps cooldownBarsRemaining
// alive between bars so the cooldown actually fires instead of resetting to 0
// on every call. Callers that need cross-invocation persistence (e.g. the live
// scanner across cron runs) should pass their own tracker explicitly.
// ----------------------------------------------------------------------------
const signalTrackerCache = new Map<string, SignalState>();

export function getOrCreateTracker(ticker: string): SignalState {
  const key = ticker.toUpperCase();
  let t = signalTrackerCache.get(key);
  if (!t) {
    t = createSignalTracker();
    signalTrackerCache.set(key, t);
  }
  return t;
}

export function clearTrackerCache() {
  signalTrackerCache.clear();
}

export function evaluateSignal(
  data: DataSet,
  ticker: string,
  adaptiveContext?: { spyBearish?: boolean; spySMADeclining?: boolean; isLeader?: boolean },
  macro?: MacroContext | null,
  /** Optional caller-supplied tracker for cooldown persistence across runs.
   *  When omitted, a per-ticker in-memory tracker is used (lives for the
   *  duration of the edge-function invocation). */
  tracker?: SignalState,
): EvaluateSignalResult | null {
  if (data.close.length < 200) return null;

  // 1. Classify the stock (full blended classifier)
  const cls = classifyStock(data.close, data.high, data.low, ticker);
  const activeProfile = cls.blendedParams || PROFILE_PARAMS[cls.classification];

  // 2. Aggregate to weekly + compute weekly bias
  const weekly = aggregateToWeekly(data);
  const wIdx = weekly.close.length - 1;

  // Low-vol detection: weekly ATR% < 2%
  const wATR = calculateATR(weekly.high, weekly.low, weekly.close, 14);
  let wAtrPctSum = 0, wAtrPctCount = 0;
  for (let wi = 14; wi < weekly.close.length; wi++) {
    if (!isNaN(wATR[wi]) && weekly.close[wi] > 0) {
      wAtrPctSum += wATR[wi] / weekly.close[wi]; wAtrPctCount++;
    }
  }
  const isLowVol = wAtrPctCount > 0 && (wAtrPctSum / wAtrPctCount) < 0.02;

  if (wIdx < Math.max(activeProfile.weeklySlowMA, 40) + 10) return null;

  const weeklyBias = computeWeeklyBias(
    weekly.close, weekly.high, weekly.low, wIdx,
    { fastMA: activeProfile.weeklyFastMA, slowMA: activeProfile.weeklySlowMA, rsiLong: activeProfile.weeklyRSILong },
    isLowVol,
    macro ?? null,
  );

  // Daily ATR % for Kelly sizing
  const dATR = calculateATR(data.high, data.low, data.close, 14);
  const dLast = data.close[data.close.length - 1];
  const atrPctNow = dLast > 0 ? safeGet(dATR, dLast * 0.02) / dLast : 0.02;

  if (weeklyBias.bias === "flat") {
    return {
      decision: "HOLD",
      conviction: 0,
      weeklyBias,
      profile: cls.classification,
      blendedParams: activeProfile,
      strategy: "none",
      regime: "neutral",
      kellyFraction: 0,
      atr: 0,
      atrPct: atrPctNow,
      reasoning: "Weekly bias flat — no trend",
    };
  }

  // 3. Compute multi-strategy conviction signal — use a *persistent* tracker so
  //    cooldownBarsRemaining actually carries between calls.
  const activeTracker = tracker ?? getOrCreateTracker(ticker);
  const sig = computeStrategySignal(
    data.close, data.high, data.low, data.volume,
    activeTracker, 1,
    {
      adxThreshold: activeProfile.adxThreshold,
      rsiOversold: activeProfile.rsiOversold,
      rsiOverbought: activeProfile.rsiOverbought,
      buyThreshold: activeProfile.buyThreshold,
      shortThreshold: activeProfile.shortThreshold,
      forceValueMR: cls.classification === "value",
    },
    {
      trendConvictionBonus: activeProfile.trendConvictionBonus,
      mrConvictionBonus: activeProfile.mrConvictionBonus,
      breakoutConvictionBonus: activeProfile.breakoutConvictionBonus,
    },
    adaptiveContext,
  );

  // Phase 1 #2 — Volume z-score conviction modifier (in-engine so backtest
  // and live share identical math). Today's volume vs the prior 20-bar mean,
  // clipped to z ∈ [-2, 2] → conviction adj ∈ [-5, +5].
  if (sig.confidence > 0 && data.volume.length >= 21) {
    const vol = data.volume;
    const recent = vol.slice(-21, -1);
    const today = vol[vol.length - 1] || 0;
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
    const std = Math.sqrt(variance);
    if (std > 0 && mean > 0) {
      const z = Math.max(-2, Math.min(2, (today - mean) / std));
      const volAdj = Math.round(z * 2.5);
      if (volAdj !== 0) {
        sig.confidence = Math.max(0, Math.min(100, sig.confidence + volAdj));
      }
    }
  }

  // 4. Cross-check daily entry signal with the weekly bias direction
  const lastIdx = data.close.length - 1;
  const targetDir: "long" | "short" = weeklyBias.bias === "long" ? "long" : "short";
  const dailyEntry = isLowVol
    ? hasDailyMeanReversionEntry(data.close, lastIdx, targetDir)
    : hasDailyEntrySignal(data.close, data.high, data.low, data.volume, lastIdx, targetDir);

  // Decision: must have BOTH weekly bias agreement AND daily timing AND conviction
  const sigDir = sig.consensusScore > 0 ? "BUY" : sig.consensusScore < 0 ? "SHORT" : "HOLD";
  const biasMatches = (weeklyBias.bias === "long" && sigDir === "BUY") ||
                      (weeklyBias.bias === "short" && sigDir === "SHORT");

  // Final macro permit check (defense-in-depth: weeklyBias already considers it,
  // but a strategy signal could fire SHORT in a confirmed bull SPY regime via the
  // counter-trend penalty — block it here).
  const macroOk = macroPermitsEntry(targetDir, macro ?? null);

  // Phase 1 #1 — Multi-timeframe HARD gate. Require the weekly bias to be at
  // ≥0.5 target allocation. Quarter-strength biases (rsiVal weak, ADX low,
  // pullback-only) too often produce whipsaws against a not-yet-trending
  // weekly. Block them here so they can't reach the autotrader.
  const weeklyStrong = Math.abs(weeklyBias.targetAllocation) >= 0.5;

  if (!biasMatches || !weeklyStrong || !dailyEntry || sig.confidence === 0 || !macroOk) {
    return {
      decision: "HOLD",
      conviction: sig.confidence,
      weeklyBias,
      profile: cls.classification,
      blendedParams: activeProfile,
      strategy: sig.strategy,
      regime: sig.regime,
      kellyFraction: 0,
      atr: sig.atr,
      atrPct: atrPctNow,
      reasoning: !macroOk
        ? `Macro regime blocks ${targetDir} entry`
        : !biasMatches
        ? `Weekly bias ${weeklyBias.bias} disagrees with daily ${sigDir.toLowerCase()}`
        : !weeklyStrong
        ? `Weekly bias too weak (alloc ${(weeklyBias.targetAllocation * 100).toFixed(0)}%) — multi-TF gate requires ≥50%`
        : !dailyEntry
        ? "Daily entry timing not confirmed"
        : "Conviction below threshold",
    };
  }

  const kellyFraction = computePositionSize(sig.confidence, atrPctNow, targetDir);

  return {
    decision: sigDir,
    conviction: sig.confidence,
    weeklyBias,
    profile: cls.classification,
    blendedParams: activeProfile,
    strategy: sig.strategy,
    regime: sig.regime,
    kellyFraction,
    atr: sig.atr,
    atrPct: atrPctNow,
    reasoning: `${sig.strategy.replace("_", " ")} ${sigDir.toLowerCase()} | ${cls.classification} profile | ${sig.regime} regime | conviction ${sig.confidence} | kelly ${(kellyFraction * 100).toFixed(1)}%`,
  };
}

