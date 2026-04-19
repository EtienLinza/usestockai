// ============================================================================
// CANONICAL SIGNAL ENGINE — single source of truth for weekly bias,
// stock classification, daily entry signals, and weekly aggregation.
// Imported by: market-scanner, check-sell-alerts, stock-predict
// (backtest/index.ts has its own enriched classifier with blending — keep separate)
// ============================================================================

import {
  calculateEMA,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateADX,
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
  targetAllocation: number;
}

// ============================================================================
// WEEKLY AGGREGATION
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
// STOCK CLASSIFICATION (lookahead-fixed: 120-bar adaptive window)
// ============================================================================

export const INDEX_TICKERS = new Set(["SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "IVV", "RSP"]);

export function classifyStockSimple(close: number[], high: number[], low: number[], ticker: string): StockProfile {
  if (INDEX_TICKERS.has(ticker.toUpperCase())) return "index";

  // [FIX #5] Use last 120 bars for adaptive classification (no lookahead)
  const window = 120;
  const startIdx = Math.max(0, close.length - window);
  const recentClose = close.slice(startIdx);
  const recentHigh = high.slice(startIdx);
  const recentLow = low.slice(startIdx);
  const n = recentClose.length;

  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push((recentClose[i] - recentClose[i - 1]) / recentClose[i - 1]);
  const retMean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const avgVolatility = Math.sqrt(returns.reduce((a, b) => a + (b - retMean) ** 2, 0) / returns.length);

  const atr = calculateATR(recentHigh, recentLow, recentClose, 14);
  let atrPctSum = 0, atrPctCount = 0;
  for (let i = 14; i < n; i++) {
    if (!isNaN(atr[i]) && recentClose[i] > 0) { atrPctSum += atr[i] / recentClose[i]; atrPctCount++; }
  }
  const atrPctAvg = atrPctCount > 0 ? atrPctSum / atrPctCount : 0.02;

  // Trend score via MA alignment over the recent window
  const sma50 = calculateSMA(close, 50);
  const sma200 = calculateSMA(close, 200);
  let maAlignedCount = 0, maValidCount = 0;
  const trendStart = Math.max(199, close.length - window);
  for (let i = trendStart; i < close.length; i++) {
    if (!isNaN(sma50[i]) && !isNaN(sma200[i])) {
      maValidCount++;
      if (close[i] > sma50[i] && sma50[i] > sma200[i]) maAlignedCount++;
    }
  }
  const trendScore = maValidCount > 0 ? maAlignedCount / maValidCount : 0;

  if (atrPctAvg > 0.025 && trendScore < 0.4) return "volatile";
  if (trendScore > 0.6) return "momentum";
  if (avgVolatility < 0.015 && trendScore < 0.4) {
    const lastPrice = close[close.length - 1];
    const lastSMA200 = safeGet(sma200, lastPrice);
    if (Math.abs(lastPrice - lastSMA200) / lastSMA200 < 0.08) return "value";
  }
  return "index";
}

export const PROFILE_WEEKLY_PARAMS: Record<StockProfile, { fastMA: number; slowMA: number; rsiLong: number }> = {
  momentum: { fastMA: 10, slowMA: 40, rsiLong: 45 },
  value: { fastMA: 13, slowMA: 50, rsiLong: 35 },
  index: { fastMA: 10, slowMA: 40, rsiLong: 40 },
  volatile: { fastMA: 8, slowMA: 30, rsiLong: 50 },
};

// ============================================================================
// WEEKLY BIAS COMPUTATION
// ============================================================================

export function computeWeeklyBias(
  weeklyClose: number[], weeklyHigh: number[], weeklyLow: number[],
  idx: number,
  params: { fastMA: number; slowMA: number; rsiLong: number },
  isLowVol: boolean = false,
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

  if (isLowVol) {
    if (rsiVal < 30 && c > slow) return { bias: "long", targetAllocation: 0.75 };
    if (rsiVal < 35 && c > slow && adxVal < 25) return { bias: "long", targetAllocation: 0.5 };
    if (rsiVal > 70) return { bias: "flat", targetAllocation: 0 };
    if (rsiVal >= 35 && rsiVal <= 65 && c > slow) return { bias: "long", targetAllocation: 0.25 };
    return { bias: "flat", targetAllocation: 0 };
  }

  if (c > fast && fast > slow) {
    if (rsiVal >= params.rsiLong && rsiVal <= 75 && adxVal > 20) return { bias: "long", targetAllocation: 1.0 };
    if (rsiVal > 75) return { bias: "long", targetAllocation: 0.25 };
    if (adxVal <= 20 || rsiVal < params.rsiLong) return { bias: "long", targetAllocation: 0.5 };
    return { bias: "long", targetAllocation: 0.5 };
  }

  if (fast > slow && c <= fast && c > slow) return { bias: "long", targetAllocation: 0.25 };
  if (c < fast && fast < slow && rsiVal < 40 && adxVal > 20) return { bias: "short", targetAllocation: -0.5 };

  return { bias: "flat", targetAllocation: 0 };
}

// ============================================================================
// DAILY ENTRY SIGNAL
// ============================================================================

export function hasDailyEntrySignal(
  close: number[], _high: number[], _low: number[], _volume: number[],
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

  if (direction === "long") {
    return [e12 > e26, rsiVal >= 35 && rsiVal <= 60, macdH > 0].filter(Boolean).length >= 2;
  } else {
    return [e12 < e26, rsiVal >= 40 && rsiVal <= 65, macdH < 0].filter(Boolean).length >= 2;
  }
}
