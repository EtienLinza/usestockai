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
}

const PROFILE_PARAMS: Record<StockProfile, ProfileParams> = {
  momentum: {
    adxThreshold: 20, rsiOversold: 35, rsiOverbought: 65,
    maxHoldTrend: 30, maxHoldMR: 8, maxHoldBreakout: 22,
    takeProfitPct: 15, trailingStopATRMult: 2.5,
    buyThreshold: 60, shortThreshold: 70,
    trendConvictionBonus: 10, mrConvictionBonus: 0, breakoutConvictionBonus: 0,
  },
  value: {
    adxThreshold: 30, rsiOversold: 25, rsiOverbought: 75,
    maxHoldTrend: 15, maxHoldMR: 12, maxHoldBreakout: 11,
    takeProfitPct: 8, trailingStopATRMult: 1.5,
    buyThreshold: 65, shortThreshold: 60,
    trendConvictionBonus: 0, mrConvictionBonus: 10, breakoutConvictionBonus: 0,
  },
  index: {
    adxThreshold: 25, rsiOversold: 30, rsiOverbought: 70,
    maxHoldTrend: 20, maxHoldMR: 10, maxHoldBreakout: 15,
    takeProfitPct: 10, trailingStopATRMult: 2.0,
    buyThreshold: 65, shortThreshold: 65,
    trendConvictionBonus: 0, mrConvictionBonus: 0, breakoutConvictionBonus: 0,
  },
  volatile: {
    adxThreshold: 20, rsiOversold: 20, rsiOverbought: 80,
    maxHoldTrend: 12, maxHoldMR: 6, maxHoldBreakout: 9,
    takeProfitPct: 12, trailingStopATRMult: 3.0,
    buyThreshold: 70, shortThreshold: 60,
    trendConvictionBonus: 0, mrConvictionBonus: 0, breakoutConvictionBonus: 5,
  },
};

