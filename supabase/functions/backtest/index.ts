import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================================
// TECHNICAL INDICATOR FUNCTIONS
// ============================================================================

function calculateEMA(prices: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  if (prices.length < period) {
    ema[0] = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
    }
    return ema;
  }
  const smaSum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  ema[0] = smaSum / period;
  for (let i = 0; i < period - 1; i++) ema[i] = NaN;
  ema[period - 1] = smaSum / period;
  for (let i = period; i < prices.length; i++) {
    ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  return ema;
}

function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { sma[i] = NaN; }
    else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma[i] = sum / period;
    }
  }
  return sma;
}

function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i <= period; i++) rsi[i] = NaN;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }
  avgGain /= period; avgLoss /= period;
  rsi[period] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.0001))));
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
    rsi[i] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.0001))));
  }
  return rsi;
}

function calculateMACD(prices: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12.map((v, i) => v - ema26[i]);

  const validIndices: number[] = [];
  const validMacd: number[] = [];
  for (let i = 0; i < macd.length; i++) {
    if (!isNaN(macd[i])) {
      validIndices.push(i);
      validMacd.push(macd[i]);
    }
  }

  const signalRaw = calculateEMA(validMacd, 9);
  const paddedSignal: number[] = new Array(macd.length).fill(NaN);
  for (let i = 0; i < signalRaw.length; i++) {
    paddedSignal[validIndices[i]] = signalRaw[i];
  }

  const histogram = macd.map((v, i) => {
    if (isNaN(v) || isNaN(paddedSignal[i])) return NaN;
    return v - paddedSignal[i];
  });
  return { macd, signal: paddedSignal, histogram };
}

function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2) {
  const sma = calculateSMA(prices, period);
  const upper: number[] = [], lower: number[] = [], bandwidth: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { upper[i] = NaN; lower[i] = NaN; bandwidth[i] = NaN; }
    else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = sma[i];
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const std = Math.sqrt(variance) * stdDev;
      upper[i] = mean + std; lower[i] = mean - std;
      bandwidth[i] = (upper[i] - lower[i]) / mean;
    }
  }
  return { upper, middle: sma, lower, bandwidth };
}

function calculateVolatility(prices: number[], period: number = 20): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  const volatility: number[] = [NaN];
  for (let i = 1; i < prices.length; i++) {
    if (i < period) { volatility[i] = NaN; }
    else {
      const slice = returns.slice(i - period, i);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      volatility[i] = Math.sqrt(variance);
    }
  }
  return volatility;
}

function calculateADX(high: number[], low: number[], close: number[], period: number = 14) {
  if (close.length < 2) return { adx: [], plusDI: [], minusDI: [] };
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const smoothedTR = calculateEMA(tr, period);
  const smoothedPlusDM = calculateEMA(plusDM, period);
  const smoothedMinusDM = calculateEMA(minusDM, period);
  const plusDI = smoothedPlusDM.map((v, i) => smoothedTR[i] === 0 ? 0 : (v / smoothedTR[i]) * 100);
  const minusDI = smoothedMinusDM.map((v, i) => smoothedTR[i] === 0 ? 0 : (v / smoothedTR[i]) * 100);
  const dx = plusDI.map((v, i) => { const sum = v + minusDI[i]; return sum === 0 ? 0 : (Math.abs(v - minusDI[i]) / sum) * 100; });
  const adxRaw = calculateEMA(dx.filter(v => !isNaN(v)), period);
  const padLen = close.length - adxRaw.length;
  return { adx: new Array(Math.max(0, padLen)).fill(NaN).concat(adxRaw), plusDI: new Array(1).fill(NaN).concat(plusDI), minusDI: new Array(1).fill(NaN).concat(minusDI) };
}

function calculateStochastic(close: number[], high: number[], low: number[], kPeriod: number = 14) {
  const k: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i < kPeriod - 1) { k.push(NaN); continue; }
    const hSlice = high.slice(i - kPeriod + 1, i + 1);
    const lSlice = low.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...hSlice), ll = Math.min(...lSlice), range = hh - ll;
    k.push(range === 0 ? 50 : ((close[i] - ll) / range) * 100);
  }
  return k;
}

function calculateATR(high: number[], low: number[], close: number[], period: number = 14): number[] {
  const atr: number[] = [NaN];
  const tr: number[] = [high[0] - low[0]];
  for (let i = 1; i < close.length; i++) {
    tr.push(Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    ));
  }
  // Initial ATR = simple average of first `period` TRs
  for (let i = 1; i < period; i++) atr[i] = NaN;
  if (tr.length >= period) {
    atr[period - 1] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < tr.length; i++) {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }
  return atr;
}
// ============================================================================
// WEEKLY BAR AGGREGATION
// ============================================================================

