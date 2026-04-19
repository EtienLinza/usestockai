// ============================================================================
// CANONICAL TECHNICAL INDICATORS — single source of truth
// Imported by: backtest, stock-predict, market-scanner
// All formulas use the textbook (Wilder's where applicable) implementation.
// ============================================================================

export function calculateEMA(prices: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  if (prices.length === 0) return ema;
  if (prices.length < period) {
    ema[0] = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
    }
    return ema;
  }
  const smaSum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  for (let i = 0; i < period - 1; i++) ema[i] = NaN;
  ema[period - 1] = smaSum / period;
  for (let i = period; i < prices.length; i++) {
    ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  return ema;
}

export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma[i] = NaN;
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma[i] = sum / period;
    }
  }
  return sma;
}

// Wilder's RSI (smoothing constant = 1/period rather than 2/(period+1))
export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  if (prices.length <= period) {
    for (let i = 0; i < prices.length; i++) rsi[i] = NaN;
    return rsi;
  }
  for (let i = 0; i <= period; i++) rsi[i] = NaN;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }
  avgGain /= period;
  avgLoss /= period;
  rsi[period] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.0001))));

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.0001))));
  }
  return rsi;
}

// MACD with proper signal-line alignment.
// The signal EMA must be computed only on the valid (non-NaN) MACD values,
// then padded back to original length. Otherwise the signal seeds on NaN
// and emits incorrect values for the first ~26+9 bars.
export function calculateMACD(prices: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
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

export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDev: number = 2,
): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[] } {
  const sma = calculateSMA(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper[i] = NaN;
      lower[i] = NaN;
      bandwidth[i] = NaN;
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = sma[i];
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const std = Math.sqrt(variance) * stdDev;
      upper[i] = mean + std;
      lower[i] = mean - std;
      bandwidth[i] = mean !== 0 ? (upper[i] - lower[i]) / mean : NaN;
    }
  }
  return { upper, middle: sma, lower, bandwidth };
}

// Wilder's smoothing helper (different from EMA: uses 1/period weight).
// Initial value = SMA of first `period` values. Subsequent: (prev*(p-1) + curr)/p.
function wildersSmooth(values: number[], period: number): number[] {
  const out: number[] = [];
  if (values.length < period) {
    for (let i = 0; i < values.length; i++) out[i] = NaN;
    return out;
  }
  for (let i = 0; i < period - 1; i++) out[i] = NaN;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + values[i]) / period;
  }
  return out;
}

export function calculateVolatility(prices: number[], period: number = 20): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    else returns.push(0);
  }
  const volatility: number[] = [NaN];
  for (let i = 1; i < prices.length; i++) {
    if (i < period) {
      volatility[i] = NaN;
    } else {
      const slice = returns.slice(i - period, i);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      volatility[i] = Math.sqrt(variance);
    }
  }
  return volatility;
}

// True ADX using Wilder's smoothing (textbook formula).
// Previous implementations used EMA which produces values ~15-20% too low.
export function calculateADX(
  high: number[],
  low: number[],
  close: number[],
  period: number = 14,
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const n = close.length;
  if (n < 2) return { adx: [], plusDI: [], minusDI: [] };

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < n; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
    ));
  }

  // Wilder smoothing (NOT EMA)
  const smoothedTR = wildersSmooth(tr, period);
  const smoothedPlusDM = wildersSmooth(plusDM, period);
  const smoothedMinusDM = wildersSmooth(minusDM, period);

  const plusDI: number[] = smoothedPlusDM.map((v, i) =>
    isNaN(v) || isNaN(smoothedTR[i]) || smoothedTR[i] === 0 ? NaN : (v / smoothedTR[i]) * 100
  );
  const minusDI: number[] = smoothedMinusDM.map((v, i) =>
    isNaN(v) || isNaN(smoothedTR[i]) || smoothedTR[i] === 0 ? NaN : (v / smoothedTR[i]) * 100
  );

  const dx: number[] = plusDI.map((v, i) => {
    if (isNaN(v) || isNaN(minusDI[i])) return NaN;
    const sum = v + minusDI[i];
    return sum === 0 ? 0 : (Math.abs(v - minusDI[i]) / sum) * 100;
  });

  // ADX = Wilder's smoothing of DX, but only over the valid (non-NaN) tail
  const validDX: number[] = [];
  const validIdx: number[] = [];
  for (let i = 0; i < dx.length; i++) {
    if (!isNaN(dx[i])) {
      validDX.push(dx[i]);
      validIdx.push(i);
    }
  }
  const adxValid = wildersSmooth(validDX, period);
  const adxOnDxScale: number[] = new Array(dx.length).fill(NaN);
  for (let i = 0; i < adxValid.length; i++) {
    adxOnDxScale[validIdx[i]] = adxValid[i];
  }

  // Pad each array up to close.length (each is shorter by exactly 1 due to the i=1 start)
  const padToN = (arr: number[]): number[] => {
    const out = new Array(n - arr.length).fill(NaN).concat(arr);
    return out;
  };

  return {
    adx: padToN(adxOnDxScale),
    plusDI: padToN(plusDI),
    minusDI: padToN(minusDI),
  };
}

export function calculateStochastic(
  close: number[],
  high: number[],
  low: number[],
  kPeriod: number = 14,
  dPeriod: number = 3,
): { k: number[]; d: number[] } {
  const k: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i < kPeriod - 1) {
      k.push(NaN);
      continue;
    }
    const hSlice = high.slice(i - kPeriod + 1, i + 1);
    const lSlice = low.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...hSlice);
    const ll = Math.min(...lSlice);
    const range = hh - ll;
    k.push(range === 0 ? 50 : ((close[i] - ll) / range) * 100);
  }

  const d: number[] = [];
  for (let i = 0; i < k.length; i++) {
    if (i < kPeriod - 1 + dPeriod - 1 || isNaN(k[i])) {
      d.push(NaN);
    } else {
      const kSlice = k.slice(i - dPeriod + 1, i + 1).filter(v => !isNaN(v));
      d.push(kSlice.length >= dPeriod ? kSlice.reduce((a, b) => a + b, 0) / dPeriod : NaN);
    }
  }
  return { k, d };
}

// ATR uses Wilder's smoothing on True Range (textbook).
export function calculateATR(
  high: number[],
  low: number[],
  close: number[],
  period: number = 14,
): number[] {
  const n = close.length;
  if (n === 0) return [];
  const tr: number[] = [high[0] - low[0]];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
    ));
  }
  const atr: number[] = new Array(n).fill(NaN);
  if (tr.length >= period) {
    let seed = 0;
    for (let i = 0; i < period; i++) seed += tr[i];
    atr[period - 1] = seed / period;
    for (let i = period; i < n; i++) {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }
  return atr;
}

export function calculateOBV(close: number[], volume: number[]): number[] {
  const obv: number[] = [volume[0] || 0];
  for (let i = 1; i < close.length; i++) {
    const vol = volume[i] || 0;
    if (close[i] > close[i - 1]) obv.push(obv[i - 1] + vol);
    else if (close[i] < close[i - 1]) obv.push(obv[i - 1] - vol);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

export function safeGet(arr: number[], defaultVal: number): number {
  if (!arr || arr.length === 0) return defaultVal;
  const v = arr[arr.length - 1];
  return (v == null || isNaN(v)) ? defaultVal : v;
}