function classifyStock(close: number[], high: number[], low: number[]): StockClassification {
  const n = close.length;

  // 1. Daily returns
  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push((close[i] - close[i - 1]) / close[i - 1]);

  // 2. Average daily volatility (std of returns)
  const retMean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const avgVolatility = Math.sqrt(returns.reduce((a, b) => a + (b - retMean) ** 2, 0) / returns.length);

  // 3. Trend persistence: average autocorrelation of returns (lag 1-5)
  let totalAutoCorr = 0;
  const maxLag = Math.min(5, returns.length - 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = lag; i < returns.length; i++) {
      const x = returns[i - lag] - retMean;
      const y = returns[i] - retMean;
      sumXY += x * y;
      sumX2 += x * x;
      sumY2 += y * y;
    }
    const denom = Math.sqrt(sumX2 * sumY2);
    totalAutoCorr += denom > 0 ? sumXY / denom : 0;
  }
  const trendPersistence = maxLag > 0 ? totalAutoCorr / maxLag : 0;

  // 4. Mean reversion rate: % of RSI extremes that snap back within 5 bars
  const rsi = calculateRSI(close, 14);
  let extremeCount = 0, revertCount = 0;
  for (let i = 20; i < n - 5; i++) {
    if (isNaN(rsi[i])) continue;
    if (rsi[i] < 30 || rsi[i] > 70) {
      extremeCount++;
      // Check if RSI reverts toward 50 within 5 bars
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

  // 6. Classification logic
  // Known index tickers get fast-tracked
  let classification: StockProfile;

  if (atrPctAvg > 0.035 && trendPersistence < 0.05) {
    // Very high ATR%, low autocorrelation → volatile
    classification = "volatile";
  } else if (trendPersistence > 0.06 && avgVolatility > 0.012) {
    // High trend persistence + moderate-high vol → momentum
    classification = "momentum";
  } else if (meanReversionRate > 0.55 && trendPersistence < 0.04) {
    // High mean reversion, low trend persistence → value
    classification = "value";
  } else {
    // Default: moderate everything → index
    classification = "index";
  }

  return { classification, trendPersistence, meanReversionRate, avgVolatility, atrPctAvg };
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
  signalParams?: { adxThreshold?: number; rsiOversold?: number; rsiOverbought?: number; buyThreshold?: number; shortThreshold?: number },
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

  // --- Strategy A: Trend Following (ADX > threshold) ---
  // Conviction on TRUE 0-100 scale: no hardcoded floor
  let trendSignal: "BUY" | "SHORT" | "HOLD" = "HOLD";
  let trendConviction = 0;
  if (adxVal > ADX_THRESH) {
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
    if (trendBuyScore >= 3 && above200 && !dualSMADeclining) {
      trendSignal = "BUY";
      let conv = trendBuyScore * 20;
      conv += Math.min((adxVal - ADX_THRESH) * 0.5, 15);
      conv += Math.min(Math.abs(macdH) * 5, 10);
      if (rsiVal >= 40 && rsiVal <= 60) conv += 5;
      trendConviction = Math.min(100, conv);
    // Dual-Regime Layer 1: Block trend SHORTs only when BOTH stock AND SPY 200 SMA are rising
    } else if (trendShortScore >= 3 && below200 && !(sma200Rising && ctx.spyBearish === false)) {
      trendSignal = "SHORT";
      let conv = trendShortScore * 20;
      conv += Math.min((adxVal - ADX_THRESH) * 0.5, 15);
      conv += Math.min(Math.abs(macdH) * 5, 10);
      if (rsiVal >= 40 && rsiVal <= 55) conv += 5;
      trendConviction = Math.min(100, conv);
    }
  }

  // --- Strategy B: Mean Reversion (ADX < threshold) ---
  // Conviction 0-100: base = score*18 (3/5=54, 4/5=72, 5/5=90)
  let mrSignal: "BUY" | "SHORT" | "HOLD" = "HOLD";
  let mrConviction = 0;
  if (adxVal < ADX_THRESH) {
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

    // Dual-Regime Layer 1: Block MR buys only when BOTH stock below 200 AND SPY bearish
    if (mrBuyScore >= 3 && !dualRegimeBearBlock) {
      mrSignal = "BUY";
      let conv = mrBuyScore * 18;
      conv += Math.min(Math.abs(rsiVal - 50) * 0.3, 10);
      conv += Math.min(Math.abs(smaDeviation) * 100, 10);
      mrConviction = Math.min(100, conv);
    } else if (mrShortScore >= 3 && !(above200 && ctx.spyBearish === false)) {
      mrSignal = "SHORT";
      let conv = mrShortScore * 18;
      conv += Math.min(Math.abs(rsiVal - 50) * 0.3, 10);
      conv += Math.min(Math.abs(smaDeviation) * 100, 10);
      mrConviction = Math.min(100, conv);
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
    if (bestSignal === "BUY") adjustedConviction += 15;
  }
  // If stock is in its own strong downtrend, boost SHORT conviction
  if (below200 && sma200Slope < -0.02 && rsiVal > 30 && rsiVal < 60) {
    if (bestSignal === "SHORT") adjustedConviction += 15;
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

  let confidence = 50 + cappedConviction * 0.35;
  if (regime.includes("strong")) confidence += 5;
  confidence = Math.max(40, Math.min(95, Math.round(confidence)));

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
  exitReason: "stop_loss" | "take_profit" | "trailing_stop" | "time_exit";
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

interface OpenPosition {
  entryIdx: number;
  entryPrice: number;
  action: "BUY" | "SHORT";
  strategy: "trend" | "mean_reversion" | "breakout" | "none";
  maxHoldBars: number;
  useTrailingStop: boolean;
  trailingStopDist: number;
  breakevenThreshold: number;
  effectiveStopPct: number;
  takeProfitPct: number;
  positionSize: number;
  shares: number;
  commission: number;
  regime: string;
  confidence: number;
  predictedReturn: number;
  signal_atr: number;
  positionSizeMultiplier: number;
  // Tracking state
  peakReturn: number;
  breakEvenActivated: boolean;
  maxAdverse: number;
  maxFavorable: number;
}

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
  const STEP = stepOverride || 3;
  let totalBars = 0;
  let barsInTrade = 0;
  const COOLDOWN_BARS = 5;

  const signalState = createSignalTracker();
  const openPositions: OpenPosition[] = [];
  const cooldownPerTicker = new Map<string, number>();

  // Build SPY date→close map + compute SPY 200 SMA for short filtering
  const spyDateMap = new Map<string, number>();
  const spy200SMAMap = new Map<string, boolean>(); // date → whether SPY > SMA200
  const spySMADecliningMap = new Map<string, boolean>(); // date → whether SPY 200 SMA slope is declining
  if (spyData && spyData.close.length >= 200) {
    const spySMA200 = calculateSMA(spyData.close, 200);
    for (let si = 0; si < spyData.timestamps.length; si++) {
      spyDateMap.set(spyData.timestamps[si], spyData.close[si]);
      if (!isNaN(spySMA200[si])) {
        spy200SMAMap.set(spyData.timestamps[si], spyData.close[si] > spySMA200[si]);
        // Compute SPY 200 SMA slope (20-bar ROC)
        if (si >= 20 && !isNaN(spySMA200[si - 20]) && spySMA200[si - 20] > 0) {
          const spySlope = (spySMA200[si] - spySMA200[si - 20]) / spySMA200[si - 20];
          spySMADecliningMap.set(spyData.timestamps[si], spySlope < -0.01);
        }
      }
    }
  }

  // --- Stock Classification (initial + rolling re-eval every 250 bars) ---
  const CLASSIFY_WINDOW = 250;
  let currentClassification: StockClassification | null = null;
  let activeProfile: ProfileParams = PROFILE_PARAMS["index"]; // default
  let lastClassifyBar = -CLASSIFY_WINDOW; // force initial classification

  // Check if user explicitly set params (non-default = explicit)
  const userExplicitADX = config.adxThreshold !== 25;
  const userExplicitRSIOS = config.rsiOversold !== 30;
  const userExplicitRSIOB = config.rsiOverbought !== 70;
  const userExplicitBuyThresh = config.buyThreshold !== 60;
  const userExplicitShortThresh = Math.abs(config.shortThreshold) !== 60;
  const userExplicitMaxHold = config.maxHoldBars !== 20;
  const userExplicitTP = config.takeProfitPct !== 10;
  const userExplicitTSMult = config.trailingStopATRMult !== 2.0;

  for (let i = TRAIN_WINDOW; i < close.length - 1; i += STEP) {
    totalBars += STEP;

    // --- Rolling stock classification every 250 bars ---
    if (i - lastClassifyBar >= CLASSIFY_WINDOW && i >= CLASSIFY_WINDOW) {
      const classWindow = Math.min(i, CLASSIFY_WINDOW);
      const cClose = close.slice(i - classWindow, i);
      const cHigh = high.slice(i - classWindow, i);
      const cLow = low.slice(i - classWindow, i);
      if (cClose.length >= 50) {
        currentClassification = classifyStock(cClose, cHigh, cLow);
        activeProfile = PROFILE_PARAMS[currentClassification.classification];
        lastClassifyBar = i;
      }
    }

    // --- Phase 1: Check exits for all open positions ---
    for (let p = openPositions.length - 1; p >= 0; p--) {
      const pos = openPositions[p];
      let exited = false;
      let exitPrice = 0;
      let exitDate = "";
      let exitIdx = i;
      let exitReason: Trade["exitReason"] = "time_exit";

      // Check each bar since last evaluation
      const checkStart = Math.max(pos.entryIdx + 1, i - STEP + 1);
      const checkEnd = Math.min(i, close.length - 1);
      
      for (let j = checkStart; j <= checkEnd; j++) {
        const priceChange = pos.action === "BUY"
          ? (close[j] - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - close[j]) / pos.entryPrice;

        if (priceChange < 0) pos.maxAdverse = Math.min(pos.maxAdverse, priceChange);
        if (priceChange > 0) pos.maxFavorable = Math.max(pos.maxFavorable, priceChange);
        if (priceChange > pos.peakReturn) pos.peakReturn = priceChange;
        if (priceChange >= pos.breakevenThreshold) pos.breakEvenActivated = true;

        // Hard stop-loss
        if (priceChange <= -pos.effectiveStopPct) {
          exitPrice = pos.action === "BUY"
            ? pos.entryPrice * (1 - pos.effectiveStopPct)
            : pos.entryPrice * (1 + pos.effectiveStopPct);
          exitDate = timestamps[j]; exitIdx = j; exitReason = "stop_loss"; exited = true; break;
        }

        // Hard take-profit
        if (priceChange >= pos.takeProfitPct) {
          exitPrice = pos.action === "BUY"
            ? pos.entryPrice * (1 + pos.takeProfitPct)
            : pos.entryPrice * (1 - pos.takeProfitPct);
          exitDate = timestamps[j]; exitIdx = j; exitReason = "take_profit"; exited = true; break;
        }

        // Trailing stop
        if (pos.useTrailingStop && pos.peakReturn > pos.breakevenThreshold) {
          const trailLevel = pos.peakReturn - pos.trailingStopDist;
          const stopLevel = pos.breakEvenActivated ? Math.max(0, trailLevel) : trailLevel;
          if (priceChange <= stopLevel) {
            exitPrice = close[j];
            exitDate = timestamps[j]; exitIdx = j; exitReason = "trailing_stop"; exited = true; break;
          }
        }

        // Time exit
        if (j - pos.entryIdx >= pos.maxHoldBars) {
          exitPrice = close[j];
          exitDate = timestamps[j]; exitIdx = j; exitReason = "time_exit"; exited = true; break;
        }
      }

      // Also check time exit at current bar
      if (!exited && (i - pos.entryIdx >= pos.maxHoldBars)) {
        exitPrice = close[Math.min(i, close.length - 1)];
        exitDate = timestamps[Math.min(i, close.length - 1)];
        exitIdx = Math.min(i, close.length - 1);
        exitReason = "time_exit";
        exited = true;
      }

      if (exited) {
        exitPrice = applyTradingCosts(exitPrice, pos.action !== "BUY", tradeConfig);
        let pnl: number;
        if (pos.action === "BUY") {
          pnl = (exitPrice - pos.entryPrice) * pos.shares - pos.commission;
        } else {
          pnl = (pos.entryPrice - exitPrice) * pos.shares - pos.commission;
        }
        const returnPct = (pnl / pos.positionSize) * 100;
        const actualReturn = (close[Math.min(exitIdx, close.length - 1)] - close[pos.entryIdx]) / close[pos.entryIdx] * 100;
        const duration = exitIdx - pos.entryIdx;

        capital += pos.positionSize + pnl; // Return deployed capital + profit/loss
        barsInTrade += duration;

        trades.push({
          date: timestamps[pos.entryIdx], exitDate, ticker,
          action: pos.action, entryPrice: pos.entryPrice, exitPrice, returnPct, pnl,
          regime: pos.regime, confidence: pos.confidence,
          predictedReturn: pos.predictedReturn, actualReturn, duration,
          mae: parseFloat((pos.maxAdverse * 100).toFixed(2)),
          mfe: parseFloat((pos.maxFavorable * 100).toFixed(2)),
          volumeAtEntry: volume[pos.entryIdx] || 0,
          strategy: pos.strategy, exitReason,
        });

        // Equity = cash + mark-to-market of remaining open positions
        const openMTM = openPositions.reduce((sum, op, idx) => {
          if (idx === p) return sum; // This one is being closed
          const currentVal = op.action === "BUY"
            ? op.shares * close[Math.min(exitIdx, close.length - 1)]
            : op.positionSize + (op.entryPrice - close[Math.min(exitIdx, close.length - 1)]) * op.shares;
          return sum + currentVal;
        }, 0);
        equityCurve.push({ date: exitDate, value: capital + openMTM });
        openPositions.splice(p, 1);
      }
    }

    // --- Phase 2: Evaluate new signals if we have capacity ---
    if (openPositions.length >= config.maxPositions) continue;
    if (i + executionDelay >= close.length) continue;

    // Per-ticker cooldown check
    const tickerCooldown = cooldownPerTicker.get(ticker) || 0;
    if (i < tickerCooldown) continue;

    const trainClose = close.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainHigh = high.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainLow = low.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainVol = volume.slice(Math.max(0, i - TRAIN_WINDOW), i);
    if (trainClose.length < 50) continue;

    // --- Adaptive Layer 2: Relative Strength Filter ---
    const currentDate = timestamps[i];
    let isLeader = false;
    let spyBearish = false;
    let spySMADeclining = false;

    if (spy200SMAMap.size > 0) {
      spyBearish = spy200SMAMap.get(currentDate) === false; // SPY below its 200 SMA
      spySMADeclining = spySMADecliningMap.get(currentDate) === true;

      // Calculate 50-bar relative strength: stock return vs SPY return
      if (i >= 50) {
        const stockReturn50 = (close[i] - close[i - 50]) / close[i - 50];
        const spyCloseNow = spyDateMap.get(currentDate);
        // Find SPY close ~50 bars ago
        const pastDate = timestamps[i - 50];
        const spyClosePast = spyDateMap.get(pastDate);
        if (spyCloseNow !== undefined && spyClosePast !== undefined && spyClosePast > 0) {
          const spyReturn50 = (spyCloseNow - spyClosePast) / spyClosePast;
          const relativeStrength = stockReturn50 - spyReturn50;
          isLeader = relativeStrength > 0.10; // Outperforming SPY by 10%+
        }
      }
    }

    // Use profile-adjusted params, with user overrides taking priority
    const effectiveADX = userExplicitADX ? config.adxThreshold : activeProfile.adxThreshold;
    const effectiveRSIOS = userExplicitRSIOS ? config.rsiOversold : activeProfile.rsiOversold;
    const effectiveRSIOB = userExplicitRSIOB ? config.rsiOverbought : activeProfile.rsiOverbought;
    const effectiveBuyThresh = userExplicitBuyThresh ? config.buyThreshold : activeProfile.buyThreshold;
    const effectiveShortThresh = userExplicitShortThresh ? Math.abs(config.shortThreshold) : activeProfile.shortThreshold;

    const signal = computeStrategySignal(trainClose, trainHigh, trainLow, trainVol, signalState, STEP, {
      adxThreshold: effectiveADX,
      rsiOversold: effectiveRSIOS,
      rsiOverbought: effectiveRSIOB,
      buyThreshold: effectiveBuyThresh,
      shortThreshold: effectiveShortThresh,
    }, {
      trendConvictionBonus: activeProfile.trendConvictionBonus,
      mrConvictionBonus: activeProfile.mrConvictionBonus,
      breakoutConvictionBonus: activeProfile.breakoutConvictionBonus,
    }, {
      spyBearish,
      spySMADeclining,
      isLeader,
    });

    // Signal already filtered by conviction threshold inside computeStrategySignal
    // Just check if we got a directional signal
    if (signal.consensusScore === 0) continue;

    let action: "BUY" | "SHORT" | "HOLD" = "HOLD";
    if (signal.consensusScore > 0) action = "BUY";
    else if (signal.consensusScore < 0) action = "SHORT";
    if (action === "HOLD") continue;

    // Adaptive short filter: Disable shorts when SPY > 200 SMA, UNLESS stock is a leader
    if (action === "SHORT" && spy200SMAMap.size > 0 && !isLeader) {
      const spyAbove200 = spy200SMAMap.get(currentDate);
      if (spyAbove200 === true) continue; // Skip short in bull market (unless leader)
    }

    // Block duplicate-direction trades on same ticker
    const hasDuplicateDirection = openPositions.some(p => p.action === action);
    if (hasDuplicateDirection) continue;

    const entryIdx = i + executionDelay;
    if (entryIdx >= close.length) continue;
    const rawEntryPrice = open[entryIdx];
    const entryPrice = applyTradingCosts(rawEntryPrice, action === "BUY", tradeConfig);

    // Profile-adjusted hold periods and trade params
    const effectiveMaxHoldTrend = userExplicitMaxHold ? (config.maxHoldBars || 20) : activeProfile.maxHoldTrend;
    const effectiveMaxHoldMR = userExplicitMaxHold ? Math.round((config.maxHoldBars || 20) * 0.5) : activeProfile.maxHoldMR;
    const effectiveMaxHoldBO = userExplicitMaxHold ? Math.round((config.maxHoldBars || 20) * 0.75) : activeProfile.maxHoldBreakout;
    const maxHoldBars = signal.strategy === "trend" ? effectiveMaxHoldTrend
      : signal.strategy === "mean_reversion" ? effectiveMaxHoldMR
      : signal.strategy === "breakout" ? effectiveMaxHoldBO
      : STEP;
    const useTrailingStop = signal.strategy === "trend" || signal.strategy === "breakout";

    const atrPct = entryPrice > 0 ? signal.atr / entryPrice : 0.02;
    const tsATRMult = userExplicitTSMult ? config.trailingStopATRMult : activeProfile.trailingStopATRMult;
    const effectiveTP = userExplicitTP ? config.takeProfitPct : activeProfile.takeProfitPct;
    const isBearRegime = signal.regime === "bearish" || signal.regime === "strong_bearish";

    // Widen trailing distance for SHORTs in bearish regimes (bear rallies are violent)
    const effectiveTrailingMult = (action === "SHORT" && isBearRegime) ? tsATRMult * 1.5 : tsATRMult;
    const trailingStopDist = effectiveTrailingMult * atrPct;
    const breakevenThreshold = atrPct;

    // Fix 5: Use 2 ATR for trend stops (was 3)
    let effectiveStopPct = signal.strategy === "trend"
      ? Math.max(config.stopLossPct / 100, 2 * atrPct)
      : config.stopLossPct / 100;
    // Widen hard stop by 1.5× for SHORTs in bear regimes
    if (action === "SHORT" && isBearRegime) {
      effectiveStopPct *= 1.5;
    }
    // Fix 1: Hard 8% loss cap — no trade ever risks more than 8%
    effectiveStopPct = Math.min(effectiveStopPct, 0.08);

    // Fix 3: Risk-based position sizing
    // Risk riskPerTrade fraction of capital per trade, capped at 25% of capital
    const riskFraction = config.riskPerTrade || 0.01;
    const positionSize = Math.min(
      capital * riskFraction / Math.max(effectiveStopPct, 0.005),
      capital * 0.25
    );
    if (positionSize <= 0) continue;
    const shares = positionSize / entryPrice;
    const commission = positionSize * (tradeConfig.commissionPct / 100) * 2;

    capital -= positionSize; // Subtract deployed capital from cash

    openPositions.push({
      entryIdx, entryPrice, action, strategy: signal.strategy,
      maxHoldBars, useTrailingStop, trailingStopDist, breakevenThreshold,
      effectiveStopPct, takeProfitPct: effectiveTP / 100,
      positionSize, shares, commission,
      regime: signal.regime, confidence: signal.confidence,
      predictedReturn: signal.predictedReturn, signal_atr: signal.atr,
      positionSizeMultiplier: signal.positionSizeMultiplier,
      peakReturn: 0, breakEvenActivated: false, maxAdverse: 0, maxFavorable: 0,
    });

    cooldownPerTicker.set(ticker, i + COOLDOWN_BARS * STEP);
    signalState.cooldownBarsRemaining = COOLDOWN_BARS;
    signalState.consecutiveCount = 0;
  }

  // --- Force-close any remaining positions at end of data ---
  for (const pos of openPositions) {
    const lastIdx = close.length - 1;
    const exitPrice = applyTradingCosts(close[lastIdx], pos.action !== "BUY", tradeConfig);
    let pnl = pos.action === "BUY"
      ? (exitPrice - pos.entryPrice) * pos.shares - pos.commission
      : (pos.entryPrice - exitPrice) * pos.shares - pos.commission;
    const returnPct = (pnl / pos.positionSize) * 100;
    const duration = lastIdx - pos.entryIdx;
    capital += pos.positionSize + pnl; // Return deployed capital + pnl
    barsInTrade += duration;
    trades.push({
      date: timestamps[pos.entryIdx], exitDate: timestamps[lastIdx], ticker,
      action: pos.action, entryPrice: pos.entryPrice, exitPrice, returnPct, pnl,
      regime: pos.regime, confidence: pos.confidence,
      predictedReturn: pos.predictedReturn,
      actualReturn: (close[lastIdx] - close[pos.entryIdx]) / close[pos.entryIdx] * 100,
      duration,
      mae: parseFloat((pos.maxAdverse * 100).toFixed(2)),
      mfe: parseFloat((pos.maxFavorable * 100).toFixed(2)),
      volumeAtEntry: volume[pos.entryIdx] || 0,
      strategy: pos.strategy, exitReason: "time_exit",
    });
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

  // Alpha / Beta
  let alpha = 0, beta = 0;
  if (benchmarkReturns.length > 1 && returns.length > 1) {
    const n = Math.min(returns.length, benchmarkReturns.length);
    const stratRets = returns.slice(0, n).map(r => r / 100);
    const benchRets = benchmarkReturns.slice(0, n);
    const meanS = stratRets.reduce((a, b) => a + b, 0) / n;
    const meanB = benchRets.reduce((a, b) => a + b, 0) / n;
    let covSB = 0, varB = 0;
    for (let i = 0; i < n; i++) {
      covSB += (stratRets[i] - meanS) * (benchRets[i] - meanB);
      varB += (benchRets[i] - meanB) ** 2;
    }
    beta = varB > 0 ? covSB / varB : 0;
    alpha = (meanS - beta * meanB) * 252;
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

  // Confidence Calibration
  const confBuckets = [
    { bucket: "35-45%", min: 35, max: 45 },
    { bucket: "45-55%", min: 45, max: 55 },
    { bucket: "55-65%", min: 55, max: 65 },
    { bucket: "65-75%", min: 65, max: 75 },
    { bucket: "75-85%", min: 75, max: 85 },
    { bucket: "85-92%", min: 85, max: 92 },
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
      buyThreshold = 60,
      shortThreshold = -60,
      adxThreshold = 25,
      rsiOversold = 30,
      rsiOverbought = 70,
      trailingStopATRMult = 2.0,
      maxHoldBars = 20,
      riskPerTrade = 0.01,
    } = body;

    console.log(`Backtest request: ${tickers.join(",")} from ${startYear} to ${endYear}, buyThresh=${buyThreshold}, adx=${adxThreshold}, rsiOS=${rsiOversold}, rsiOB=${rsiOverbought}`);

    const config: BacktestConfig = {
      tickers: tickers.slice(0, 5),
      startYear, endYear, initialCapital, positionSizePct,
      stopLossPct, takeProfitPct, maxPositions,
      rebalanceFrequency, includeMonteCarlo,
      buyThreshold, shortThreshold,
      adxThreshold, rsiOversold, rsiOverbought,
      trailingStopATRMult, maxHoldBars,
      riskPerTrade,
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
    const numTickers = Math.max(validTickerIndices.length, 1);
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
    const metrics = computeMetrics(allTrades, initialCapital, combinedEquity, years, totalBarsAll, barsInTradeAll, benchmarkReturns, positionSizePct);
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

    console.log(`Backtest complete: ${allTrades.length} trades, Win Rate: ${metrics.winRate}%, Sharpe: ${metrics.sharpeRatio}, elapsed: ${Date.now() - startTime}ms`);

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