function aggregateToWeekly(data: DataSet): DataSet {
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
// WEEKLY BIAS COMPUTATION
// ============================================================================

interface WeeklyBias {
  bias: "long" | "flat" | "short";
  targetAllocation: number; // -1.0 to 1.0
}

function computeWeeklyBias(
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

  // ============================================================
  // DEFENSIVE MEAN-REVERSION MODE for low-volatility stocks
  // Only trades at extreme weekly RSI levels (oversold/overbought)
  // ============================================================
  if (isLowVol) {
    // Only enter long at deeply oversold extremes
    if (rsiVal < 30 && c > slow) return { bias: "long", targetAllocation: 0.75 };
    if (rsiVal < 35 && c > slow && adxVal < 25) return { bias: "long", targetAllocation: 0.5 };
    // Only go flat/exit at overbought
    if (rsiVal > 70) return { bias: "flat", targetAllocation: 0 };
    // If already positioned and RSI normalizing (40-65), hold at reduced allocation
    if (rsiVal >= 35 && rsiVal <= 65 && c > slow) return { bias: "long", targetAllocation: 0.25 };
    // No shorts for low-vol stocks
    return { bias: "flat", targetAllocation: 0 };
  }

  // ============================================================
  // STANDARD TREND-FOLLOWING MODE
  // ============================================================

  // LONG: price > fast EMA AND fast > slow EMA
  if (c > fast && fast > slow) {
    if (rsiVal >= params.rsiLong && rsiVal <= 75 && adxVal > 20) return { bias: "long", targetAllocation: 1.0 };
    if (rsiVal > 75) return { bias: "long", targetAllocation: 0.25 }; // overbought caution
    if (adxVal <= 20 || rsiVal < params.rsiLong) return { bias: "long", targetAllocation: 0.5 };
    return { bias: "long", targetAllocation: 0.5 };
  }

  // TRANSITION: price pulling back but fast still above slow
  if (fast > slow && c <= fast && c > slow) return { bias: "long", targetAllocation: 0.25 };

  // SHORT: confirmed downtrend with momentum
  if (c < fast && fast < slow && rsiVal < 40 && adxVal > 20) return { bias: "short", targetAllocation: -0.5 };

  return { bias: "flat", targetAllocation: 0 };
}

// ============================================================================
// DAILY ENTRY SIGNAL (timing within weekly trend)
// ============================================================================

function hasDailyEntrySignal(
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

  if (direction === "long") {
    return [e12 > e26, rsiVal >= 35 && rsiVal <= 60, macdH > 0].filter(Boolean).length >= 2;
  } else {
    return [e12 < e26, rsiVal >= 40 && rsiVal <= 65, macdH < 0].filter(Boolean).length >= 2;
  }
}

function safeGet(arr: number[], defaultVal: number): number {
  if (!arr || arr.length === 0) return defaultVal;
  const v = arr[arr.length - 1];
  return (v == null || isNaN(v)) ? defaultVal : v;
}

// ============================================================================
// STOCK-ADAPTIVE STRATEGY PROFILES
// ============================================================================

type StockProfile = "momentum" | "value" | "index" | "volatile";

interface StockClassification {
  classification: StockProfile;
  trendPersistence: number;
  meanReversionRate: number;
  avgVolatility: number;
  atrPctAvg: number;
}

interface ProfileParams {
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
  // Weekly dual-timeframe params
  weeklyFastMA: number;
  weeklySlowMA: number;
  weeklyRSILong: number;
  hardStopATRMult: number;
}

const PROFILE_PARAMS: Record<StockProfile, ProfileParams> = {
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

const INDEX_TICKERS = new Set(["SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "IVV", "RSP"]);

function blendProfiles(a: ProfileParams, b: ProfileParams, weight: number): ProfileParams {
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

function classifyStock(close: number[], high: number[], low: number[], ticker?: string): StockClassification & { blendedParams?: ProfileParams } {
  const n = close.length;

  // 1. Daily returns
  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push((close[i] - close[i - 1]) / close[i - 1]);

  // 2. Average daily volatility (std of returns)
  const retMean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const avgVolatility = Math.sqrt(returns.reduce((a, b) => a + (b - retMean) ** 2, 0) / returns.length);

  // 3. Trend Score: MA alignment + higher-highs (replaces broken autocorrelation metric)
  const sma50 = calculateSMA(close, 50);
  const sma200 = calculateSMA(close, 200);
  
  // MA alignment: % of bars where close > SMA(50) > SMA(200)
  let maAlignedCount = 0, maValidCount = 0;
  for (let i = 199; i < n; i++) {
    if (!isNaN(sma50[i]) && !isNaN(sma200[i])) {
      maValidCount++;
      if (close[i] > sma50[i] && sma50[i] > sma200[i]) {
        maAlignedCount++;
      }
    }
  }
  const maAlignment = maValidCount > 0 ? maAlignedCount / maValidCount : 0;
  
  // Higher-highs ratio: rolling 20-bar highs exceeding previous 20-bar high
  const hhWindow = 20;
  let hhCount = 0, hhTotal = 0;
  for (let i = hhWindow * 2; i < n; i += hhWindow) {
    const currentHigh = Math.max(...close.slice(i - hhWindow, i));
    const prevHigh = Math.max(...close.slice(i - hhWindow * 2, i - hhWindow));
    hhTotal++;
    if (currentHigh > prevHigh) hhCount++;
  }
  const higherHighsRatio = hhTotal > 0 ? hhCount / hhTotal : 0.5;
  
  // Combined trend score (0-1)
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

  // 6. Classification logic using trend score instead of autocorrelation
  let classification: StockProfile;
  let blendedParams: ProfileParams | undefined;

  // Force-classify known index ETFs
  if (ticker && INDEX_TICKERS.has(ticker.toUpperCase())) {
    classification = "index";
  } else if (atrPctAvg > 0.025 && trendScore < 0.4) {
    // High ATR%, weak trend → volatile
    classification = "volatile";
  } else if (trendScore > 0.6) {
    // Strong persistent trend → pure momentum
    classification = "momentum";
  } else if (trendScore > 0.5) {
    // Blend zone (0.5-0.6): mix momentum with value/index based on meanReversionRate
    classification = "momentum";
    const secondProfile = meanReversionRate > 0.40 ? "value" : "index";
    const blendWeight = (0.6 - trendScore) / 0.1; // 1 at 0.5, 0 at 0.6
    blendedParams = blendProfiles(PROFILE_PARAMS["momentum"], PROFILE_PARAMS[secondProfile], blendWeight * 0.6);
  } else if (meanReversionRate > 0.40 && trendScore < 0.4) {
    // High mean reversion, weak trend → value
    classification = "value";
    // Blend if borderline meanRev (0.40-0.50)
    if (meanReversionRate < 0.50) {
      const blendWeight = (0.50 - meanReversionRate) / 0.10;
      blendedParams = blendProfiles(PROFILE_PARAMS["value"], PROFILE_PARAMS["index"], blendWeight * 0.4);
    }
  } else {
    // Default fallback
    classification = "index";
  }

  console.log(`[Classification] ${ticker || "?"}: ${classification}${blendedParams ? " (blended)" : ""} | trendScore=${trendScore.toFixed(3)} maAlign=${maAlignment.toFixed(3)} hhRatio=${higherHighsRatio.toFixed(3)} meanRev=${meanReversionRate.toFixed(3)} vol=${avgVolatility.toFixed(4)} atrPct=${atrPctAvg.toFixed(4)}`);

  return { classification, trendPersistence: trendScore, meanReversionRate, avgVolatility, atrPctAvg, blendedParams };
}

// ============================================================================
// MULTI-STRATEGY REGIME-ADAPTIVE SIGNAL ENGINE
// ============================================================================

// Signal confirmation tracker — persists across calls via closure in walk-forward loop
interface SignalState {
  lastDirection: "BUY" | "SHORT" | "HOLD";
  consecutiveCount: number;
  cooldownBarsRemaining: number;
}

function createSignalTracker(): SignalState {
  return { lastDirection: "HOLD", consecutiveCount: 0, cooldownBarsRemaining: 0 };
}

function computeStrategySignal(
  close: number[], high: number[], low: number[], volume: number[],
  signalState: SignalState, step: number,
  signalParams?: { adxThreshold?: number; rsiOversold?: number; rsiOverbought?: number; buyThreshold?: number; shortThreshold?: number; forceValueMR?: boolean },
  profileBonuses?: { trendConvictionBonus?: number; mrConvictionBonus?: number; breakoutConvictionBonus?: number },
  adaptiveContext?: { spyBearish?: boolean; spySMADeclining?: boolean; isLeader?: boolean }
): {
  consensusScore: number;
  regime: string;
  predictedReturn: number;
  confidence: number;
  strategy: "trend" | "mean_reversion" | "breakout" | "none";
  positionSizeMultiplier: number;
  atr: number;
} {
  const HOLD_RESULT = (regime: string) => ({
    consensusScore: 0, regime, predictedReturn: 0, confidence: 0,
    strategy: "none" as const, positionSizeMultiplier: 1, atr: 0,
  });

  // --- Cooldown check ---
  if (signalState.cooldownBarsRemaining > 0) {
    signalState.cooldownBarsRemaining -= step;
    return HOLD_RESULT("cooldown");
  }

  const n = close.length;
  const currentPrice = close[n - 1];

  // --- Compute all indicators ---
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
  const currentATR = safeGet(atrArr, currentPrice * 0.02); // fallback ~2% of price
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
  const sk = safeGet(stochK, 50);
  const macdH = safeGet(macdData.histogram, 0);
  const prevMacdH = macdData.histogram.length >= 2 ? macdData.histogram[macdData.histogram.length - 2] : 0;
  const currentVol = safeGet(vol, 0.02);

  // Volume average (20-period)
  const volSlice = volume.slice(Math.max(0, n - 20));
  const avgVolume = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
  const currentVolume = volume[n - 1] || 0;
  const volRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  // Bandwidth average (50-period) for squeeze detection
  const bwSlice = bb.bandwidth.filter(v => !isNaN(v));
  const bwAvg50 = bwSlice.length >= 50
    ? bwSlice.slice(-50).reduce((a, b) => a + b, 0) / 50
    : bwSlice.length > 0 ? bwSlice.reduce((a, b) => a + b, 0) / bwSlice.length : 0.1;

  // SMA deviation
  const smaDeviation = s50 > 0 ? (currentPrice - s50) / s50 : 0;

  // --- Regime classification (for reporting) ---
  let regime = "neutral";
  if (adxVal > 40 && pdi > mdi && rsiVal > 60) regime = "strong_bullish";
  else if (adxVal > 40 && mdi > pdi && rsiVal < 40) regime = "strong_bearish";
  else if (adxVal > 25 && pdi > mdi) regime = "bullish";
  else if (adxVal > 25 && mdi > pdi) regime = "bearish";
  else if (rsiVal > 70) regime = "overbought";
  else if (rsiVal < 30) regime = "oversold";

  // --- 200 SMA Trend Guard ---
  const above200 = currentPrice > s200;
  const below200 = currentPrice < s200;

  // --- 200 SMA Slope Filter (Fix 2: catches trend reversals earlier) ---
  // 20-bar rate of change of 200 SMA
  let sma200Slope = 0;
  if (sma200.length >= 21 && !isNaN(sma200[sma200.length - 1]) && !isNaN(sma200[sma200.length - 21]) && sma200[sma200.length - 21] > 0) {
    sma200Slope = (sma200[sma200.length - 1] - sma200[sma200.length - 21]) / sma200[sma200.length - 21];
  }
  const sma200Declining = sma200Slope < -0.01; // 200 SMA declining > 1%
  const sma200Rising = sma200Slope > 0.01;     // 200 SMA rising > 1%

  // --- Adaptive Layer 1: Dual-Regime System ---
  // Only apply guards when BOTH SPY and the stock confirm bearishness
  const ctx = adaptiveContext || {};
  const spyConfirmsBear = ctx.spyBearish === true;
  const spySMAConfirmsDeclining = ctx.spySMADeclining === true;
  // Dual-regime: block only when both stock AND SPY agree on the bearish signal
  const dualRegimeBearBlock = below200 && spyConfirmsBear;
  const dualRegimeBullBlock = above200 && (ctx.spyBearish === false); // SPY bullish, used for short guard
  const dualSMADeclining = sma200Declining && spySMAConfirmsDeclining;

  const SP = signalParams || {};
  const ADX_THRESH = SP.adxThreshold ?? 25;
  const RSI_OS = SP.rsiOversold ?? 30;
  const RSI_OB = SP.rsiOverbought ?? 70;
  const CONV_BUY_THRESH = SP.buyThreshold ?? 65;
  const CONV_SHORT_THRESH = SP.shortThreshold ?? 65;

  // --- OBV (On-Balance Volume) for trend confirmation ---
  let obvRising = true; // default: no block
  if (volume.length >= 30) {
    let obv = 0;
    const obvArr: number[] = [0];
    for (let oi = 1; oi < close.length; oi++) {
      if (close[oi] > close[oi - 1]) obv += volume[oi];
      else if (close[oi] < close[oi - 1]) obv -= volume[oi];
      obvArr.push(obv);
    }
    // 20-bar OBV trend
    if (obvArr.length >= 20) {
      const obvNow = obvArr[obvArr.length - 1];
      const obv20Ago = obvArr[obvArr.length - 20];
      obvRising = obvNow >= obv20Ago; // OBV rising = volume confirms trend
    }
  }

  // --- Strategy A: Trend Following (ADX > threshold) ---
  // Conviction on TRUE 0-100 scale: no hardcoded floor
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

    // Dual-Regime Layer 1: Block trend BUYs only when BOTH stock AND SPY 200 SMA are declining
    // Fix 10: Also block trend BUY if OBV is declining (distribution)
    if (trendBuyScore >= 3 && above200 && !dualSMADeclining && obvRising) {
      trendSignal = "BUY";
      let conv = trendBuyScore * 15;
      conv += Math.min((adxVal - ADX_THRESH) * 0.5, 10);
      conv += Math.min(Math.abs(macdH) * 5, 8);
      if (rsiVal >= 40 && rsiVal <= 60) conv += 5;
      trendConviction = Math.min(100, conv);
    // Dual-Regime Layer 1: Block trend SHORTs only when BOTH stock AND SPY 200 SMA are rising
    } else if (trendShortScore >= 3 && below200 && !(sma200Rising && ctx.spyBearish === false)) {
      trendSignal = "SHORT";
      let conv = trendShortScore * 15;
      conv += Math.min((adxVal - ADX_THRESH) * 0.5, 10);
      conv += Math.min(Math.abs(macdH) * 5, 8);
      if (rsiVal >= 40 && rsiVal <= 55) conv += 5;
      trendConviction = Math.min(100, conv);
    }
  }

  // --- Strategy B: Mean Reversion (ADX < threshold OR RSI extremes OR forceValueMR) ---
  // Conviction 0-100: base = score*16 (3/5=48, 4/5=64, 5/5=80)
  let mrSignal: "BUY" | "SHORT" | "HOLD" = "HOLD";
  let mrConviction = 0;
  const mrRsiOverride = rsiVal < RSI_OS || rsiVal > RSI_OB;
  // Fix 9: Value profile forces MR evaluation even in high-ADX environments
  if (adxVal < ADX_THRESH || mrRsiOverride || forceValueMR) {
    // Apply conviction penalty when ADX is high (trending) but RSI is extreme
    const mrConvictionMultiplier = (adxVal >= ADX_THRESH && !forceValueMR && mrRsiOverride) ? 0.8 
      : (forceValueMR && adxVal >= ADX_THRESH) ? 0.9 : 1.0;
    const atrDevThreshold = currentPrice > 0 ? (1.5 * currentATR) / currentPrice : 0.02;
    const mrBuyConditions = [
      rsiVal < RSI_OS,
      currentPrice < bbL,
      smaDeviation < -atrDevThreshold,
      sk < 20,
      volRatio > 1.2,
    ];
    const mrBuyScore = mrBuyConditions.filter(Boolean).length;

    const mrShortConditions = [
      rsiVal > RSI_OB,
      currentPrice > bbU,
      smaDeviation > atrDevThreshold,
      sk > 80,
      volRatio > 1.2,
    ];
    const mrShortScore = mrShortConditions.filter(Boolean).length;

    // For value profile: lower the MR entry bar from 3 to 2 conditions when forceValueMR
    const mrMinScore = forceValueMR ? 2 : 3;

    // Dual-Regime Layer 1: Block MR buys only when BOTH stock below 200 AND SPY bearish
    if (mrBuyScore >= mrMinScore && !dualRegimeBearBlock) {
      mrSignal = "BUY";
      let conv = mrBuyScore * 16;
      conv += Math.min(Math.abs(rsiVal - 50) * 0.3, 10);
      conv += Math.min(Math.abs(smaDeviation) * 100, 10);
      mrConviction = Math.min(100, Math.round(conv * mrConvictionMultiplier));
    } else if (mrShortScore >= mrMinScore && !(above200 && ctx.spyBearish === false)) {
      mrSignal = "SHORT";
      let conv = mrShortScore * 16;
      conv += Math.min(Math.abs(rsiVal - 50) * 0.3, 10);
      conv += Math.min(Math.abs(smaDeviation) * 100, 10);
      mrConviction = Math.min(100, Math.round(conv * mrConvictionMultiplier));
    }
  }

  // --- Strategy C: Breakout (Bollinger squeeze + range expansion filter) ---
  // Conviction 0-100: base=50, volume bonus up to 25, range bonus up to 25
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
      let conv = 50;
      conv += Math.min((volRatio - 1) * 20, 25);                              // Volume bonus
      conv += Math.min((currentRange / currentATR - 1) * 20, 25);             // Range expansion bonus
      boConviction = Math.min(100, conv);
    }
    else if (currentPrice < bbL && adxRising && hasBreakoutFilter) {
      boSignal = "SHORT";
      let conv = 50;
      conv += Math.min((volRatio - 1) * 20, 25);
      conv += Math.min((currentRange / currentATR - 1) * 20, 25);
      boConviction = Math.min(100, conv);
    }
  }

  // --- Apply profile-specific conviction bonuses ---
  const pb = profileBonuses || {};
  if (trendSignal !== "HOLD" && pb.trendConvictionBonus) {
    trendConviction = Math.min(100, trendConviction + pb.trendConvictionBonus);
  }
  if (mrSignal !== "HOLD" && pb.mrConvictionBonus) {
    mrConviction = Math.min(100, mrConviction + pb.mrConvictionBonus);
  }
  if (boSignal !== "HOLD" && pb.breakoutConvictionBonus) {
    boConviction = Math.min(100, boConviction + pb.breakoutConvictionBonus);
  }

  // --- Select best strategy by conviction ---
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

  // --- Fix 4: Regime-based conviction penalty for counter-trend trades ---
  // Counter-trend trades get 0.7× conviction multiplier so only the strongest pass
  let adjustedConviction = bestConviction;
  const isBearishRegime = regime === "bearish" || regime === "strong_bearish";
  const isBullishRegime = regime === "bullish" || regime === "strong_bullish";
  const isLeader = ctx.isLeader === true;

  if (bestSignal === "BUY" && isBearishRegime && !isLeader) {
    adjustedConviction *= 0.7; // Buying in bear market needs much higher raw conviction (unless leader)
  } else if (bestSignal === "SHORT" && isBullishRegime && !isLeader) {
    adjustedConviction *= 0.7; // Shorting in bull market needs much higher raw conviction (unless leader)
  }

  // --- Adaptive Layer 3: Conviction Bonus for stocks in their own strong trend ---
  // If stock is in its own strong uptrend, boost BUY conviction
  if (above200 && sma200Slope > 0.02 && rsiVal > 40 && rsiVal < 70) {
    if (bestSignal === "BUY") adjustedConviction += 8;
  }
  // If stock is in its own strong downtrend, boost SHORT conviction
  if (below200 && sma200Slope < -0.02 && rsiVal > 30 && rsiVal < 60) {
    if (bestSignal === "SHORT") adjustedConviction += 8;
  }

  // --- Conviction threshold filter ---
  const cappedConviction = Math.min(100, adjustedConviction);
  const convThresh = bestSignal === "BUY" ? CONV_BUY_THRESH : CONV_SHORT_THRESH;
  if (cappedConviction < convThresh) {
    signalState.lastDirection = "HOLD";
    signalState.consecutiveCount = 0;
    return HOLD_RESULT(regime);
  }

  signalState.lastDirection = bestSignal;
  signalState.consecutiveCount = 1;

  // Volatility-adjusted position sizing
  const TARGET_VOL = 0.015; // 1.5% daily target
  let positionSizeMultiplier = currentVol > 0 ? TARGET_VOL / currentVol : 1;
  // Scale by conviction
  positionSizeMultiplier *= 0.7 + (cappedConviction / 100) * 0.8; // range 0.7x - 1.5x
  positionSizeMultiplier = Math.max(0.25, Math.min(2.0, positionSizeMultiplier));

  const consensusScore = bestSignal === "BUY" ? cappedConviction : -cappedConviction;
  const predictedReturn = (consensusScore / 100) * 5;

  // Confidence = raw conviction score (already 0-100, gated at ~62 for entry)
  let confidence = cappedConviction;
  if (regime.includes("strong")) confidence += 3;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return { consensusScore, regime, predictedReturn, confidence, strategy: bestStrategy, positionSizeMultiplier, atr: currentATR };
}

// ============================================================================
// YAHOO FINANCE DATA FETCHER
// ============================================================================
async function fetchYahooData(ticker: string, startDate: number, endDate: number): Promise<{
  timestamps: string[];
  close: number[];
  high: number[];
  low: number[];
  open: number[];
  volume: number[];
} | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startDate}&period2=${endDate}&interval=1d`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.chart.error) return null;
    const result = data.chart.result[0];
    const quotes = result.indicators.quote[0];
    const timestamps = result.timestamp.map((t: number) => {
      const d = new Date(t * 1000);
      return d.toISOString().split('T')[0];
    });
    const close: number[] = [], high: number[] = [], low: number[] = [], volume: number[] = [], dates: string[] = [], open: number[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.close[i] != null && quotes.high[i] != null && quotes.low[i] != null && quotes.open[i] != null) {
        close.push(quotes.close[i]);
        high.push(quotes.high[i]);
        low.push(quotes.low[i]);
        open.push(quotes.open[i]);
        volume.push(quotes.volume[i] || 0);
        dates.push(timestamps[i]);
      }
    }
    return { timestamps: dates, close, high, low, open, volume };
  } catch (e) {
    console.error(`Failed to fetch ${ticker}:`, e);
    return null;
  }
}

// ============================================================================
// TRADING SIMULATION
// ============================================================================
interface TradeConfig {
  initialCapital: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  commissionPct: number;
  spreadPct: number;
  slippagePct: number;
}

interface Trade {
  date: string;
  exitDate: string;
  ticker: string;
  action: "BUY" | "SHORT" | "HOLD";
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  pnl: number;
  regime: string;
  confidence: number;
  predictedReturn: number;
  actualReturn: number;
  duration: number;
  mae: number;
  mfe: number;
  volumeAtEntry: number;
  strategy: "trend" | "mean_reversion" | "breakout" | "none";
  exitReason: "stop_loss" | "take_profit" | "trailing_stop" | "time_exit" | "weekly_reversal" | "hard_stop" | "scale_down";
  scaleLevel?: number;
  allocationAtEntry?: number;
}

function applyTradingCosts(price: number, isBuy: boolean, config: TradeConfig): number {
  let adjusted = price;
  adjusted *= isBuy ? (1 + config.spreadPct / 100) : (1 - config.spreadPct / 100);
  const slippage = 1 + (Math.random() - 0.5) * 2 * (config.slippagePct / 100);
  adjusted *= slippage;
  return adjusted;
}

// ============================================================================
// WALK-FORWARD BACKTESTING ENGINE
// ============================================================================
interface BacktestConfig {
  tickers: string[];
  startYear: number;
  endYear: number;
  initialCapital: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxPositions: number;
  rebalanceFrequency: "weekly" | "monthly";
  includeMonteCarlo: boolean;
  buyThreshold: number;
  shortThreshold: number;
  adxThreshold: number;
  rsiOversold: number;
  rsiOverbought: number;
  trailingStopATRMult: number;
  maxHoldBars: number;
  riskPerTrade: number; // Risk-based sizing: fraction of capital risked per trade
}

interface BacktestReport {
  periods: { start: string; end: string; accuracy: number; returnPct: number; trades: number }[];
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  directionalAccuracy: number;
  mae: number;
  rmse: number;
  mape: number;
  avgWin: number;
  avgLoss: number;
  winLossRatio: number;
  avgTradeDuration: number;
  medianTradeDuration: number;
  maxTradeDuration: number;
  avgMAE: number;
  avgMFE: number;
  valueAtRisk: number;
  conditionalVaR: number;
  ulcerIndex: number;
  marketExposure: number;
  longExposure: number;
  shortExposure: number;
  cagr: number;
  timeToDouble: number;
  alpha: number;
  beta: number;
  portfolioTurnover: number;
  stabilityScore: number;
  signalPrecision: number;
  signalRecall: number;
  signalF1: number;
  regimePerformance: { regime: string; accuracy: number; avgReturn: number; trades: number }[];
  confidenceCalibration: { bucket: string; predictedConf: number; actualAccuracy: number; count: number }[];
  equityCurve: { date: string; value: number }[];
  drawdownCurve: { date: string; drawdown: number }[];
  tradeLog: Trade[];
  monteCarlo: { percentile5: number; percentile25: number; median: number; percentile75: number; percentile95: number } | null;
  benchmarkReturn: number;
  annualizedReturn: number;
  rollingSharpe: { index: number; value: number }[];
  rollingVolatility: { index: number; value: number }[];
  tradeDistribution: { bucket: string; count: number }[];
  monthlyReturns: { year: number; month: number; returnPct: number }[];
  robustness: {
    noiseInjection: { baseReturn: number; noisyReturn: number; impact: number; passed: boolean } | null;
    delayedExecution: { baseReturn: number; delayedReturn: number; impact: number; passed: boolean } | null;
    parameterSensitivity: { param: string; value: number; returnPct: number; sharpe: number }[];
    tradeDependency: { baseReturn: number; reducedReturn: number; impact: number; passed: boolean } | null;
  };
  stressTests: { period: string; startDate: string; endDate: string; strategyReturn: number; benchmarkReturn: number; maxDrawdown: number }[];
  liquidityWarnings: number;
  maxDrawdownDuration: number;
  avgDrawdownDuration: number;
  recoveryTime: number;
  timeInDrawdownPct: number;
  skewness: number;
  kurtosis: number;
  kelly: number;
  expectancy: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  strategyCapacity: number;
  signalDecay: { day: number; accuracy: number }[];
  benchmarkEquity: { date: string; value: number }[];
  marketRegimePerformance: { regime: string; accuracy: number; avgReturn: number; trades: number }[];
  strategyPerformance: { strategy: string; trades: number; winRate: number; avgReturn: number }[];
}

type DataSet = { timestamps: string[]; close: number[]; high: number[]; low: number[]; open: number[]; volume: number[] };

// ============================================================================
// ALLOCATION-BASED POSITION TRACKING
// ============================================================================

interface AllocationBlock {
  entryIdx: number;
  entryPrice: number;
  shares: number;
  positionSize: number;
  commission: number;
  scaleLevel: number;
}

interface AllocationPosition {
  direction: "long" | "short";
  blocks: AllocationBlock[];
  avgEntryPrice: number;
  totalShares: number;
  totalPositionSize: number;
  currentAllocation: number;
  peakPrice: number;
  troughPrice: number;
  maxFavorable: number;
  maxAdverse: number;
  firstEntryIdx: number;
  regime: string;
}

// ============================================================================
// DUAL-TIMEFRAME ALLOCATION-BASED WALK-FORWARD ENGINE
// ============================================================================

function runWalkForwardBacktest(
  allData: DataSet,
  ticker: string,
  config: BacktestConfig,
  tradeConfig: TradeConfig,
  executionDelay: number = 1,
  stepOverride?: number,
  spyData?: DataSet | null,
): { trades: Trade[]; equityCurve: { date: string; value: number }[]; totalBars: number; barsInTrade: number; stockClassification: StockClassification | null } {
  const { close, high, low, open, volume, timestamps } = allData;
  const trades: Trade[] = [];
  let capital = config.initialCapital;
  const equityCurve: { date: string; value: number }[] = [{ date: timestamps[0], value: capital }];

  const TRAIN_WINDOW = 250;
  let totalBars = 0;
  let barsInTrade = 0;

  // --- Aggregate daily data to weekly ---
  const weeklyData = aggregateToWeekly(allData);

  // Map daily bar index to weekly bar index
  const dailyToWeeklyIdx: number[] = new Array(timestamps.length).fill(0);
  {
    let wi = 0;
    for (let di = 0; di < timestamps.length; di++) {
      while (wi + 1 < weeklyData.timestamps.length && timestamps[di] >= weeklyData.timestamps[wi + 1]) {
        wi++;
      }
      dailyToWeeklyIdx[di] = wi;
    }
  }

  // Weekly ATR for hard stops + low-vol detection
  const weeklyATR = calculateATR(weeklyData.high, weeklyData.low, weeklyData.close, 14);

  // Detect low-volatility stock: weekly ATR% < 2% on average
  let isLowVolStock = false;
  {
    let wAtrPctSum = 0, wAtrPctCount = 0;
    for (let wi = 14; wi < weeklyData.close.length; wi++) {
      if (!isNaN(weeklyATR[wi]) && weeklyData.close[wi] > 0) {
        wAtrPctSum += weeklyATR[wi] / weeklyData.close[wi];
        wAtrPctCount++;
      }
    }
    const avgWeeklyAtrPct = wAtrPctCount > 0 ? wAtrPctSum / wAtrPctCount : 0;
    isLowVolStock = avgWeeklyAtrPct < 0.02;
    if (isLowVolStock) {
      console.log(`[LowVol] ${ticker}: weekly ATR%=${(avgWeeklyAtrPct * 100).toFixed(2)}% → switching to defensive mean-reversion mode`);
    }
  }

  // Build SPY regime maps
  const spyDateMap = new Map<string, number>();
  const spy200SMAMap = new Map<string, boolean>();
  const spySMADecliningMap = new Map<string, boolean>();
  if (spyData && spyData.close.length >= 200) {
    const spySMA200 = calculateSMA(spyData.close, 200);
    for (let si = 0; si < spyData.timestamps.length; si++) {
      spyDateMap.set(spyData.timestamps[si], spyData.close[si]);
      if (!isNaN(spySMA200[si])) {
        spy200SMAMap.set(spyData.timestamps[si], spyData.close[si] > spySMA200[si]);
        if (si >= 20 && !isNaN(spySMA200[si - 20]) && spySMA200[si - 20] > 0) {
          const spySlope = (spySMA200[si] - spySMA200[si - 20]) / spySMA200[si - 20];
          spySMADecliningMap.set(spyData.timestamps[si], spySlope < -0.01);
        }
      }
    }
  }

  // --- Stock Classification (adaptive window/interval/smoothing) ---
  const DEFAULT_CLASSIFY_INTERVAL = 500;
  const DEFAULT_MAX_WINDOW = 1000;
  const DEFAULT_SMOOTH_FACTOR = 0.3;
  let adaptiveClassifyInterval = DEFAULT_CLASSIFY_INTERVAL;
  let adaptiveMaxWindow = DEFAULT_MAX_WINDOW;
  let adaptiveSmoothFactor = DEFAULT_SMOOTH_FACTOR;

  const metricHistory: { trendScore: number; meanReversionRate: number; atrPctAvg: number }[] = [];
  const METRIC_HISTORY_SIZE = 4;

  function computeMetricStability(): number {
    if (metricHistory.length < 2) return -1;
    const cvOf = (vals: number[]): number => {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (mean === 0) return 0;
      const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      return std / Math.abs(mean);
    };
    return (cvOf(metricHistory.map(m => m.trendScore)) + cvOf(metricHistory.map(m => m.meanReversionRate)) + cvOf(metricHistory.map(m => m.atrPctAvg))) / 3;
  }

  function updateAdaptiveParams(stabilityCV: number) {
    if (stabilityCV < 0) return;
    if (stabilityCV < 0.15) {
      adaptiveMaxWindow = 1500; adaptiveClassifyInterval = 750; adaptiveSmoothFactor = 0.4;
    } else if (stabilityCV > 0.40) {
      adaptiveMaxWindow = 600; adaptiveClassifyInterval = 250; adaptiveSmoothFactor = 0.15;
    } else {
      const t = (stabilityCV - 0.15) / 0.25;
      adaptiveMaxWindow = Math.round(1500 - 900 * t);
      adaptiveClassifyInterval = Math.round(750 - 500 * t);
      adaptiveSmoothFactor = 0.4 - 0.25 * t;
    }
  }

  let currentClassification: StockClassification | null = null;
  let activeProfile: ProfileParams = PROFILE_PARAMS["index"];
  let smoothedProfile: ProfileParams | null = null;
  let lastClassifyBar = -DEFAULT_CLASSIFY_INTERVAL;

  const modeModifier = (config as any).strategyMode || "adaptive";
  const applyModeToProfile = (profile: ProfileParams): ProfileParams => {
    if (modeModifier === "conservative") {
      return {
        ...profile,
        buyThreshold: Math.min(profile.buyThreshold + 10, 85),
        shortThreshold: Math.min(profile.shortThreshold + 10, 85),
        hardStopATRMult: Math.max(profile.hardStopATRMult - 0.3, 1.5),
      };
    } else if (modeModifier === "aggressive") {
      return {
        ...profile,
        buyThreshold: Math.max(profile.buyThreshold - 5, 50),
        shortThreshold: Math.max(profile.shortThreshold - 5, 50),
        hardStopATRMult: profile.hardStopATRMult + 0.5,
      };
    }
    return profile;
  };

  // --- Allocation state ---
  let position: AllocationPosition | null = null;
  let lastWeeklyCheck = -5;
  let currentTargetAllocation = 0;
  let currentBias: "long" | "flat" | "short" = "flat";
  let cooldownUntil = 0; // bar index to wait until after a full exit

  // --- Helper: close entire position ---
  const closeFullPosition = (pos: AllocationPosition, barIdx: number, reason: Trade["exitReason"]) => {
    const exitIdx = Math.min(barIdx, close.length - 1);
    const exitPriceRaw = close[exitIdx];
    const exitPrice = applyTradingCosts(exitPriceRaw, pos.direction !== "long", tradeConfig);

    for (const block of pos.blocks) {
      let pnl: number;
      if (pos.direction === "long") {
        pnl = (exitPrice - block.entryPrice) * block.shares - block.commission;
      } else {
        pnl = (block.entryPrice - exitPrice) * block.shares - block.commission;
      }
      const returnPct = block.positionSize > 0 ? (pnl / block.positionSize) * 100 : 0;
      const duration = exitIdx - block.entryIdx;
      const actualReturn = close[block.entryIdx] > 0 ? (close[exitIdx] - close[block.entryIdx]) / close[block.entryIdx] * 100 : 0;

      capital += block.positionSize + pnl;
      barsInTrade += duration;

      trades.push({
        date: timestamps[block.entryIdx], exitDate: timestamps[exitIdx], ticker,
        action: pos.direction === "long" ? "BUY" : "SHORT",
        entryPrice: block.entryPrice, exitPrice, returnPct, pnl,
        regime: pos.regime, confidence: 70,
        predictedReturn: pos.direction === "long" ? 5 : -5,
        actualReturn, duration,
        mae: parseFloat((pos.maxAdverse * 100).toFixed(2)),
        mfe: parseFloat((pos.maxFavorable * 100).toFixed(2)),
        volumeAtEntry: volume[block.entryIdx] || 0,
        strategy: "trend", exitReason: reason,
        scaleLevel: block.scaleLevel,
        allocationAtEntry: pos.currentAllocation,
      });
    }
    cooldownUntil = barIdx + 10; // 10-bar cooldown after full exit
  };

  // --- Helper: scale down position ---
  const scaleDownPosition = (pos: AllocationPosition, barIdx: number, newAlloc: number) => {
    const exitIdx = Math.min(barIdx, close.length - 1);
    const exitPriceRaw = close[exitIdx];
    const exitPrice = applyTradingCosts(exitPriceRaw, pos.direction !== "long", tradeConfig);

    while (pos.blocks.length > 0 && pos.currentAllocation > newAlloc + 0.01) {
      const block = pos.blocks.pop()!;
      let pnl: number;
      if (pos.direction === "long") {
        pnl = (exitPrice - block.entryPrice) * block.shares - block.commission;
      } else {
        pnl = (block.entryPrice - exitPrice) * block.shares - block.commission;
      }
      const returnPct = block.positionSize > 0 ? (pnl / block.positionSize) * 100 : 0;
      const duration = exitIdx - block.entryIdx;
      const actualReturn = close[block.entryIdx] > 0 ? (close[exitIdx] - close[block.entryIdx]) / close[block.entryIdx] * 100 : 0;

      capital += block.positionSize + pnl;
      barsInTrade += duration;
      pos.currentAllocation = Math.max(0, pos.currentAllocation - 0.25);

      trades.push({
        date: timestamps[block.entryIdx], exitDate: timestamps[exitIdx], ticker,
        action: pos.direction === "long" ? "BUY" : "SHORT",
        entryPrice: block.entryPrice, exitPrice, returnPct, pnl,
        regime: pos.regime, confidence: 70,
        predictedReturn: pos.direction === "long" ? 5 : -5,
        actualReturn, duration,
        mae: parseFloat((pos.maxAdverse * 100).toFixed(2)),
        mfe: parseFloat((pos.maxFavorable * 100).toFixed(2)),
        volumeAtEntry: volume[block.entryIdx] || 0,
        strategy: "trend", exitReason: "scale_down",
        scaleLevel: block.scaleLevel,
        allocationAtEntry: pos.currentAllocation,
      });
    }

    if (pos.blocks.length > 0) {
      const totalCost = pos.blocks.reduce((sum, b) => sum + b.entryPrice * b.shares, 0);
      pos.totalShares = pos.blocks.reduce((sum, b) => sum + b.shares, 0);
      pos.totalPositionSize = pos.blocks.reduce((sum, b) => sum + b.positionSize, 0);
      pos.avgEntryPrice = pos.totalShares > 0 ? totalCost / pos.totalShares : 0;
    }
  };

  // ========================= MAIN DAILY LOOP =========================

  for (let i = TRAIN_WINDOW; i < close.length - 1; i++) {
    totalBars++;

    // --- Rolling stock classification (adaptive) ---
    if (i - lastClassifyBar >= adaptiveClassifyInterval && i >= 250) {
      const classWindow = Math.min(i, adaptiveMaxWindow);
      const cClose = close.slice(i - classWindow, i);
      const cHigh = high.slice(i - classWindow, i);
      const cLow = low.slice(i - classWindow, i);
      if (cClose.length >= 50) {
        currentClassification = classifyStock(cClose, cHigh, cLow, ticker);
        const rawProfile = currentClassification.blendedParams || PROFILE_PARAMS[currentClassification.classification];
        metricHistory.push({
          trendScore: currentClassification.trendPersistence,
          meanReversionRate: currentClassification.meanReversionRate,
          atrPctAvg: currentClassification.atrPctAvg,
        });
        if (metricHistory.length > METRIC_HISTORY_SIZE) metricHistory.shift();
        const stabilityCV = computeMetricStability();
        updateAdaptiveParams(stabilityCV);
        if (smoothedProfile === null) {
          smoothedProfile = { ...rawProfile };
        } else {
          smoothedProfile = blendProfiles(smoothedProfile, rawProfile, adaptiveSmoothFactor);
        }
        activeProfile = applyModeToProfile(smoothedProfile);
        lastClassifyBar = i;

        console.log(`[Profile] ${ticker} bar=${i} class=${currentClassification.classification} wFast=${activeProfile.weeklyFastMA} wSlow=${activeProfile.weeklySlowMA} hardStop=${activeProfile.hardStopATRMult.toFixed(1)}`);
      }
    }

    // --- Weekly rebalance check (every 5 daily bars) ---
    if (i - lastWeeklyCheck >= 5) {
      lastWeeklyCheck = i;
      const wIdx = dailyToWeeklyIdx[i];

      if (wIdx >= Math.max(activeProfile.weeklySlowMA, 40) + 10) {
        const weeklyBias = computeWeeklyBias(
          weeklyData.close, weeklyData.high, weeklyData.low, wIdx,
          { fastMA: activeProfile.weeklyFastMA, slowMA: activeProfile.weeklySlowMA, rsiLong: activeProfile.weeklyRSILong }
        );
        currentBias = weeklyBias.bias;
        const absTarget = Math.abs(weeklyBias.targetAllocation);

        // SPY filter for shorts
        if (weeklyBias.bias === "short") {
          const currentDate = timestamps[i];
          const spyAbove200 = spy200SMAMap.get(currentDate);
          if (spyAbove200 === true) {
            currentBias = "flat";
            currentTargetAllocation = 0;
          } else {
            currentTargetAllocation = absTarget;
          }
        } else {
          currentTargetAllocation = absTarget;
        }

        // Handle position adjustments
        if (position) {
          // Direction mismatch → full exit
          if ((position.direction === "long" && currentBias !== "long") ||
              (position.direction === "short" && currentBias !== "short")) {
            closeFullPosition(position, i, "weekly_reversal");
            position = null;
          }
          // Target decreased → scale down
          else if (position && currentTargetAllocation < position.currentAllocation - 0.01) {
            if (currentTargetAllocation <= 0.01) {
              closeFullPosition(position, i, "weekly_reversal");
              position = null;
            } else {
              scaleDownPosition(position, i, currentTargetAllocation);
              if (position.blocks.length === 0) position = null;
            }
          }
        }
      }
    }

    // --- Hard stop check ---
    if (position && position.blocks.length > 0) {
      const wIdx = dailyToWeeklyIdx[i];
      const wATR = (!isNaN(weeklyATR[wIdx]) && weeklyATR[wIdx] > 0) ? weeklyATR[wIdx] : close[i] * 0.05;
      const hardStopDist = activeProfile.hardStopATRMult * wATR / position.avgEntryPrice;

      const priceChange = position.direction === "long"
        ? (close[i] - position.avgEntryPrice) / position.avgEntryPrice
        : (position.avgEntryPrice - close[i]) / position.avgEntryPrice;

      position.maxFavorable = Math.max(position.maxFavorable, priceChange);
      position.maxAdverse = Math.min(position.maxAdverse, priceChange);

      if (position.direction === "long") {
        position.peakPrice = Math.max(position.peakPrice, close[i]);
      } else {
        position.troughPrice = Math.min(position.troughPrice, close[i]);
      }

      // Hard stop: drawdown from avg entry exceeds threshold
      if (priceChange < -hardStopDist) {
        closeFullPosition(position, i, "hard_stop");
        position = null;
        continue;
      }
    }

    // --- Daily entry signal for scaling up ---
    if (i < cooldownUntil) continue; // respect cooldown after exits
    if (currentBias !== "flat" && currentTargetAllocation > 0) {
      const currentAlloc = position?.currentAllocation || 0;
      const targetDir: "long" | "short" = currentBias === "long" ? "long" : "short";

      if (currentAlloc < currentTargetAllocation - 0.01) {
        if (hasDailyEntrySignal(close, high, low, volume, i, targetDir)) {
          const entryIdx = Math.min(i + executionDelay, close.length - 1);
          if (entryIdx < close.length) {
            const entryPrice = applyTradingCosts(open[entryIdx], targetDir === "long", tradeConfig);
            const allocDelta = 0.25;
            const positionSize = Math.min(config.initialCapital * allocDelta, capital * 0.90);

            if (positionSize > 10 && entryPrice > 0) {
              const shares = positionSize / entryPrice;
              const commission = positionSize * (tradeConfig.commissionPct / 100) * 2;
              capital -= positionSize;

              let regime = "neutral";
              if (currentBias === "long") regime = "bullish";
              else if (currentBias === "short") regime = "bearish";

              if (!position) {
                position = {
                  direction: targetDir, blocks: [],
                  avgEntryPrice: entryPrice,
                  totalShares: 0, totalPositionSize: 0,
                  currentAllocation: 0,
                  peakPrice: close[i], troughPrice: close[i],
                  maxFavorable: 0, maxAdverse: 0,
                  firstEntryIdx: entryIdx, regime,
                };
              }

              position.blocks.push({ entryIdx, entryPrice, shares, positionSize, commission, scaleLevel: position.blocks.length + 1 });

              // Update aggregate position metrics
              const totalCost = position.blocks.reduce((sum, b) => sum + b.entryPrice * b.shares, 0);
              position.totalShares = position.blocks.reduce((sum, b) => sum + b.shares, 0);
              position.totalPositionSize = position.blocks.reduce((sum, b) => sum + b.positionSize, 0);
              position.avgEntryPrice = position.totalShares > 0 ? totalCost / position.totalShares : entryPrice;
              position.currentAllocation = Math.min(currentAlloc + allocDelta, 1.0);
            }
          }
        }
      }
    }

    // Record equity periodically
    if (i % 5 === 0 || i === close.length - 2) {
      const openMTM = position && position.blocks.length > 0
        ? (position.direction === "long"
          ? position.totalShares * close[i]
          : position.totalPositionSize + (position.avgEntryPrice - close[i]) * position.totalShares)
        : 0;
      equityCurve.push({ date: timestamps[i], value: capital + openMTM });
    }
  }

  // --- Force-close any remaining position at end of data ---
  if (position && position.blocks.length > 0) {
    closeFullPosition(position, close.length - 1, "time_exit");
    position = null;
  }
  equityCurve.push({ date: timestamps[close.length - 1], value: capital });

  return { trades, equityCurve, totalBars, barsInTrade, stockClassification: currentClassification };
}

// ============================================================================
// METRICS COMPUTATION
// ============================================================================
function computeMetrics(
  trades: Trade[],
  initialCapital: number,
  equityCurve: { date: string; value: number }[],
  years: number,
  totalBars: number,
  barsInTrade: number,
  benchmarkReturns: number[],
  positionSizePctVal: number = 10,
  spyData?: DataSet | null,
): Partial<BacktestReport> {
  if (trades.length === 0) {
    return {
      totalTrades: 0, winRate: 0, avgReturn: 0, totalReturn: 0, maxDrawdown: 0,
      sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, profitFactor: 0,
      directionalAccuracy: 0, mae: 0, rmse: 0, mape: 0,
      avgWin: 0, avgLoss: 0, winLossRatio: 0,
      avgTradeDuration: 0, medianTradeDuration: 0, maxTradeDuration: 0,
      avgMAE: 0, avgMFE: 0, valueAtRisk: 0, conditionalVaR: 0,
      ulcerIndex: 0, marketExposure: 0, longExposure: 0, shortExposure: 0,
      cagr: 0, timeToDouble: 0, alpha: 0, beta: 0,
      portfolioTurnover: 0, stabilityScore: 0,
      signalPrecision: 0, signalRecall: 0, signalF1: 0,
      regimePerformance: [], confidenceCalibration: [], annualizedReturn: 0,
      rollingSharpe: [], rollingVolatility: [], tradeDistribution: [], monthlyReturns: [],
      maxDrawdownDuration: 0, avgDrawdownDuration: 0, recoveryTime: 0,
      timeInDrawdownPct: 0, skewness: 0, kurtosis: 0, kelly: 0, expectancy: 0,
      maxConsecutiveWins: 0, maxConsecutiveLosses: 0, strategyCapacity: 0,
      signalDecay: [], marketRegimePerformance: [],
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = (wins.length / trades.length) * 100;
  const returns = trades.map(t => t.returnPct);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const finalCapital = equityCurve[equityCurve.length - 1]?.value || initialCapital;
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;
  const annualizedReturn = years > 0 ? (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100 : totalReturn;

  // Avg Win / Avg Loss / Ratio
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.returnPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.returnPct, 0) / losses.length : 0;
  const winLossRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 999 : 0;

  // Trade Duration
  const durations = trades.map(t => t.duration).sort((a, b) => a - b);
  const avgTradeDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const medianTradeDuration = durations[Math.floor(durations.length / 2)] || 0;
  const maxTradeDuration = durations[durations.length - 1] || 0;

  // MAE / MFE
  const avgMAE = trades.reduce((a, t) => a + t.mae, 0) / trades.length;
  const avgMFE = trades.reduce((a, t) => a + t.mfe, 0) / trades.length;

  // Max Drawdown + drawdown series for Ulcer Index + DRAWDOWN DURATION
  let peak = initialCapital;
  let maxDrawdown = 0;
  const drawdowns: number[] = [];
  let ddStart = -1;
  let maxDDDuration = 0;
  let totalDDDuration = 0;
  let ddCount = 0;
  let maxRecoveryTime = 0;
  let inDrawdown = false;
  let pointsInDD = 0;

  for (let idx = 0; idx < equityCurve.length; idx++) {
    const point = equityCurve[idx];
    if (point.value > peak) {
      // Recovered
      if (inDrawdown) {
        const duration = idx - ddStart;
        totalDDDuration += duration;
        ddCount++;
        if (duration > maxDDDuration) maxDDDuration = duration;
        maxRecoveryTime = Math.max(maxRecoveryTime, duration);
        inDrawdown = false;
      }
      peak = point.value;
    }
    const dd = ((peak - point.value) / peak) * 100;
    drawdowns.push(dd);
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (dd > 0) {
      pointsInDD++;
      if (!inDrawdown) {
        inDrawdown = true;
        ddStart = idx;
      }
    }
  }
  // Handle still-in-drawdown at end
  if (inDrawdown) {
    const duration = equityCurve.length - ddStart;
    totalDDDuration += duration;
    ddCount++;
    if (duration > maxDDDuration) maxDDDuration = duration;
    maxRecoveryTime = Math.max(maxRecoveryTime, duration);
  }

  const maxDrawdownDuration = maxDDDuration;
  const avgDrawdownDuration = ddCount > 0 ? Math.round(totalDDDuration / ddCount) : 0;
  const recoveryTime = maxRecoveryTime;
  const timeInDrawdownPct = equityCurve.length > 0 ? parseFloat(((pointsInDD / equityCurve.length) * 100).toFixed(1)) : 0;

  // Ulcer Index
  const ulcerIndex = Math.sqrt(drawdowns.reduce((a, b) => a + b * b, 0) / drawdowns.length);

  // Sharpe Ratio
  const riskFreeDaily = 0.04 / 252;
  const meanReturn = returns.reduce((a, b) => a + b / 100, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b / 100 - meanReturn, 2), 0) / returns.length);
  const sharpeRatio = stdReturn > 0 ? ((meanReturn - riskFreeDaily) / stdReturn) * Math.sqrt(252 / 5) : 0;

  // Sortino Ratio
  const downsideReturns = returns.filter(r => r < 0).map(r => r / 100);
  const downsideStd = downsideReturns.length > 0
    ? Math.sqrt(downsideReturns.reduce((a, b) => a + b * b, 0) / downsideReturns.length)
    : 0.001;
  const sortinoRatio = downsideStd > 0 ? ((meanReturn - riskFreeDaily) / downsideStd) * Math.sqrt(252 / 5) : 0;

  // Calmar Ratio
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  // Profit Factor
  const totalProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;

  // VaR and CVaR (5th percentile)
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const varIdx = Math.floor(0.05 * sortedReturns.length);
  const valueAtRisk = sortedReturns[varIdx] || 0;
  const tailReturns = sortedReturns.slice(0, varIdx + 1);
  const conditionalVaR = tailReturns.length > 0 ? tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length : 0;

  // Exposure
  const marketExposure = totalBars > 0 ? (barsInTrade / totalBars) * 100 : 0;
  const longTrades = trades.filter(t => t.action === "BUY");
  const shortTrades = trades.filter(t => t.action === "SHORT");
  const longBars = longTrades.reduce((a, t) => a + t.duration, 0);
  const shortBars = shortTrades.reduce((a, t) => a + t.duration, 0);
  const longExposure = totalBars > 0 ? (longBars / totalBars) * 100 : 0;
  const shortExposure = totalBars > 0 ? (shortBars / totalBars) * 100 : 0;

  // CAGR & Time to Double
  const cagr = annualizedReturn;
  const timeToDouble = cagr > 0 ? 72 / cagr : 0;

  // Portfolio Turnover
  const totalTraded = trades.length * (initialCapital * (positionSizePctVal / 100));
  const portfolioTurnover = years > 0 ? totalTraded / initialCapital / years : 0;

  // Directional Accuracy
  const correctDir = trades.filter(t => {
    if (t.action === "BUY" && t.actualReturn > 0) return true;
    if (t.action === "SHORT" && t.actualReturn < 0) return true;
    return false;
  });
  const directionalAccuracy = (correctDir.length / trades.length) * 100;

  // Signal Quality: Precision, Recall, F1
  const truePositives = trades.filter(t => t.action === "BUY" && t.actualReturn > 0).length;
  const falsePositives = trades.filter(t => t.action === "BUY" && t.actualReturn <= 0).length;
  const falseNegatives = trades.filter(t => t.action === "SHORT" && t.actualReturn > 0).length;
  const signalPrecision = (truePositives + falsePositives) > 0 ? (truePositives / (truePositives + falsePositives)) * 100 : 0;
  const signalRecall = (truePositives + falseNegatives) > 0 ? (truePositives / (truePositives + falseNegatives)) * 100 : 0;
  const signalF1 = (signalPrecision + signalRecall) > 0 ? 2 * (signalPrecision * signalRecall) / (signalPrecision + signalRecall) : 0;

  // MAE, RMSE, MAPE
  const errors = trades.map(t => t.predictedReturn - t.actualReturn);
  const maeVal = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length);
  const mape = trades.reduce((a, t) => a + (t.actualReturn !== 0 ? Math.abs((t.predictedReturn - t.actualReturn) / t.actualReturn) : 0), 0) / trades.length * 100;

  // Alpha / Beta — computed from equity curve returns aligned with SPY returns by date
  let alpha = 0, beta = 0;
  if (spyData && spyData.close.length > 1 && equityCurve.length > 2) {
    // Build SPY daily returns indexed by date
    const spyReturnsByDate = new Map<string, number>();
    for (let i = 1; i < spyData.close.length; i++) {
      spyReturnsByDate.set(spyData.timestamps[i], (spyData.close[i] - spyData.close[i - 1]) / spyData.close[i - 1]);
    }

    // Build equity curve returns indexed by date
    const eqReturnsByDate = new Map<string, number>();
    for (let i = 1; i < equityCurve.length; i++) {
      if (equityCurve[i - 1].value > 0) {
        eqReturnsByDate.set(equityCurve[i].date, (equityCurve[i].value - equityCurve[i - 1].value) / equityCurve[i - 1].value);
      }
    }

    // If equity curve is sampled (not daily), compute SPY return over the same intervals
    const stratRets: number[] = [];
    const benchRets: number[] = [];
    const eqDates = Array.from(eqReturnsByDate.keys()).sort();

    if (eqDates.length > 5) {
      // For each equity curve interval, compute the matching SPY return over the same date span
      const sortedEqCurve = [...equityCurve].sort((a, b) => a.date.localeCompare(b.date));
      
      // Build SPY close lookup by date
      const spyCloseByDate = new Map<string, number>();
      for (let i = 0; i < spyData.close.length; i++) {
        spyCloseByDate.set(spyData.timestamps[i], spyData.close[i]);
      }

      for (let i = 1; i < sortedEqCurve.length; i++) {
        const prevDate = sortedEqCurve[i - 1].date;
        const currDate = sortedEqCurve[i].date;
        const spyPrev = spyCloseByDate.get(prevDate);
        const spyCurr = spyCloseByDate.get(currDate);
        const eqPrev = sortedEqCurve[i - 1].value;
        const eqCurr = sortedEqCurve[i].value;
        
        if (spyPrev && spyCurr && spyPrev > 0 && eqPrev > 0) {
          stratRets.push((eqCurr - eqPrev) / eqPrev);
          benchRets.push((spyCurr - spyPrev) / spyPrev);
        }
      }
    }

    if (stratRets.length > 5) {
      const n = stratRets.length;
      const meanS = stratRets.reduce((a, b) => a + b, 0) / n;
      const meanB = benchRets.reduce((a, b) => a + b, 0) / n;
      let covSB = 0, varB = 0;
      for (let i = 0; i < n; i++) {
        covSB += (stratRets[i] - meanS) * (benchRets[i] - meanB);
        varB += (benchRets[i] - meanB) ** 2;
      }
      beta = varB > 0 ? parseFloat((covSB / varB).toFixed(3)) : 0;
      // Alpha = annualized excess return over beta × benchmark
      const spyTotalReturn = (spyData.close[spyData.close.length - 1] - spyData.close[0]) / spyData.close[0];
      const spyAnnReturn = years > 0 ? (Math.pow(1 + spyTotalReturn, 1 / years) - 1) : spyTotalReturn;
      alpha = parseFloat(((annualizedReturn / 100) - beta * spyAnnReturn).toFixed(4));
    }
  }

  // Rolling Sharpe (20-trade window)
  const rollingSharpe: { index: number; value: number }[] = [];
  const ROLLING_WINDOW = 20;
  for (let i = ROLLING_WINDOW; i <= returns.length; i++) {
    const window = returns.slice(i - ROLLING_WINDOW, i).map(r => r / 100);
    const wMean = window.reduce((a, b) => a + b, 0) / window.length;
    const wStd = Math.sqrt(window.reduce((a, b) => a + (b - wMean) ** 2, 0) / window.length);
    const rSharpe = wStd > 0 ? (wMean / wStd) * Math.sqrt(252 / 5) : 0;
    rollingSharpe.push({ index: i, value: parseFloat(rSharpe.toFixed(2)) });
  }

  // Rolling Volatility (20-trade window)
  const rollingVolatility: { index: number; value: number }[] = [];
  for (let i = ROLLING_WINDOW; i <= returns.length; i++) {
    const window = returns.slice(i - ROLLING_WINDOW, i).map(r => r / 100);
    const wMean = window.reduce((a, b) => a + b, 0) / window.length;
    const wStd = Math.sqrt(window.reduce((a, b) => a + (b - wMean) ** 2, 0) / window.length);
    rollingVolatility.push({ index: i, value: parseFloat((wStd * Math.sqrt(252 / 5) * 100).toFixed(2)) });
  }

  // Trade Distribution
  const tradeDistribution: { bucket: string; count: number }[] = [];
  for (let b = -10; b < 10; b++) {
    const count = returns.filter(r => r >= b && r < b + 1).length;
    tradeDistribution.push({ bucket: `${b}%`, count });
  }
  tradeDistribution.push({ bucket: "10%+", count: returns.filter(r => r >= 10).length });

  // Monthly Returns
  const monthlyMap = new Map<string, number[]>();
  for (const t of trades) {
    const key = t.date.substring(0, 7);
    if (!monthlyMap.has(key)) monthlyMap.set(key, []);
    monthlyMap.get(key)!.push(t.returnPct);
  }
  const monthlyReturns = Array.from(monthlyMap.entries()).map(([key, rets]) => ({
    year: parseInt(key.substring(0, 4)),
    month: parseInt(key.substring(5, 7)),
    returnPct: parseFloat(rets.reduce((a, b) => a + b, 0).toFixed(2)),
  }));

  // Regime Performance
  const regimeMap = new Map<string, { correct: number; total: number; returns: number[] }>();
  for (const t of trades) {
    if (!regimeMap.has(t.regime)) regimeMap.set(t.regime, { correct: 0, total: 0, returns: [] });
    const rm = regimeMap.get(t.regime)!;
    rm.total++;
    rm.returns.push(t.returnPct);
    if ((t.action === "BUY" && t.actualReturn > 0) || (t.action === "SHORT" && t.actualReturn < 0)) rm.correct++;
  }
  const regimePerformance = Array.from(regimeMap.entries()).map(([regime, data]) => ({
    regime,
    accuracy: parseFloat(((data.correct / data.total) * 100).toFixed(1)),
    avgReturn: parseFloat((data.returns.reduce((a, b) => a + b, 0) / data.returns.length).toFixed(2)),
    trades: data.total,
  }));

  // Confidence Calibration — buckets aligned to raw conviction distribution
  const confBuckets = [
    { bucket: "60-65%", min: 60, max: 65 },
    { bucket: "65-70%", min: 65, max: 70 },
    { bucket: "70-75%", min: 70, max: 75 },
    { bucket: "75-80%", min: 75, max: 80 },
    { bucket: "80-90%", min: 80, max: 90 },
    { bucket: "90-100%", min: 90, max: 100 },
  ];
  const confidenceCalibration = confBuckets.map(b => {
    const bucketTrades = trades.filter(t => t.confidence >= b.min && t.confidence < b.max);
    if (bucketTrades.length === 0) return { bucket: b.bucket, predictedConf: (b.min + b.max) / 2, actualAccuracy: 0, count: 0 };
    const correct = bucketTrades.filter(t => (t.action === "BUY" && t.actualReturn > 0) || (t.action === "SHORT" && t.actualReturn < 0));
    return {
      bucket: b.bucket,
      predictedConf: parseFloat(((b.min + b.max) / 2).toFixed(0)),
      actualAccuracy: parseFloat(((correct.length / bucketTrades.length) * 100).toFixed(1)),
      count: bucketTrades.length,
    };
  }).filter(b => b.count > 0);

  // ============================================================================
  // NEW INSTITUTIONAL METRICS
  // ============================================================================

  // Skewness & Kurtosis
  const n = returns.length;
  const retMean = returns.reduce((a, b) => a + b, 0) / n;
  const retStd = Math.sqrt(returns.reduce((a, b) => a + (b - retMean) ** 2, 0) / n);
  const skewness = retStd > 0
    ? (returns.reduce((a, b) => a + ((b - retMean) / retStd) ** 3, 0) / n)
    : 0;
  const kurtosis = retStd > 0
    ? (returns.reduce((a, b) => a + ((b - retMean) / retStd) ** 4, 0) / n) - 3
    : 0;

  // Kelly Criterion
  const winRateFrac = wins.length / trades.length;
  const kelly = winLossRatio > 0
    ? winRateFrac - ((1 - winRateFrac) / winLossRatio)
    : 0;

  // Expectancy
  const lossRate = losses.length / trades.length;
  const expectancy = (winRateFrac * avgWin) - (lossRate * Math.abs(avgLoss));

  // Trade Clustering: Max Consecutive Wins/Losses
  let maxConsWins = 0, maxConsLosses = 0, curWins = 0, curLosses = 0;
  for (const t of trades) {
    if (t.pnl > 0) { curWins++; curLosses = 0; maxConsWins = Math.max(maxConsWins, curWins); }
    else { curLosses++; curWins = 0; maxConsLosses = Math.max(maxConsLosses, curLosses); }
  }

  // Capacity Estimation
  const capacities = trades
    .filter(t => t.volumeAtEntry > 0)
    .map(t => t.volumeAtEntry * t.entryPrice * 0.02);
  capacities.sort((a, b) => a - b);
  const strategyCapacity = capacities.length > 0
    ? capacities[Math.floor(capacities.length / 2)]
    : 0;

  const p = (v: number) => parseFloat(v.toFixed(2));

  return {
    totalTrades: trades.length,
    winRate: p(winRate), avgReturn: p(avgReturn), totalReturn: p(totalReturn),
    maxDrawdown: p(maxDrawdown), sharpeRatio: p(sharpeRatio), sortinoRatio: p(sortinoRatio),
    calmarRatio: p(calmarRatio), profitFactor: p(profitFactor),
    directionalAccuracy: p(directionalAccuracy), mae: p(maeVal), rmse: p(rmse), mape: p(mape),
    avgWin: p(avgWin), avgLoss: p(avgLoss), winLossRatio: p(winLossRatio),
    avgTradeDuration: p(avgTradeDuration), medianTradeDuration, maxTradeDuration,
    avgMAE: p(avgMAE), avgMFE: p(avgMFE),
    valueAtRisk: p(valueAtRisk), conditionalVaR: p(conditionalVaR),
    ulcerIndex: p(ulcerIndex),
    marketExposure: p(marketExposure), longExposure: p(longExposure), shortExposure: p(shortExposure),
    cagr: p(cagr), timeToDouble: p(timeToDouble),
    alpha: p(alpha * 100), beta: p(beta),
    portfolioTurnover: p(portfolioTurnover),
    stabilityScore: 0,
    signalPrecision: p(signalPrecision), signalRecall: p(signalRecall), signalF1: p(signalF1),
    regimePerformance, confidenceCalibration, annualizedReturn: p(annualizedReturn),
    rollingSharpe, rollingVolatility, tradeDistribution, monthlyReturns,
    // New metrics
    maxDrawdownDuration, avgDrawdownDuration, recoveryTime, timeInDrawdownPct,
    skewness: p(skewness), kurtosis: p(kurtosis),
    kelly: p(kelly), expectancy: p(expectancy),
    maxConsecutiveWins: maxConsWins, maxConsecutiveLosses: maxConsLosses,
    strategyCapacity: Math.round(strategyCapacity),
  };
}

// ============================================================================
// SIGNAL DECAY
// ============================================================================
function computeSignalDecay(
  data: DataSet,
  trades: Trade[],
): { day: number; accuracy: number }[] {
  const dayOffsets = [1, 3, 5, 7];
  const result: { day: number; accuracy: number }[] = [];

  // O(1) lookup instead of O(n) indexOf
  const timestampMap = new Map<string, number>();
  for (let i = 0; i < data.timestamps.length; i++) {
    timestampMap.set(data.timestamps[i], i);
  }

  for (const offset of dayOffsets) {
    let correct = 0, total = 0;
    for (const t of trades) {
      const entryIdx = timestampMap.get(t.date);
      if (entryIdx === undefined) continue;
      const checkIdx = entryIdx + offset;
      if (checkIdx >= data.close.length) continue;
      const actualMove = data.close[checkIdx] - data.close[entryIdx];
      const predicted = t.action === "BUY" ? 1 : -1;
      const actual = actualMove > 0 ? 1 : actualMove < 0 ? -1 : 0;
      if (predicted === actual) correct++;
      total++;
    }
    result.push({
      day: offset,
      accuracy: total > 0 ? parseFloat(((correct / total) * 100).toFixed(1)) : 0,
    });
  }
  return result;
}

// ============================================================================
// MARKET REGIME (SPY 200MA)
// ============================================================================
function computeMarketRegimePerformance(
  spyData: DataSet | null,
  trades: Trade[],
): { regime: string; accuracy: number; avgReturn: number; trades: number }[] {
  if (!spyData || spyData.close.length < 200 || trades.length === 0) return [];

  const sma200 = calculateSMA(spyData.close, 200);

  // O(1) lookup
  const spyTimestampMap = new Map<string, number>();
  for (let i = 0; i < spyData.timestamps.length; i++) {
    spyTimestampMap.set(spyData.timestamps[i], i);
  }

  const regimeMap = new Map<string, { correct: number; total: number; returns: number[] }>();

  for (const t of trades) {
    const idx = spyTimestampMap.get(t.date);
    if (idx === undefined || idx >= sma200.length || isNaN(sma200[idx])) continue;

    const spyPrice = spyData.close[idx];
    const ma = sma200[idx];
    const pctDiff = ((spyPrice - ma) / ma) * 100;

    let regime: string;
    if (pctDiff > 2) regime = "Bull";
    else if (pctDiff < -2) regime = "Bear";
    else regime = "Sideways";

    if (!regimeMap.has(regime)) regimeMap.set(regime, { correct: 0, total: 0, returns: [] });
    const rm = regimeMap.get(regime)!;
    rm.total++;
    rm.returns.push(t.returnPct);
    if ((t.action === "BUY" && t.actualReturn > 0) || (t.action === "SHORT" && t.actualReturn < 0)) rm.correct++;
  }

  return Array.from(regimeMap.entries()).map(([regime, data]) => ({
    regime,
    accuracy: parseFloat(((data.correct / data.total) * 100).toFixed(1)),
    avgReturn: parseFloat((data.returns.reduce((a, b) => a + b, 0) / data.returns.length).toFixed(2)),
    trades: data.total,
  }));
}

// ============================================================================
// BENCHMARK EQUITY CURVE
// ============================================================================
function computeBenchmarkEquity(
  spyData: DataSet | null,
  initialCapital: number,
): { date: string; value: number }[] {
  if (!spyData || spyData.close.length < 2) return [];
  const startPrice = spyData.close[0];
  // Sample every ~20 bars to keep payload small
  const step = Math.max(1, Math.floor(spyData.close.length / 100));
  const curve: { date: string; value: number }[] = [];
  for (let i = 0; i < spyData.close.length; i += step) {
    curve.push({
      date: spyData.timestamps[i],
      value: parseFloat((initialCapital * (spyData.close[i] / startPrice)).toFixed(0)),
    });
  }
  // Always include last point
  const lastIdx = spyData.close.length - 1;
  if (curve[curve.length - 1]?.date !== spyData.timestamps[lastIdx]) {
    curve.push({
      date: spyData.timestamps[lastIdx],
      value: parseFloat((initialCapital * (spyData.close[lastIdx] / startPrice)).toFixed(0)),
    });
  }
  return curve;
}

// ============================================================================
// TRADE DEPENDENCY TEST
// ============================================================================
function runTradeDependencyTest(
  trades: Trade[],
  initialCapital: number,
  baseReturn: number,
): { baseReturn: number; reducedReturn: number; impact: number; passed: boolean } | null {
  if (trades.length < 20) return null;

  const iterations = 5;
  let totalReducedReturn = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Remove 10% random trades
    const removeCount = Math.max(1, Math.floor(trades.length * 0.1));
    const indices = new Set<number>();
    while (indices.size < removeCount) {
      indices.add(Math.floor(Math.random() * trades.length));
    }

    let capital = initialCapital;
    for (let i = 0; i < trades.length; i++) {
      if (indices.has(i)) continue;
      capital += trades[i].pnl;
    }
    totalReducedReturn += ((capital - initialCapital) / initialCapital) * 100;
  }

  const reducedReturn = totalReducedReturn / iterations;
  const impact = Math.abs(baseReturn - reducedReturn);
  const relativeImpact = baseReturn !== 0 ? impact / Math.abs(baseReturn) : impact;

  return {
    baseReturn: parseFloat(baseReturn.toFixed(2)),
    reducedReturn: parseFloat(reducedReturn.toFixed(2)),
    impact: parseFloat(impact.toFixed(2)),
    passed: relativeImpact < 0.5, // passes if removing 10% trades changes return by <50%
  };
}

// ============================================================================
// MONTE CARLO SIMULATION
// ============================================================================
function runMonteCarlo(trades: Trade[], initialCapital: number, simulations: number = 200, positionSizePct: number = 10): BacktestReport['monteCarlo'] {
  if (trades.length < 5) return null;
  const tradeReturns = trades.map(t => t.returnPct / 100);
  const positionSizeFrac = positionSizePct / 100;
  const finalValues: number[] = [];

  for (let s = 0; s < simulations; s++) {
    let capital = initialCapital;
    const shuffled = [...tradeReturns].sort(() => Math.random() - 0.5);
    for (const ret of shuffled) {
      capital *= (1 + ret * positionSizeFrac);
    }
    finalValues.push(((capital - initialCapital) / initialCapital) * 100);
  }

  finalValues.sort((a, b) => a - b);
  const percentile = (p: number) => finalValues[Math.floor(p * finalValues.length / 100)] || 0;

  return {
    percentile5: parseFloat(percentile(5).toFixed(2)),
    percentile25: parseFloat(percentile(25).toFixed(2)),
    median: parseFloat(percentile(50).toFixed(2)),
    percentile75: parseFloat(percentile(75).toFixed(2)),
    percentile95: parseFloat(percentile(95).toFixed(2)),
  };
}

// ============================================================================
// WALK-FORWARD PERIOD BREAKDOWN
// ============================================================================
function computePeriods(trades: Trade[]): BacktestReport['periods'] {
  if (trades.length === 0) return [];
  const periods: BacktestReport['periods'] = [];
  const yearMap = new Map<string, Trade[]>();
  for (const t of trades) {
    const year = t.date.substring(0, 4);
    if (!yearMap.has(year)) yearMap.set(year, []);
    yearMap.get(year)!.push(t);
  }

  for (const [year, yearTrades] of yearMap) {
    const correct = yearTrades.filter(t =>
      (t.action === "BUY" && t.actualReturn > 0) || (t.action === "SHORT" && t.actualReturn < 0)
    );
    const totalRet = yearTrades.reduce((a, t) => a + t.returnPct, 0);
    periods.push({
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      accuracy: parseFloat(((correct.length / yearTrades.length) * 100).toFixed(1)),
      returnPct: parseFloat((totalRet / yearTrades.length).toFixed(2)),
      trades: yearTrades.length,
    });
  }
  return periods;
}

// ============================================================================
// DRAWDOWN CURVE
// ============================================================================
function computeDrawdownCurve(equityCurve: { date: string; value: number }[]): { date: string; drawdown: number }[] {
  let peak = equityCurve[0]?.value || 0;
  return equityCurve.map(p => {
    if (p.value > peak) peak = p.value;
    return { date: p.date, drawdown: parseFloat((((peak - p.value) / peak) * -100).toFixed(2)) };
  });
}

// ============================================================================
// STRESS TESTING
// ============================================================================
function detectStressPeriods(
  spyData: DataSet | null,
  allTrades: Trade[],
): BacktestReport['stressTests'] {
  if (!spyData || spyData.close.length < 60) return [];

  const stressTests: BacktestReport['stressTests'] = [];
  const { close, timestamps } = spyData;

  for (let i = 60; i < close.length; i += 30) {
    const windowClose = close.slice(i - 60, i);
    const windowPeak = Math.max(...windowClose);
    const peakIdx = windowClose.indexOf(windowPeak);
    const afterPeak = windowClose.slice(peakIdx + 1);
    if (afterPeak.length === 0) continue;
    const windowTrough = Math.min(...afterPeak);
    const dd = ((windowPeak - windowTrough) / windowPeak) * 100;

    if (dd > 15) {
      const startDate = timestamps[i - 60];
      const endDate = timestamps[i];
      const benchReturn = ((close[i] - close[i - 60]) / close[i - 60]) * 100;

      const windowTrades = allTrades.filter(t => t.date >= startDate && t.date <= endDate);
      if (windowTrades.length === 0) continue;

      const stratReturn = windowTrades.reduce((a, t) => a + t.returnPct, 0);

      let label = "Market Stress";
      if (startDate >= "2020-02" && startDate <= "2020-04") label = "COVID Crash";
      else if (startDate >= "2022-01" && startDate <= "2022-10") label = "2022 Bear Market";
      else if (startDate >= "2008-09" && startDate <= "2009-03") label = "2008 Financial Crisis";
      else if (startDate >= "2018-10" && startDate <= "2019-01") label = "Q4 2018 Selloff";

      if (!stressTests.find(s => s.period === label)) {
        stressTests.push({
          period: label,
          startDate,
          endDate,
          strategyReturn: parseFloat(stratReturn.toFixed(2)),
          benchmarkReturn: parseFloat(benchReturn.toFixed(2)),
          maxDrawdown: parseFloat(dd.toFixed(2)),
        });
      }
    }
  }

  return stressTests.slice(0, 5);
}

// ============================================================================
// ROBUSTNESS TESTS
// ============================================================================
function runRobustnessTests(
  data: DataSet,
  ticker: string,
  config: BacktestConfig,
  tradeConfig: TradeConfig,
  baseReturn: number,
  allTrades: Trade[],
  tickerCount: number = 1,
): BacktestReport['robustness'] {
  const ROBUSTNESS_STEP = 10; // Faster step for robustness sub-runs
  const isHeavy = tickerCount >= 3;

  let noiseInjection: BacktestReport['robustness']['noiseInjection'] = null;
  let delayedExecution: BacktestReport['robustness']['delayedExecution'] = null;

  // 1. Noise Injection (skip for 3+ tickers)
  if (!isHeavy) {
    const noisyData: DataSet = {
      ...data,
      close: data.close.map(p => p * (1 + (Math.random() - 0.5) * 0.01)),
      high: data.high.map(p => p * (1 + (Math.random() - 0.5) * 0.01)),
      low: data.low.map(p => p * (1 + (Math.random() - 0.5) * 0.01)),
      open: data.open.map(p => p * (1 + (Math.random() - 0.5) * 0.01)),
    };
    const noisyResult = runWalkForwardBacktest(noisyData, ticker, config, tradeConfig, 1, ROBUSTNESS_STEP);
    const noisyFinal = noisyResult.equityCurve[noisyResult.equityCurve.length - 1]?.value || config.initialCapital;
    const noisyReturn = ((noisyFinal - config.initialCapital) / config.initialCapital) * 100;
    const noiseImpact = Math.abs(baseReturn - noisyReturn);
    noiseInjection = {
      baseReturn: parseFloat(baseReturn.toFixed(2)),
      noisyReturn: parseFloat(noisyReturn.toFixed(2)),
      impact: parseFloat(noiseImpact.toFixed(2)),
      passed: noiseImpact < Math.abs(baseReturn) * 0.5,
    };
  }

  // 2. Delayed Execution (skip for 3+ tickers)
  if (!isHeavy) {
    const delayedResult = runWalkForwardBacktest(data, ticker, config, tradeConfig, 2, ROBUSTNESS_STEP);
    const delayedFinal = delayedResult.equityCurve[delayedResult.equityCurve.length - 1]?.value || config.initialCapital;
    const delayedReturn = ((delayedFinal - config.initialCapital) / config.initialCapital) * 100;
    const delayImpact = Math.abs(baseReturn - delayedReturn);
    delayedExecution = {
      baseReturn: parseFloat(baseReturn.toFixed(2)),
      delayedReturn: parseFloat(delayedReturn.toFixed(2)),
      impact: parseFloat(delayImpact.toFixed(2)),
      passed: delayImpact < Math.abs(baseReturn) * 0.5,
    };
  }

  // 3. Parameter Sensitivity (3 variations for heavy, 5 for light)
  const paramResults: BacktestReport['robustness']['parameterSensitivity'] = [];
  const thresholdVariations = isHeavy ? [20, 30, 40] : [20, 25, 30, 35, 40];
  for (const thresh of thresholdVariations) {
    const modConfig = { ...config, buyThreshold: thresh, shortThreshold: -thresh };
    const result = runWalkForwardBacktest(data, ticker, modConfig, tradeConfig, 1, ROBUSTNESS_STEP);
    const final = result.equityCurve[result.equityCurve.length - 1]?.value || config.initialCapital;
    const ret = ((final - config.initialCapital) / config.initialCapital) * 100;
    const rets = result.trades.map(t => t.returnPct / 100);
    const mean = rets.length > 0 ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const std = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) : 0.001;
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252 / 5) : 0;
    paramResults.push({
      param: `Threshold ±${thresh}`,
      value: thresh,
      returnPct: parseFloat(ret.toFixed(2)),
      sharpe: parseFloat(sharpe.toFixed(2)),
    });
  }

  // 4. Trade Dependency Test
  const tradeDependency = runTradeDependencyTest(allTrades, config.initialCapital, baseReturn);

  return {
    noiseInjection,
    delayedExecution,
    parameterSensitivity: paramResults,
    tradeDependency,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const startTime = Date.now();
    const body = await req.json();
    const {
      tickers = ["AAPL"],
      startYear = 2020,
      endYear = 2025,
      initialCapital = 10000,
      positionSizePct = 10,
      stopLossPct = 5,
      takeProfitPct = 10,
      maxPositions = 3,
      rebalanceFrequency = "weekly",
      includeMonteCarlo = true,
      buyThreshold = 65,
      shortThreshold = -65,
      adxThreshold = 25,
      rsiOversold = 30,
      rsiOverbought = 70,
      trailingStopATRMult = 2.0,
      maxHoldBars = 20,
      riskPerTrade = 0.01,
      strategyMode = "adaptive",
      explicitOverride = false,
    } = body;

    console.log(`Backtest request: ${tickers.join(",")} from ${startYear} to ${endYear}, mode=${strategyMode}, buyThresh=${buyThreshold}, adx=${adxThreshold}`);

    // Validate years
    if (startYear < 2000 || startYear > 2026) {
      return new Response(JSON.stringify({ error: "Invalid start year. Please use a 4-digit year between 2000 and 2026." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (endYear <= startYear) {
      return new Response(JSON.stringify({ error: "End year must be after start year." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const config: BacktestConfig & { strategyMode: string; explicitOverride: boolean } = {
      tickers: tickers.slice(0, 5),
      startYear, endYear, initialCapital, positionSizePct,
      stopLossPct, takeProfitPct, maxPositions,
      rebalanceFrequency, includeMonteCarlo,
      buyThreshold, shortThreshold,
      adxThreshold, rsiOversold, rsiOverbought,
      trailingStopATRMult, maxHoldBars,
      riskPerTrade,
      strategyMode,
      explicitOverride,
    };

    const tradeConfig: TradeConfig = {
      initialCapital,
      positionSizePct,
      stopLossPct,
      takeProfitPct,
      commissionPct: 0.1,
      spreadPct: 0.05,
      slippagePct: 0.1,
    };

    const startDate = Math.floor(new Date(`${startYear}-01-01`).getTime() / 1000);
    const endDate = Math.floor(new Date(`${endYear}-12-31`).getTime() / 1000);

    const fetchPromises = [...config.tickers, "SPY"].map(t => fetchYahooData(t, startDate, endDate));
    const allDataResults = await Promise.all(fetchPromises);

    const spyData = allDataResults[allDataResults.length - 1];
    const tickerData = allDataResults.slice(0, -1);

    // SPY daily returns for alpha/beta
    const benchmarkReturns: number[] = [];
    if (spyData) {
      for (let i = 1; i < spyData.close.length; i++) {
        benchmarkReturns.push((spyData.close[i] - spyData.close[i - 1]) / spyData.close[i - 1]);
      }
    }

    let allTrades: Trade[] = [];
    let combinedEquity: { date: string; value: number }[] = [];
    let totalBarsAll = 0, barsInTradeAll = 0;
    let firstTickerData: DataSet | null = null;
    const stockProfiles: Record<string, StockClassification> = {};
    const tickerCount = config.tickers.length;

    // Bug Fix #2: Count valid tickers FIRST, then split capital properly
    const validTickerIndices = config.tickers
      .map((_, ti) => ti)
      .filter(ti => tickerData[ti] && tickerData[ti]!.close.length >= 100);

    // Log which tickers failed
    config.tickers.forEach((t, ti) => {
      if (!tickerData[ti]) console.log(`Ticker ${t}: no data returned`);
      else if (tickerData[ti]!.close.length < 100) console.log(`Ticker ${t}: only ${tickerData[ti]!.close.length} bars (need 100+)`);
    });

    if (validTickerIndices.length === 0) {
      return new Response(JSON.stringify({ error: "No valid market data found for the given tickers and date range. Ensure tickers are correct and the date range has enough trading days." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const numTickers = validTickerIndices.length;
    const capitalPerTicker = config.initialCapital / numTickers;

    for (const idx of validTickerIndices) {
      const data = tickerData[idx]!;

      if (!firstTickerData) firstTickerData = data;

      // Pass per-ticker capital so position sizing is correct
      const tickerConfig = { ...config, initialCapital: capitalPerTicker };
      const tickerTradeConfig = { ...tradeConfig, initialCapital: capitalPerTicker };

      const { trades, equityCurve, totalBars, barsInTrade, stockClassification } = runWalkForwardBacktest(data, config.tickers[idx], tickerConfig, tickerTradeConfig, 1, undefined, spyData);
      if (stockClassification) stockProfiles[config.tickers[idx]] = stockClassification;
      allTrades = allTrades.concat(trades);
      totalBarsAll += totalBars;
      barsInTradeAll += barsInTrade;

      if (combinedEquity.length === 0) {
        combinedEquity = equityCurve.map(p => ({ date: p.date, value: p.value }));
      } else {
        for (const point of equityCurve) {
          const pnl = point.value - capitalPerTicker;
          const existing = combinedEquity.find(c => c.date === point.date);
          if (existing) {
            existing.value += pnl;
          } else {
            combinedEquity.push({ date: point.date, value: capitalPerTicker + pnl });
          }
        }
      }
    }

    combinedEquity.sort((a, b) => a.date.localeCompare(b.date));

    // Cap equity curve points to 500 to reduce serialization
    if (combinedEquity.length > 500) {
      const step = Math.ceil(combinedEquity.length / 500);
      const sampled: typeof combinedEquity = [];
      for (let i = 0; i < combinedEquity.length; i += step) {
        sampled.push(combinedEquity[i]);
      }
      // Always include last point
      if (sampled[sampled.length - 1] !== combinedEquity[combinedEquity.length - 1]) {
        sampled.push(combinedEquity[combinedEquity.length - 1]);
      }
      combinedEquity = sampled;
    }

    const years = endYear - startYear;

    // Compute metrics
    const metrics = computeMetrics(allTrades, initialCapital, combinedEquity, years, totalBarsAll, barsInTradeAll, benchmarkReturns, positionSizePct, spyData);
    const periods = computePeriods(allTrades);
    const drawdownCurve = computeDrawdownCurve(combinedEquity);

    // Stability score from periods
    if (periods.length > 1) {
      const periodReturns = periods.map(p => p.returnPct);
      const mean = periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length;
      const std = Math.sqrt(periodReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / periodReturns.length);
      metrics.stabilityScore = parseFloat(std.toFixed(2));
    }

    // Monte Carlo (reduced to 200 sims)
    let monteCarlo = null;
    if (includeMonteCarlo && allTrades.length >= 10) {
      monteCarlo = runMonteCarlo(allTrades, initialCapital, 200, positionSizePct);
    }

    // Benchmark return
    let benchmarkReturn = 0;
    if (spyData && spyData.close.length > 1) {
      benchmarkReturn = parseFloat((((spyData.close[spyData.close.length - 1] - spyData.close[0]) / spyData.close[0]) * 100).toFixed(2));
    }

    // Stress testing
    const stressTests = detectStressPeriods(spyData, allTrades);

    // CPU budget guard: check elapsed time before robustness tests
    const elapsedMs = Date.now() - startTime;
    let robustnessSkipped = false;
    let robustness: BacktestReport['robustness'] = {
      noiseInjection: null,
      delayedExecution: null,
      parameterSensitivity: [],
      tradeDependency: null,
    };

    if (elapsedMs > 1500) {
      console.log(`CPU budget exceeded (${elapsedMs}ms), skipping robustness tests`);
      robustnessSkipped = true;
    } else if (firstTickerData && firstTickerData.close.length >= 100) {
      const baseReturn = metrics.totalReturn || 0;
      robustness = runRobustnessTests(firstTickerData, config.tickers[0], config, tradeConfig, baseReturn, allTrades, tickerCount);
    }

    // Liquidity warnings
    const liquidityWarnings = allTrades.filter(t => {
      if (t.volumeAtEntry <= 0) return false;
      const positionValue = initialCapital * (positionSizePct / 100);
      const sharesTraded = positionValue / t.entryPrice;
      return sharesTraded > t.volumeAtEntry * 0.02;
    }).length;

    // Signal Decay (with Map optimization)
    const signalDecay = firstTickerData
      ? computeSignalDecay(firstTickerData, allTrades.filter(t => t.ticker === config.tickers[0]))
      : [];

    // Benchmark Equity Curve
    const benchmarkEquity = computeBenchmarkEquity(spyData, initialCapital);

    // Market Regime Performance (with Map optimization)
    const marketRegimePerformance = computeMarketRegimePerformance(spyData, allTrades);

    // Strategy Performance Attribution
    const strategyPerformance = (() => {
      const strategies = ["trend", "mean_reversion", "breakout"] as const;
      return strategies.map(s => {
        const sTrades = allTrades.filter(t => t.strategy === s);
        const wins = sTrades.filter(t => t.returnPct > 0).length;
        const avgRet = sTrades.length > 0 ? sTrades.reduce((a, t) => a + t.returnPct, 0) / sTrades.length : 0;
        return {
          strategy: s,
          trades: sTrades.length,
          winRate: sTrades.length > 0 ? parseFloat(((wins / sTrades.length) * 100).toFixed(1)) : 0,
          avgReturn: parseFloat(avgRet.toFixed(2)),
        };
      }).filter(s => s.trades > 0);
    })();

    const report: BacktestReport = {
      ...metrics as any,
      periods,
      tradeLog: allTrades.slice(-200),
      equityCurve: combinedEquity,
      drawdownCurve,
      monteCarlo,
      benchmarkReturn,
      robustness,
      robustnessSkipped,
      stressTests,
      liquidityWarnings,
      signalDecay,
      benchmarkEquity,
      marketRegimePerformance,
      strategyPerformance,
      stockProfiles,
    };

    const profileSummary = Object.entries(stockProfiles).map(([t, p]) => `${t}:${p.classification}`).join(', ');
    console.log(`Backtest complete: ${allTrades.length} trades, Win Rate: ${metrics.winRate}%, Sharpe: ${metrics.sharpeRatio}, Profiles: [${profileSummary}], elapsed: ${Date.now() - startTime}ms`);

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Backtest error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Backtest failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
