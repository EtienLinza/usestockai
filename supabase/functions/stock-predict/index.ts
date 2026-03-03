import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// In-memory rate limiting store (per instance)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per user

function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);

  if (!userLimit || now > userLimit.resetTime) {
    rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }

  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetIn: userLimit.resetTime - now 
    };
  }

  userLimit.count++;
  return { 
    allowed: true, 
    remaining: RATE_LIMIT_MAX_REQUESTS - userLimit.count, 
    resetIn: userLimit.resetTime - now 
  };
}

// Helper function to verify authentication
async function verifyAuth(req: Request): Promise<{ user: any; error: Response | null }> {
  const authHeader = req.headers.get("Authorization");
  
  if (!authHeader) {
    return {
      user: null,
      error: new Response(
        JSON.stringify({ error: "Unauthorized - Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing Supabase configuration");
    return {
      user: null,
      error: new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    console.error("Auth error:", error?.message);
    return {
      user: null,
      error: new Response(
        JSON.stringify({ error: "Unauthorized - Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  return { user, error: null };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Safe array access helper to prevent undefined/NaN errors
function safeGetLast<T>(arr: T[] | undefined | null, defaultValue: T): T {
  if (!arr || arr.length === 0) return defaultValue;
  const last = arr[arr.length - 1];
  if (last === undefined || last === null) return defaultValue;
  if (typeof last === 'number' && isNaN(last)) return defaultValue;
  return last;
}

function safeGetAt<T>(arr: T[] | undefined | null, index: number, defaultValue: T): T {
  if (!arr || index < 0 || index >= arr.length) return defaultValue;
  const val = arr[index];
  if (val === undefined || val === null) return defaultValue;
  if (typeof val === 'number' && isNaN(val)) return defaultValue;
  return val;
}

// ============================================================================
// SHOCK / EVENT DETECTION
// ============================================================================

interface ShockState {
  isShock: boolean;
  shockMagnitude: number; // percentage move that triggered it
  shockType: 'gap_up' | 'gap_down' | 'multi_day_surge' | 'multi_day_crash' | 'none';
  description: string;
}

function detectPriceShock(closePrices: number[], volumes?: number[]): ShockState {
  if (closePrices.length < 6) {
    return { isShock: false, shockMagnitude: 0, shockType: 'none', description: 'Insufficient data' };
  }

  const latest = closePrices[closePrices.length - 1];
  const prev = closePrices[closePrices.length - 2];
  const fiveDaysAgo = closePrices[closePrices.length - 6];

  // Single-day shock: >=25% move
  const dailyChange = (latest - prev) / prev;
  if (Math.abs(dailyChange) >= 0.25) {
    return {
      isShock: true,
      shockMagnitude: Math.abs(dailyChange) * 100,
      shockType: dailyChange > 0 ? 'gap_up' : 'gap_down',
      description: `${dailyChange > 0 ? 'Massive gap up' : 'Massive gap down'}: ${(dailyChange * 100).toFixed(1)}% in one day`,
    };
  }

  // Multi-day shock: >=40% in 5 days
  const fiveDayChange = (latest - fiveDaysAgo) / fiveDaysAgo;
  if (Math.abs(fiveDayChange) >= 0.40) {
    return {
      isShock: true,
      shockMagnitude: Math.abs(fiveDayChange) * 100,
      shockType: fiveDayChange > 0 ? 'multi_day_surge' : 'multi_day_crash',
      description: `${fiveDayChange > 0 ? 'Extreme surge' : 'Extreme crash'}: ${(fiveDayChange * 100).toFixed(1)}% over 5 days`,
    };
  }

  // Volume spike check (if available): 5x average volume + 15% move = shock
  if (volumes && volumes.length >= 21) {
    const avgVolume = volumes.slice(-21, -1).reduce((a, b) => a + (b || 0), 0) / 20;
    const latestVolume = volumes[volumes.length - 1] || 0;
    if (latestVolume > avgVolume * 5 && Math.abs(dailyChange) >= 0.15) {
      return {
        isShock: true,
        shockMagnitude: Math.abs(dailyChange) * 100,
        shockType: dailyChange > 0 ? 'gap_up' : 'gap_down',
        description: `Volume spike (${(latestVolume / avgVolume).toFixed(0)}x avg) with ${(dailyChange * 100).toFixed(1)}% move`,
      };
    }
  }

  return { isShock: false, shockMagnitude: 0, shockType: 'none', description: 'Normal conditions' };
}

// ============================================================================
// ENHANCED TECHNICAL INDICATORS
// ============================================================================

function calculateEMA(prices: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  
  if (prices.length < period) {
    // Not enough data - fallback to simple seed
    ema[0] = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
    }
    return ema;
  }
  
  // Seed with SMA of first `period` values
  const smaSum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  const smaSeed = smaSum / period;
  
  // Fill first period-1 with NaN, then seed at index period-1
  for (let i = 0; i < period - 1; i++) {
    ema[i] = NaN;
  }
  ema[period - 1] = smaSeed;
  
  for (let i = period; i < prices.length; i++) {
    ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  return ema;
}

function calculateSMA(prices: number[], period: number): number[] {
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

// Enhanced RSI using Wilder's Smoothing (more accurate)
function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // First, fill with NaN until we have enough data
  for (let i = 0; i <= period; i++) {
    rsi[i] = NaN;
  }

  // Calculate initial average gain/loss using SMA
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }
  avgGain /= period;
  avgLoss /= period;

  rsi[period] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.0001))));

  // Use Wilder's smoothing for subsequent values
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

function calculateMACD(prices: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12.map((v, i) => v - ema26[i]);
  const signal = calculateEMA(macd, 9);
  const histogram = macd.map((v, i) => v - signal[i]);
  return { macd, signal, histogram };
}

function calculateVolatility(prices: number[], period: number = 20): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
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

// Bollinger Bands
function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[] } {
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
      bandwidth[i] = (upper[i] - lower[i]) / mean;
    }
  }

  return { upper, middle: sma, lower, bandwidth };
}

// Average True Range (ATR)
function calculateATR(high: number[], low: number[], close: number[], period: number = 14): number[] {
  const tr: number[] = [high[0] - low[0]];

  for (let i = 1; i < close.length; i++) {
    tr.push(Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    ));
  }

  return calculateEMA(tr, period);
}

// Stochastic Oscillator - Fixed array alignment
function calculateStochastic(close: number[], high: number[], low: number[], kPeriod: number = 14, dPeriod: number = 3): { k: number[]; d: number[] } {
  const k: number[] = [];

  for (let i = 0; i < close.length; i++) {
    if (i < kPeriod - 1) {
      k.push(NaN);
      continue;
    }
    const highSlice = high.slice(i - kPeriod + 1, i + 1);
    const lowSlice = low.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);
    const range = highestHigh - lowestLow;
    k.push(range === 0 ? 50 : ((close[i] - lowestLow) / range) * 100);
  }

  // Calculate %D as SMA of %K, maintaining proper alignment
  // d array should be same length as k array
  const d: number[] = [];
  for (let i = 0; i < k.length; i++) {
    if (i < kPeriod - 1 + dPeriod - 1 || isNaN(k[i])) {
      d.push(NaN);
    } else {
      // Get the last dPeriod values of k that are valid
      const kSlice = k.slice(i - dPeriod + 1, i + 1).filter(v => !isNaN(v));
      if (kSlice.length >= dPeriod) {
        d.push(kSlice.reduce((a, b) => a + b, 0) / dPeriod);
      } else {
        d.push(NaN);
      }
    }
  }

  return { k, d };
}

// Average Directional Index (ADX) - Fixed array padding
function calculateADX(high: number[], low: number[], close: number[], period: number = 14): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  if (close.length < 2) {
    return { adx: [], plusDI: [], minusDI: [] };
  }
  
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < close.length; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    ));
  }

  const smoothedTR = calculateEMA(tr, period);
  const smoothedPlusDM = calculateEMA(plusDM, period);
  const smoothedMinusDM = calculateEMA(minusDM, period);

  const plusDI = smoothedPlusDM.map((v, i) => smoothedTR[i] === 0 ? 0 : (v / smoothedTR[i]) * 100);
  const minusDI = smoothedMinusDM.map((v, i) => smoothedTR[i] === 0 ? 0 : (v / smoothedTR[i]) * 100);

  const dx = plusDI.map((v, i) => {
    const sum = v + minusDI[i];
    return sum === 0 ? 0 : (Math.abs(v - minusDI[i]) / sum) * 100;
  });

  const validDX = dx.filter(v => !isNaN(v));
  const adxRaw = validDX.length >= period ? calculateEMA(validDX, period) : validDX;

  // Properly pad all arrays to match close.length
  // plusDI and minusDI are derived from arrays starting at index 1, so they need 1 NaN at start
  // then they go through EMA which maintains length, so final length is (close.length - 1)
  const paddedPlusDI = new Array(1).fill(NaN).concat(plusDI);
  const paddedMinusDI = new Array(1).fill(NaN).concat(minusDI);
  
  // Ensure plusDI and minusDI match close.length
  while (paddedPlusDI.length < close.length) paddedPlusDI.unshift(NaN);
  while (paddedMinusDI.length < close.length) paddedMinusDI.unshift(NaN);
  
  // ADX needs more padding since it goes through additional smoothing
  const adxPadLength = close.length - adxRaw.length;
  const paddedADX = new Array(Math.max(0, adxPadLength)).fill(NaN).concat(adxRaw);

  return { adx: paddedADX, plusDI: paddedPlusDI, minusDI: paddedMinusDI };
}

// On Balance Volume (OBV)
function calculateOBV(close: number[], volume: number[]): number[] {
  const obv: number[] = [volume[0] || 0];

  for (let i = 1; i < close.length; i++) {
    const vol = volume[i] || 0;
    if (close[i] > close[i - 1]) {
      obv.push(obv[i - 1] + vol);
    } else if (close[i] < close[i - 1]) {
      obv.push(obv[i - 1] - vol);
    } else {
      obv.push(obv[i - 1]);
    }
  }
  return obv;
}

// OBV Trend (rising, falling, neutral)
function getOBVTrend(obv: number[], period: number = 20): string {
  const recent = obv.slice(-period);
  const older = obv.slice(-period * 2, -period);
  
  if (recent.length < period || older.length < period) return "neutral";
  
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  
  const change = (recentAvg - olderAvg) / Math.abs(olderAvg || 1);
  
  if (change > 0.1) return "rising";
  if (change < -0.1) return "falling";
  return "neutral";
}

// Support & Resistance Detection
function findSupportResistance(prices: number[], lookback: number = 60): { support: number[]; resistance: number[] } {
  const support: number[] = [];
  const resistance: number[] = [];
  const recent = prices.slice(-lookback);

  // Find local minima (support) and maxima (resistance)
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i] < recent[i - 1] && recent[i] < recent[i - 2] &&
        recent[i] < recent[i + 1] && recent[i] < recent[i + 2]) {
      support.push(recent[i]);
    }
    if (recent[i] > recent[i - 1] && recent[i] > recent[i - 2] &&
        recent[i] > recent[i + 1] && recent[i] > recent[i + 2]) {
      resistance.push(recent[i]);
    }
  }

  // Cluster nearby levels
  const clusterLevels = (levels: number[], threshold: number = 0.02): number[] => {
    const clustered: number[] = [];
    const sorted = [...levels].sort((a, b) => a - b);
    for (const level of sorted) {
      if (!clustered.some(c => Math.abs(c - level) / level < threshold)) {
        clustered.push(level);
      }
    }
    return clustered;
  };

  return {
    support: clusterLevels(support).slice(-3),
    resistance: clusterLevels(resistance).slice(-3),
  };
}

// Fibonacci Retracement Levels
function calculateFibonacciLevels(prices: number[], lookback: number = 60): { levels: { ratio: number; price: number }[]; trend: string } {
  const recent = prices.slice(-lookback);
  const high = Math.max(...recent);
  const low = Math.min(...recent);
  const diff = high - low;

  // Determine trend direction
  const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const trend = avgSecond > avgFirst ? "uptrend" : "downtrend";

  const fibRatios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const levels = fibRatios.map(ratio => ({
    ratio,
    price: trend === "uptrend" ? high - diff * ratio : low + diff * ratio,
  }));

  return { levels, trend };
}

// ============================================================================
// NEW: VWAP (Volume-Weighted Average Price)
// ============================================================================
function calculateVWAP(high: number[], low: number[], close: number[], volume: number[], window: number = 20): number[] {
  const vwap: number[] = [];

  for (let i = 0; i < close.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sumTPV = 0;
    let sumVol = 0;
    for (let j = start; j <= i; j++) {
      const tp = (high[j] + low[j] + close[j]) / 3;
      const vol = volume[j] || 0;
      sumTPV += tp * vol;
      sumVol += vol;
    }
    vwap.push(sumVol === 0 ? (high[i] + low[i] + close[i]) / 3 : sumTPV / sumVol);
  }

  return vwap;
}

// ============================================================================
// NEW: Pivot Points (Classic Floor Trader Method)
// ============================================================================
function calculatePivotPoints(prevHigh: number, prevLow: number, prevClose: number): {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
} {
  const pivot = (prevHigh + prevLow + prevClose) / 3;
  return {
    pivot,
    r1: 2 * pivot - prevLow,
    r2: pivot + (prevHigh - prevLow),
    r3: prevHigh + 2 * (pivot - prevLow),
    s1: 2 * pivot - prevHigh,
    s2: pivot - (prevHigh - prevLow),
    s3: prevLow - 2 * (prevHigh - pivot),
  };
}

// ============================================================================
// NEW: SIGNAL CONSENSUS SYSTEM - With Safe Array Access
// ============================================================================
function calculateSignalConsensus(
  indicators: any,
  currentPrice: number,
  shockState?: ShockState
): {
  bullishSignals: number;
  bearishSignals: number;
  consensusScore: number;
  alignment: string;
  signalDetails: string[];
} {
  const isShock = shockState?.isShock || false;
  let bullish = 0;
  let bearish = 0;
  const signalDetails: string[] = [];

  // During event_volatility, add a shock notice
  if (isShock) {
    signalDetails.push(`⚠️ SHOCK DETECTED: ${shockState!.description}`);
  }

  try {
    // RSI Signal (weight: 1.5) — SUPPRESSED during shocks (mean-reversion is invalid)
    const rsi = safeGetLast(indicators.rsi, 50);
    if (isShock) {
      // During shocks, RSI extremes are noise, not signals
      signalDetails.push(`RSI at ${rsi.toFixed(1)} (suppressed: shock event)`);
    } else if (rsi < 30) {
      bullish += 1.5;
      signalDetails.push(`RSI oversold (${rsi.toFixed(1)})`);
    } else if (rsi > 70) {
      bearish += 1.5;
      signalDetails.push(`RSI overbought (${rsi.toFixed(1)})`);
    } else if (rsi > 50) {
      bullish += 0.5;
      signalDetails.push(`RSI bullish (${rsi.toFixed(1)})`);
    } else {
      bearish += 0.5;
      signalDetails.push(`RSI bearish (${rsi.toFixed(1)})`);
    }
  } catch (e) {
    console.warn("RSI signal calculation failed:", e);
  }

  try {
    // MACD Signal (weight: 1.5)
    const macdHist = safeGetLast(indicators.macd?.histogram, 0);
    const prevHist = safeGetAt(indicators.macd?.histogram, (indicators.macd?.histogram?.length || 1) - 2, 0);
    if (macdHist > 0 && macdHist > prevHist) {
      bullish += 1.5;
      signalDetails.push("MACD rising positive");
    } else if (macdHist < 0 && macdHist < prevHist) {
      bearish += 1.5;
      signalDetails.push("MACD falling negative");
    } else if (macdHist > 0) {
      bullish += 0.5;
      signalDetails.push("MACD positive");
    } else {
      bearish += 0.5;
      signalDetails.push("MACD negative");
    }
  } catch (e) {
    console.warn("MACD signal calculation failed:", e);
  }

  try {
    // EMA Crossover (weight: 1)
    const ema12 = safeGetLast(indicators.ema12, currentPrice);
    const ema26 = safeGetLast(indicators.ema26, currentPrice);
    if (ema12 > ema26) {
      bullish += 1;
      signalDetails.push("EMA12 > EMA26");
    } else {
      bearish += 1;
      signalDetails.push("EMA12 < EMA26");
    }
  } catch (e) {
    console.warn("EMA signal calculation failed:", e);
  }

  try {
    // Price vs SMA50 (weight: 1)
    const sma50 = safeGetLast(indicators.sma50, currentPrice);
    if (currentPrice > sma50) {
      bullish += 1;
      signalDetails.push("Price above SMA50");
    } else {
      bearish += 1;
      signalDetails.push("Price below SMA50");
    }
  } catch (e) {
    console.warn("SMA50 signal calculation failed:", e);
  }

  try {
    // ADX + DI Direction (weight: 2 if strong trend)
    const adx = safeGetLast(indicators.adx?.adx, 0);
    const plusDI = safeGetLast(indicators.adx?.plusDI, 0);
    const minusDI = safeGetLast(indicators.adx?.minusDI, 0);
    if (adx > 25) {
      if (plusDI > minusDI) {
        bullish += 2;
        signalDetails.push(`Strong bullish trend (ADX: ${adx.toFixed(1)})`);
      } else {
        bearish += 2;
        signalDetails.push(`Strong bearish trend (ADX: ${adx.toFixed(1)})`);
      }
    }
  } catch (e) {
    console.warn("ADX signal calculation failed:", e);
  }

  try {
    // Stochastic (weight: 1.5) — SUPPRESSED during shocks
    const stochK = safeGetLast(indicators.stochastic?.k, 50);
    if (isShock) {
      signalDetails.push(`Stochastic at ${stochK.toFixed(1)} (suppressed: shock event)`);
    } else if (stochK < 20) {
      bullish += 1.5;
      signalDetails.push(`Stochastic oversold (${stochK.toFixed(1)})`);
    } else if (stochK > 80) {
      bearish += 1.5;
      signalDetails.push(`Stochastic overbought (${stochK.toFixed(1)})`);
    }
  } catch (e) {
    console.warn("Stochastic signal calculation failed:", e);
  }

  try {
    // Bollinger Bands Position (weight: 1.5) — SUPPRESSED during shocks
    const bbUpper = safeGetLast(indicators.bollingerBands?.upper, currentPrice * 1.1);
    const bbLower = safeGetLast(indicators.bollingerBands?.lower, currentPrice * 0.9);
    const bbMid = safeGetLast(indicators.bollingerBands?.middle, currentPrice);
    if (isShock) {
      signalDetails.push(`BB position suppressed (shock event)`);
    } else if (currentPrice < bbLower) {
      bullish += 1.5;
      signalDetails.push("Below lower Bollinger Band");
    } else if (currentPrice > bbUpper) {
      bearish += 1.5;
      signalDetails.push("Above upper Bollinger Band");
    } else if (currentPrice > bbMid) {
      bullish += 0.5;
      signalDetails.push("Above BB midline");
    } else {
      bearish += 0.5;
      signalDetails.push("Below BB midline");
    }
  } catch (e) {
    console.warn("Bollinger Bands signal calculation failed:", e);
  }

  try {
    // OBV Trend (weight: 1)
    if (indicators.obvTrend === "rising") {
      bullish += 1;
      signalDetails.push("OBV rising (volume confirms)");
    } else if (indicators.obvTrend === "falling") {
      bearish += 1;
      signalDetails.push("OBV falling (volume confirms)");
    }
  } catch (e) {
    console.warn("OBV signal calculation failed:", e);
  }

  try {
    // VWAP Position (weight: 1)
    const latestVWAP = safeGetLast(indicators.vwap, 0);
    if (latestVWAP > 0) {
      if (currentPrice > latestVWAP) {
        bullish += 1;
        signalDetails.push("Price above VWAP");
      } else {
        bearish += 1;
        signalDetails.push("Price below VWAP");
      }
    }
  } catch (e) {
    console.warn("VWAP signal calculation failed:", e);
  }

  // Calculate consensus with conviction weighting
  const total = bullish + bearish;
  const maxPossibleTotal = 13.5; // Sum of all possible signal weights
  const direction_score = total === 0 ? 0 : ((bullish - bearish) / total) * 100;
  const conviction = Math.min(1, total / (maxPossibleTotal * 0.6));
  const consensusScore = direction_score * conviction;

  let alignment = "neutral";
  if (consensusScore > 60) alignment = "strong_bullish";
  else if (consensusScore > 25) alignment = "bullish";
  else if (consensusScore < -60) alignment = "strong_bearish";
  else if (consensusScore < -25) alignment = "bearish";

  return { 
    bullishSignals: bullish, 
    bearishSignals: bearish, 
    consensusScore, 
    alignment,
    signalDetails
  };
}

// ============================================================================
// NEW: RSI DIVERGENCE DETECTION
// ============================================================================
function detectRSIDivergence(prices: number[], rsi: number[], lookback: number = 30): {
  hasDivergence: boolean;
  type: "bullish" | "bearish" | "none";
  strength: number;
  description: string;
} {
  const recentPrices = prices.slice(-lookback);
  const recentRSI = rsi.slice(-lookback); // Keep NaN values to preserve index alignment

  const validRSICount = recentRSI.filter(v => !isNaN(v)).length;
  if (validRSICount < 10) {
    return { hasDivergence: false, type: "none", strength: 0, description: "Insufficient data" };
  }

  // Find price lows and highs
  const priceLows: { index: number; value: number }[] = [];
  const priceHighs: { index: number; value: number }[] = [];

  for (let i = 2; i < recentPrices.length - 2; i++) {
    if (recentPrices[i] < recentPrices[i - 1] && recentPrices[i] < recentPrices[i - 2] &&
        recentPrices[i] < recentPrices[i + 1] && recentPrices[i] < recentPrices[i + 2]) {
      priceLows.push({ index: i, value: recentPrices[i] });
    }
    if (recentPrices[i] > recentPrices[i - 1] && recentPrices[i] > recentPrices[i - 2] &&
        recentPrices[i] > recentPrices[i + 1] && recentPrices[i] > recentPrices[i + 2]) {
      priceHighs.push({ index: i, value: recentPrices[i] });
    }
  }

  // RSI indices are now aligned with price indices (same length, same positions)

  // Check for bullish divergence (lower price lows, higher RSI lows)
  if (priceLows.length >= 2) {
    const [prev, curr] = priceLows.slice(-2);
    
    if (prev.index >= 0 && curr.index >= 0 && prev.index < recentRSI.length && curr.index < recentRSI.length &&
        !isNaN(recentRSI[prev.index]) && !isNaN(recentRSI[curr.index])) {
      const prevRSI = recentRSI[prev.index];
      const currRSI = recentRSI[curr.index];

      if (curr.value < prev.value && currRSI > prevRSI) {
        const strength = Math.min(1, (currRSI - prevRSI) / 20);
        return {
          hasDivergence: true,
          type: "bullish",
          strength,
          description: `Bullish divergence: Price made lower low but RSI made higher low (strength: ${(strength * 100).toFixed(0)}%)`
        };
      }
    }
  }

  // Check for bearish divergence (higher price highs, lower RSI highs)
  if (priceHighs.length >= 2) {
    const [prev, curr] = priceHighs.slice(-2);
    
    if (prev.index >= 0 && curr.index >= 0 && prev.index < recentRSI.length && curr.index < recentRSI.length &&
        !isNaN(recentRSI[prev.index]) && !isNaN(recentRSI[curr.index])) {
      const prevRSI = recentRSI[prev.index];
      const currRSI = recentRSI[curr.index];

      if (curr.value > prev.value && currRSI < prevRSI) {
        const strength = Math.min(1, (prevRSI - currRSI) / 20);
        return {
          hasDivergence: true,
          type: "bearish",
          strength,
          description: `Bearish divergence: Price made higher high but RSI made lower high (strength: ${(strength * 100).toFixed(0)}%)`
        };
      }
    }
  }

  return { hasDivergence: false, type: "none", strength: 0, description: "No divergence detected" };
}

// ============================================================================
// NEW: MACD DIVERGENCE DETECTION
// ============================================================================
function detectMACDDivergence(prices: number[], macdHist: number[], lookback: number = 30): {
  hasDivergence: boolean;
  type: "bullish" | "bearish" | "none";
  strength: number;
  description: string;
} {
  const recentPrices = prices.slice(-lookback);
  const recentMACD = macdHist.slice(-lookback); // Keep NaN to preserve index alignment

  const validMACDCount = recentMACD.filter(v => !isNaN(v)).length;
  if (validMACDCount < 10) {
    return { hasDivergence: false, type: "none", strength: 0, description: "Insufficient data" };
  }

  // Find price and MACD lows/highs
  const priceLows: { index: number; value: number }[] = [];
  const priceHighs: { index: number; value: number }[] = [];

  for (let i = 2; i < recentPrices.length - 2; i++) {
    if (recentPrices[i] < recentPrices[i - 1] && recentPrices[i] < recentPrices[i - 2] &&
        recentPrices[i] < recentPrices[i + 1] && recentPrices[i] < recentPrices[i + 2]) {
      priceLows.push({ index: i, value: recentPrices[i] });
    }
    if (recentPrices[i] > recentPrices[i - 1] && recentPrices[i] > recentPrices[i - 2] &&
        recentPrices[i] > recentPrices[i + 1] && recentPrices[i] > recentPrices[i + 2]) {
      priceHighs.push({ index: i, value: recentPrices[i] });
    }
  }

  // MACD indices are now aligned with price indices

  // Check for bullish divergence
  if (priceLows.length >= 2) {
    const [prev, curr] = priceLows.slice(-2);
    
    if (prev.index >= 0 && curr.index >= 0 && prev.index < recentMACD.length && curr.index < recentMACD.length &&
        !isNaN(recentMACD[prev.index]) && !isNaN(recentMACD[curr.index])) {
      const prevMACD = recentMACD[prev.index];
      const currMACD = recentMACD[curr.index];

      if (curr.value < prev.value && currMACD > prevMACD) {
        const strength = Math.min(1, Math.abs(currMACD - prevMACD) / Math.abs(prevMACD || 0.01));
        return {
          hasDivergence: true,
          type: "bullish",
          strength: Math.min(1, strength),
          description: `Bullish MACD divergence detected`
        };
      }
    }
  }

  // Check for bearish divergence
  if (priceHighs.length >= 2) {
    const [prev, curr] = priceHighs.slice(-2);
    
    if (prev.index >= 0 && curr.index >= 0 && prev.index < recentMACD.length && curr.index < recentMACD.length &&
        !isNaN(recentMACD[prev.index]) && !isNaN(recentMACD[curr.index])) {
      const prevMACD = recentMACD[prev.index];
      const currMACD = recentMACD[curr.index];

      if (curr.value > prev.value && currMACD < prevMACD) {
        const strength = Math.min(1, Math.abs(prevMACD - currMACD) / Math.abs(prevMACD || 0.01));
        return {
          hasDivergence: true,
          type: "bearish",
          strength: Math.min(1, strength),
          description: `Bearish MACD divergence detected`
        };
      }
    }
  }

  return { hasDivergence: false, type: "none", strength: 0, description: "No divergence detected" };
}

// ============================================================================
// NEW: MATHEMATICAL CONFIDENCE CALCULATION - Rebalanced for realistic scores
// ============================================================================
function calculateMathematicalConfidence(
  consensus: { consensusScore: number; alignment: string },
  rsiDivergence: { hasDivergence: boolean; type: string; strength: number },
  macdDivergence: { hasDivergence: boolean; type: string; strength: number },
  regime: { regime: string; strength: number },
  sentiment: { score: number; confidence: number },
  daysToTarget: number,
  weeklyAlignment: boolean
): number {
  // REBALANCED: Raised base from 50 to 55
  let confidence = 55;

  // Signal alignment (+0 to +25 points based on consensus score magnitude)
  confidence += Math.abs(consensus.consensusScore) * 0.25;

  // Strong trend regime bonus (+8, reduced from +10)
  if (regime.regime.includes("strong")) {
    confidence += 8;
  }

  // RSI Divergence confirmation (+/- points, slightly reduced penalties)
  if (rsiDivergence.hasDivergence) {
    const consensusBullish = consensus.consensusScore > 0;
    const divergenceBullish = rsiDivergence.type === "bullish";
    
    if (consensusBullish === divergenceBullish) {
      confidence += 6 * rsiDivergence.strength; // Aligned divergence (reduced from 8)
    } else {
      confidence -= 3; // Conflicting divergence (reduced from 5)
    }
  }

  // MACD Divergence confirmation (+/- points)
  if (macdDivergence.hasDivergence) {
    const consensusBullish = consensus.consensusScore > 0;
    const divergenceBullish = macdDivergence.type === "bullish";
    
    if (consensusBullish === divergenceBullish) {
      confidence += 4 * macdDivergence.strength; // Reduced from 5
    } else {
      confidence -= 2; // Reduced from 3
    }
  }

  // Sentiment alignment (+/- points)
  if ((sentiment.score > 0.2 && consensus.consensusScore > 0) ||
      (sentiment.score < -0.2 && consensus.consensusScore < 0)) {
    confidence += 4 * sentiment.confidence; // Reduced from 5
  } else if ((sentiment.score > 0.2 && consensus.consensusScore < 0) ||
             (sentiment.score < -0.2 && consensus.consensusScore > 0)) {
    confidence -= 2; // Reduced from 3
  }

  // Weekly timeframe alignment - REBALANCED: symmetric and reduced
  if (weeklyAlignment) {
    confidence += 5; // Bonus for alignment
  } else {
    confidence -= 5; // Reduced penalty from -10 to -5
  }

  // Time decay - REBALANCED: reduced penalties
  if (daysToTarget > 90) confidence -= 7; // Reduced from -10
  else if (daysToTarget > 60) confidence -= 5; // Reduced from -7
  else if (daysToTarget > 30) confidence -= 3; // Reduced from -5

  // Mixed signals penalty - REBALANCED: reduced from -15 to -8
  if (Math.abs(consensus.consensusScore) < 20) {
    confidence -= 8;
  }

  // Clamp between 35 and 92
  return Math.max(35, Math.min(92, Math.round(confidence)));
}

// ============================================================================
// NEW: DYNAMIC UNCERTAINTY CALCULATION
// ============================================================================
function calculateDynamicUncertainty(
  atr: number[],
  currentPrice: number,
  regime: { regime: string },
  daysToTarget: number,
  volatility: number[],
  ticker: string = ""
): number {
  const latestATR = atr[atr.length - 1] || 0;
  const latestVol = volatility[volatility.length - 1] || 0.02;
  
  // Base uncertainty on ATR as percentage of price
  const atrPercent = (latestATR / currentPrice) * 100;
  
  // Scale by square root of time (volatility scales with sqrt of time)
  let uncertainty = atrPercent * Math.sqrt(daysToTarget / 5);

  // Also factor in historical volatility
  uncertainty = (uncertainty + latestVol * 100 * Math.sqrt(daysToTarget / 5)) / 2;

  // Regime adjustments
  if (regime.regime === "volatile") uncertainty *= 1.3;
  if (regime.regime === "ranging") uncertainty *= 0.8;
  if (regime.regime.includes("strong")) uncertainty *= 0.9; // Trending = more predictable

  // Cap: 30% for crypto, 18% for stocks
  const isCrypto = ticker.includes('-USD');
  const maxCap = isCrypto ? 30 : 18;
  return Math.max(3, Math.min(maxCap, uncertainty));
}

// ============================================================================
// ENHANCED: Regime Detection with ADX
// ============================================================================
function detectRegimeEnhanced(
  prices: number[],
  rsi: number[],
  volatility: number[],
  adx: { adx: number[]; plusDI: number[]; minusDI: number[] },
  bollingerBands: { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[] },
  shockState?: ShockState
): { regime: string; strength: number; description: string } {
  // SHOCK OVERRIDE: event_volatility takes precedence over all other regimes
  if (shockState?.isShock) {
    return {
      regime: "event_volatility",
      strength: shockState.shockMagnitude,
      description: `EVENT REGIME: ${shockState.description}. Standard indicators unreliable.`,
    };
  }

  const latestADX = adx.adx[adx.adx.length - 1] || 0;
  const latestPlusDI = adx.plusDI[adx.plusDI.length - 1] || 0;
  const latestMinusDI = adx.minusDI[adx.minusDI.length - 1] || 0;
  const latestRSI = rsi[rsi.length - 1] || 50;
  const latestVol = volatility[volatility.length - 1] || 0;
  const avgVol = volatility.slice(-60).filter(v => !isNaN(v)).reduce((a, b) => a + b, 0) / 60 || 0.02;
  const currentPrice = prices[prices.length - 1];
  const bbUpper = bollingerBands.upper[bollingerBands.upper.length - 1];
  const bbLower = bollingerBands.lower[bollingerBands.lower.length - 1];
  const bbBandwidth = bollingerBands.bandwidth[bollingerBands.bandwidth.length - 1] || 0;

  // Strong trend detection using ADX
  if (latestADX > 25) {
    if (latestPlusDI > latestMinusDI) {
      if (latestADX > 40 && latestRSI > 60) {
        return { regime: "strong_bullish", strength: latestADX, description: `Very strong uptrend (ADX: ${latestADX.toFixed(1)}, +DI dominant)` };
      }
      return { regime: "bullish", strength: latestADX, description: `Uptrend confirmed by ADX (${latestADX.toFixed(1)})` };
    } else {
      if (latestADX > 40 && latestRSI < 40) {
        return { regime: "strong_bearish", strength: latestADX, description: `Very strong downtrend (ADX: ${latestADX.toFixed(1)}, -DI dominant)` };
      }
      return { regime: "bearish", strength: latestADX, description: `Downtrend confirmed by ADX (${latestADX.toFixed(1)})` };
    }
  }

  // Overbought/Oversold
  if (latestRSI > 70 && currentPrice > bbUpper) {
    return { regime: "overbought", strength: latestRSI, description: `Overbought: RSI at ${latestRSI.toFixed(1)}, price above upper BB` };
  }
  if (latestRSI < 30 && currentPrice < bbLower) {
    return { regime: "oversold", strength: 100 - latestRSI, description: `Oversold: RSI at ${latestRSI.toFixed(1)}, price below lower BB` };
  }

  // High volatility
  if (latestVol > avgVol * 1.5) {
    return { regime: "volatile", strength: (latestVol / avgVol) * 100, description: `High volatility (${(latestVol * 100).toFixed(1)}% vs avg ${(avgVol * 100).toFixed(1)}%)` };
  }

  // Ranging
  if (bbBandwidth < 0.03 && latestADX < 20) {
    return { regime: "ranging", strength: 100 - latestADX, description: "Tight range: Low ADX and narrow Bollinger Bands" };
  }

  // Moderate trends
  const recentPrices = prices.slice(-20);
  const priceChange = (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0];
  
  if (priceChange > 0.03 && latestRSI > 50) {
    return { regime: "bullish", strength: priceChange * 100, description: "Moderate uptrend with positive momentum" };
  }
  if (priceChange < -0.03 && latestRSI < 50) {
    return { regime: "bearish", strength: Math.abs(priceChange) * 100, description: "Moderate downtrend with negative momentum" };
  }

  return { regime: "neutral", strength: 0, description: "Neutral market conditions, no clear direction" };
}

// Legacy detectRegime for compatibility
function detectRegime(prices: number[], rsi: number[], volatility: number[]): string {
  const recentPrices = prices.slice(-20);
  const priceChange = (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0];
  const latestRSI = rsi[rsi.length - 1];
  const latestVolatility = volatility[volatility.length - 1];
  const avgVolatility = volatility.slice(-60).filter(v => !isNaN(v)).reduce((a, b) => a + b, 0) / 60;
  
  if (latestVolatility > avgVolatility * 1.5) return "volatile";
  if (priceChange > 0.05 && latestRSI > 50) return "bullish";
  if (priceChange < -0.05 && latestRSI < 50) return "bearish";
  return "neutral";
}

// ============================================================================
// NEW: WEEKLY TIMEFRAME FUNCTIONS
// ============================================================================
async function fetchWeeklyData(ticker: string): Promise<any> {
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - (365 * 2 * 24 * 60 * 60); // 2 years
  
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startDate}&period2=${endDate}&interval=1wk`;
  
  console.log(`Fetching weekly data for ${ticker}...`);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.warn(`Failed to fetch weekly data: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.chart.error) {
      console.warn("Weekly data error:", data.chart.error.description);
      return null;
    }
    
    const result = data.chart.result[0];
    const quotes = result.indicators.quote[0];
    
    return {
      timestamps: result.timestamp.map((t: number) => new Date(t * 1000).toISOString().split('T')[0]),
      close: quotes.close,
      high: quotes.high,
      low: quotes.low,
    };
  } catch (error) {
    console.error("Error fetching weekly data:", error);
    return null;
  }
}

function getWeeklyTrendAlignment(
  weeklyData: any,
  dailyConsensus: { consensusScore: number; alignment: string }
): { aligned: boolean; weeklyTrend: string; weeklyRSI: number; description: string } {
  if (!weeklyData || !weeklyData.close || weeklyData.close.length < 20) {
    return { aligned: true, weeklyTrend: "unknown", weeklyRSI: 50, description: "Insufficient weekly data" };
  }

  const closePrices = weeklyData.close.filter((p: number) => p != null);
  const weeklyRSI = calculateRSI(closePrices, 14);
  const weeklyEMA12 = calculateEMA(closePrices, 12);
  const weeklyEMA26 = calculateEMA(closePrices, 26);

  const latestRSI = weeklyRSI[weeklyRSI.length - 1] || 50;
  const latestEMA12 = weeklyEMA12[weeklyEMA12.length - 1];
  const latestEMA26 = weeklyEMA26[weeklyEMA26.length - 1];

  let weeklyTrend = "neutral";
  if (latestEMA12 > latestEMA26 && latestRSI > 50) {
    weeklyTrend = "bullish";
  } else if (latestEMA12 < latestEMA26 && latestRSI < 50) {
    weeklyTrend = "bearish";
  }

  const dailyBullish = dailyConsensus.consensusScore > 0;
  const weeklyBullish = weeklyTrend === "bullish";
  const weeklyBearish = weeklyTrend === "bearish";

  const aligned = (dailyBullish && weeklyBullish) || (!dailyBullish && weeklyBearish) || weeklyTrend === "neutral";

  let description = "";
  if (aligned) {
    description = `Weekly trend (${weeklyTrend}) confirms daily signals`;
  } else {
    description = `WARNING: Weekly trend (${weeklyTrend}) conflicts with daily signals`;
  }

  return { aligned, weeklyTrend, weeklyRSI: latestRSI, description };
}

// ============================================================================
// DATA FETCHING
// ============================================================================
async function fetchStockData(ticker: string): Promise<any> {
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - (365 * 2 * 24 * 60 * 60); // 2 years
  
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startDate}&period2=${endDate}&interval=1d`;
  
  console.log(`Fetching stock data for ${ticker}...`);
  
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch stock data: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (data.chart.error) {
    throw new Error(data.chart.error.description || "Invalid ticker symbol");
  }
  
  const result = data.chart.result[0];
  const quotes = result.indicators.quote[0];
  const timestamps = result.timestamp;
  
  return {
    timestamps: timestamps.map((t: number) => new Date(t * 1000).toISOString().split('T')[0]),
    open: quotes.open,
    high: quotes.high,
    low: quotes.low,
    close: quotes.close,
    volume: quotes.volume,
    currency: result.meta.currency,
    symbol: result.meta.symbol,
  };
}

// ENHANCED: News Sentiment with Recency Weighting and Expanded Word Lists
async function fetchNewsSentiment(ticker: string): Promise<{ score: number; articleCount: number; confidence: number }> {
  const apiKey = Deno.env.get("NEWSAPI_KEY");
  
  if (!apiKey || apiKey.length < 20) {
    console.log("No NewsAPI key configured, skipping sentiment analysis");
    return { score: 0, articleCount: 0, confidence: 0 };
  }
  
  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(ticker)}&sortBy=publishedAt&apiKey=${apiKey}&pageSize=30`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== "ok" || !data.articles?.length) {
      return { score: 0, articleCount: 0, confidence: 0 };
    }
    
    // Expanded word lists
    const positiveWords = [
      'surge', 'soar', 'jump', 'gain', 'rise', 'rally', 'growth', 'profit', 'beat',
      'strong', 'bull', 'buy', 'upgrade', 'outperform', 'record', 'breakthrough',
      'innovative', 'exceed', 'momentum', 'bullish', 'optimistic', 'boom',
      'recovery', 'rebound', 'accelerate', 'expand', 'success', 'positive',
      'upside', 'opportunity', 'confident', 'impressive'
    ];
    const negativeWords = [
      'fall', 'drop', 'decline', 'plunge', 'crash', 'down', 'loss', 'miss', 'weak',
      'bear', 'sell', 'downgrade', 'underperform', 'warning', 'concern', 'fear',
      'risk', 'lawsuit', 'investigation', 'bearish', 'pessimistic', 'bust',
      'slump', 'tumble', 'crisis', 'trouble', 'struggle', 'negative',
      'downside', 'threat', 'uncertain', 'disappointing'
    ];

    let totalScore = 0;
    const now = Date.now();
    
    for (const article of data.articles) {
      const text = (article.title + ' ' + (article.description || '')).toLowerCase();
      const publishedAt = new Date(article.publishedAt).getTime();
      const hoursAgo = (now - publishedAt) / (1000 * 60 * 60);
      
      // Recency weight: recent news matters more (decays over 1 week)
      const recencyWeight = Math.max(0.3, 1 - (hoursAgo / 168));
      
      let score = 0;
      const negationWords = ['not', 'no', "don't", "doesn't", "isn't", "aren't", "wasn't", "weren't", "never", "neither", "barely", "hardly"];
      
      const hasNegationBefore = (text: string, wordIndex: number): boolean => {
        const before = text.substring(Math.max(0, wordIndex - 25), wordIndex);
        return negationWords.some(neg => before.includes(neg));
      };
      
      for (const word of positiveWords) {
        const idx = text.indexOf(word);
        if (idx !== -1) {
          score += hasNegationBefore(text, idx) ? -0.08 : 0.08;
        }
      }
      for (const word of negativeWords) {
        const idx = text.indexOf(word);
        if (idx !== -1) {
          score += hasNegationBefore(text, idx) ? 0.08 : -0.08;
        }
      }
      
      totalScore += Math.max(-1, Math.min(1, score)) * recencyWeight;
    }

    const avgScore = totalScore / data.articles.length;
    const confidence = Math.min(1, data.articles.length / 20); // More articles = higher confidence
    
    return { 
      score: parseFloat(avgScore.toFixed(3)), 
      articleCount: data.articles.length, 
      confidence: parseFloat(confidence.toFixed(2)) 
    };
  } catch (error) {
    console.error("Error fetching news sentiment:", error);
    return { score: 0, articleCount: 0, confidence: 0 };
  }
}

// Helper for safe number formatting
const safeToFixed = (val: number | null | undefined, digits: number = 2): string => {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return val.toFixed(digits);
};

// ============================================================================
// ENHANCED: AI Prediction with All New Indicators
// ============================================================================
async function generateAIPrediction(
  ticker: string,
  targetDate: string,
  stockData: any,
  indicators: any,
  regimeInfo: { regime: string; strength: number; description: string },
  sentiment: { score: number; articleCount: number; confidence: number },
  consensus: { consensusScore: number; alignment: string; signalDetails: string[] },
  rsiDivergence: { hasDivergence: boolean; type: string; strength: number; description: string },
  macdDivergence: { hasDivergence: boolean; type: string; strength: number; description: string },
  mathConfidence: number,
  dynamicUncertainty: number,
  weeklyAlignment: { aligned: boolean; weeklyTrend: string; description: string },
  pivotPoints: { pivot: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number }
): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }
  
  const currentPrice = stockData.close[stockData.close.length - 1];
  
  const recentData = {
    prices: stockData.close.slice(-30),
    dates: stockData.timestamps.slice(-30),
    currentPrice: currentPrice,
    ema12: indicators.ema12.slice(-5),
    ema26: indicators.ema26.slice(-5),
    sma50: indicators.sma50.slice(-5),
    rsi: indicators.rsi.slice(-5),
    macd: indicators.macd.macd.slice(-5),
    macdSignal: indicators.macd.signal.slice(-5),
    volatility: indicators.volatility.slice(-5),
    stochK: indicators.stochastic.k.slice(-5),
    stochD: indicators.stochastic.d.slice(-5),
    adx: indicators.adx.adx.slice(-5),
    plusDI: indicators.adx.plusDI.slice(-5),
    minusDI: indicators.adx.minusDI.slice(-5),
    atr: indicators.atr.slice(-5),
    bbUpper: indicators.bollingerBands.upper.slice(-5),
    bbLower: indicators.bollingerBands.lower.slice(-5),
    bbBandwidth: indicators.bollingerBands.bandwidth.slice(-5),
  };
  
  const prompt = `You are an expert quantitative analyst with access to comprehensive technical indicators and a pre-calculated signal consensus system. Analyze this ${ticker.includes('-') ? 'cryptocurrency' : 'stock'} data and provide a prediction.

ASSET: ${ticker}
TARGET DATE: ${targetDate}
CURRENT PRICE: $${safeToFixed(currentPrice)}

===== SIGNAL CONSENSUS SYSTEM =====
Bullish Signals: ${consensus.consensusScore > 0 ? Math.abs(consensus.consensusScore).toFixed(1) : '0'}
Bearish Signals: ${consensus.consensusScore < 0 ? Math.abs(consensus.consensusScore).toFixed(1) : '0'}
Consensus Score: ${consensus.consensusScore.toFixed(1)} (range: -100 to +100)
Alignment: ${consensus.alignment.toUpperCase()}
Active Signals: ${consensus.signalDetails.join(', ')}

===== DIVERGENCE DETECTION =====
RSI Divergence: ${rsiDivergence.hasDivergence ? `${rsiDivergence.type.toUpperCase()} (strength: ${(rsiDivergence.strength * 100).toFixed(0)}%)` : 'None'}
${rsiDivergence.description}
MACD Divergence: ${macdDivergence.hasDivergence ? `${macdDivergence.type.toUpperCase()} (strength: ${(macdDivergence.strength * 100).toFixed(0)}%)` : 'None'}
${macdDivergence.description}

===== CALCULATED METRICS =====
Mathematical Confidence: ${mathConfidence}% (pre-calculated baseline)
Dynamic Uncertainty: ${dynamicUncertainty.toFixed(1)}% (ATR-based)
Weekly Trend Alignment: ${weeklyAlignment.aligned ? "CONFIRMED" : "CONFLICTING"} (${weeklyAlignment.weeklyTrend})
${weeklyAlignment.description}

===== PIVOT POINTS (Today) =====
Pivot: $${safeToFixed(pivotPoints.pivot)}
R1: $${safeToFixed(pivotPoints.r1)} | R2: $${safeToFixed(pivotPoints.r2)} | R3: $${safeToFixed(pivotPoints.r3)}
S1: $${safeToFixed(pivotPoints.s1)} | S2: $${safeToFixed(pivotPoints.s2)} | S3: $${safeToFixed(pivotPoints.s3)}

===== MARKET REGIME =====
Regime: ${regimeInfo.regime.toUpperCase()}
Strength: ${safeToFixed(regimeInfo.strength, 1)}
Description: ${regimeInfo.description}

===== NEWS SENTIMENT =====
Score: ${safeToFixed(sentiment.score)} (scale -1 to 1)
Articles Analyzed: ${sentiment.articleCount}
Confidence: ${safeToFixed(sentiment.confidence * 100)}%

===== SUPPORT & RESISTANCE =====
Support: ${indicators.supportResistance.support.map((s: number) => `$${safeToFixed(s)}`).join(', ') || 'None detected'}
Resistance: ${indicators.supportResistance.resistance.map((r: number) => `$${safeToFixed(r)}`).join(', ') || 'None detected'}

===== FIBONACCI LEVELS (${indicators.fibonacci.trend}) =====
${indicators.fibonacci.levels.map((l: { ratio: number; price: number }) => `${(l.ratio * 100).toFixed(1)}%: $${safeToFixed(l.price)}`).join(' | ')}

===== VWAP =====
Current VWAP: $${safeToFixed(indicators.vwap[indicators.vwap.length - 1])}
Price vs VWAP: ${currentPrice > indicators.vwap[indicators.vwap.length - 1] ? 'ABOVE' : 'BELOW'}

===== VOLUME ANALYSIS =====
OBV Trend: ${indicators.obvTrend}

===== RECENT PRICE DATA (last 30 days) =====
${recentData.dates.slice(-10).map((d: string, i: number) => `${d}: $${safeToFixed(recentData.prices.slice(-10)[i])}`).join('\n')}

===== INSTRUCTIONS =====
1. Use the Mathematical Confidence (${mathConfidence}%) as your baseline. You may adjust by +/- 4% based on factors not captured in the formula. You MUST explain any deviation from the baseline.
2. Use the Dynamic Uncertainty (${dynamicUncertainty.toFixed(1)}%) as your baseline for uncertainty bands. You may adjust by +/- 3%.
3. If weekly trend conflicts with daily signals, REDUCE confidence by 10%.
4. Pay special attention to divergences - they often precede reversals.
5. Consider pivot points for near-term price targets.

You MUST respond with ONLY valid JSON in this exact format:
{
  "predictedPrice": <number>,
  "uncertaintyPercent": <number between 3 and 18>,
  "confidence": <number between 35 and 92>,
  "reasoning": "<brief 2-3 sentence explanation including key signals from the consensus system>",
  "featureImportance": [
    {"name": "Signal Consensus", "importance": <0-1>},
    {"name": "RSI Divergence", "importance": <0-1>},
    {"name": "MACD Trend", "importance": <0-1>},
    {"name": "Weekly Alignment", "importance": <0-1>},
    {"name": "ADX Trend Strength", "importance": <0-1>},
    {"name": "Bollinger Bands", "importance": <0-1>},
    {"name": "Pivot Points", "importance": <0-1>},
    {"name": "VWAP Position", "importance": <0-1>},
    {"name": "Market Regime", "importance": <0-1>},
    {"name": "News Sentiment", "importance": <0-1>}
  ]
}`;

  console.log("Calling Lovable AI for ultra-enhanced prediction...");
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a quantitative financial analyst with expertise in technical analysis. Respond only with valid JSON. Use the pre-calculated confidence and uncertainty as baselines." },
        { role: "user", content: prompt }
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add credits to continue.");
    }
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    throw new Error("AI prediction failed");
  }

  const aiData = await response.json();
  const content = aiData.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error("No response from AI");
  }
  
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }
  
  try {
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    console.error("Failed to parse AI response:", content);
    throw new Error("Failed to parse AI prediction");
  }
}

// ENHANCED: Price Target Prediction with All Indicators + Date Validation
async function generatePriceTargetPrediction(
  ticker: string,
  targetPrice: number,
  stockData: any,
  indicators: any,
  regimeInfo: { regime: string; strength: number; description: string },
  sentiment: { score: number; articleCount: number; confidence: number },
  consensus: { consensusScore: number; alignment: string; signalDetails: string[] },
  rsiDivergence: { hasDivergence: boolean; type: string; strength: number; description: string },
  weeklyAlignment: { aligned: boolean; weeklyTrend: string; description: string }
): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }
  
  const currentPrice = stockData.close[stockData.close.length - 1];
  const priceChange = ((targetPrice - currentPrice) / currentPrice) * 100;
  const direction = targetPrice > currentPrice ? "up" : "down";
  
  // Calculate historical price movement rates
  const prices = stockData.close.filter((p: number) => p != null);
  const dailyReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    dailyReturns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const avgAbsDailyReturn = dailyReturns.map(Math.abs).reduce((a, b) => a + b, 0) / dailyReturns.length;
  
  // Calculate period changes for context
  const change30d = prices.length >= 30 ? ((prices[prices.length - 1] - prices[prices.length - 30]) / prices[prices.length - 30]) * 100 : 0;
  const change90d = prices.length >= 90 ? ((prices[prices.length - 1] - prices[prices.length - 90]) / prices[prices.length - 90]) * 100 : 0;
  const change180d = prices.length >= 180 ? ((prices[prices.length - 1] - prices[prices.length - 180]) / prices[prices.length - 180]) * 100 : 0;
  
  // CRITICAL FIX: Include current date in prompt to prevent past date predictions
  const currentDate = new Date().toISOString().split('T')[0];
  
  const prompt = `You are an expert quantitative analyst. Analyze when this ${ticker.includes('-') ? 'cryptocurrency' : 'stock'} might reach the target price.

CRITICAL: TODAY'S DATE IS ${currentDate}. ALL DATES YOU PROVIDE MUST BE IN THE FUTURE (after ${currentDate}).

ASSET: ${ticker}
CURRENT PRICE: $${safeToFixed(currentPrice)}
TARGET PRICE: $${safeToFixed(targetPrice)}
REQUIRED CHANGE: ${priceChange > 0 ? '+' : ''}${safeToFixed(priceChange)}% (${direction})

===== SIGNAL CONSENSUS =====
Consensus Score: ${consensus.consensusScore.toFixed(1)} (-100 to +100)
Alignment: ${consensus.alignment}
Active Signals: ${consensus.signalDetails.slice(0, 5).join(', ')}

===== DIVERGENCE WARNING =====
RSI Divergence: ${rsiDivergence.hasDivergence ? `${rsiDivergence.type.toUpperCase()} - ${rsiDivergence.description}` : 'None'}

===== WEEKLY TREND =====
${weeklyAlignment.description}
Alignment: ${weeklyAlignment.aligned ? "CONFIRMS daily signals" : "CONFLICTS with daily signals"}

===== MARKET REGIME =====
${regimeInfo.regime.toUpperCase()}: ${regimeInfo.description}

===== NEWS SENTIMENT =====
Score: ${safeToFixed(sentiment.score)} (${sentiment.articleCount} articles)

===== SUPPORT & RESISTANCE =====
Support: ${indicators.supportResistance.support.map((s: number) => `$${safeToFixed(s)}`).join(', ') || 'None'}
Resistance: ${indicators.supportResistance.resistance.map((r: number) => `$${safeToFixed(r)}`).join(', ') || 'None'}

===== HISTORICAL PERFORMANCE =====
30-Day Change: ${safeToFixed(change30d)}%
90-Day Change: ${safeToFixed(change90d)}%
180-Day Change: ${safeToFixed(change180d)}%
Average Daily Return: ${safeToFixed(avgDailyReturn * 100, 3)}%
Average Daily Volatility: ${safeToFixed(avgAbsDailyReturn * 100, 3)}%

===== KEY INDICATORS =====
RSI: ${safeToFixed(safeGetLast(indicators.rsi, 50), 1)}
ADX: ${safeToFixed(safeGetLast(indicators.adx?.adx, 0), 1)}
OBV Trend: ${indicators.obvTrend}

Analyze the likelihood and timeframe for reaching $${safeToFixed(targetPrice)}. Consider:
1. Is this target realistic given support/resistance and historical movement?
2. How long based on average returns and current trend strength?
3. Does the weekly trend support or conflict with this target?
4. Any divergence warnings that might affect timing?

REMEMBER: Today is ${currentDate}. All dates must be AFTER this date.

You MUST respond with ONLY valid JSON:
{
  "estimatedDate": "<YYYY-MM-DD most likely date, MUST be after ${currentDate}>",
  "estimatedDateRangeLow": "<YYYY-MM-DD best case, MUST be after ${currentDate}>",
  "estimatedDateRangeHigh": "<YYYY-MM-DD worst case, MUST be after ${currentDate}>",
  "probability": <0-100>,
  "isRealistic": <true or false>,
  "reasoning": "<2-3 sentence explanation>",
  "keyFactors": ["<factor 1>", "<factor 2>", "<factor 3>"]
}`;

  console.log("Calling Lovable AI for enhanced price target prediction...");
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: `You are a quantitative financial analyst specializing in price target analysis. Today's date is ${currentDate}. All dates you provide MUST be in the future. Respond only with valid JSON.` },
        { role: "user", content: prompt }
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add credits to continue.");
    }
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    throw new Error("AI price target prediction failed");
  }

  const aiData = await response.json();
  const content = aiData.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error("No response from AI");
  }
  
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }
  
  try {
    const parsed = JSON.parse(jsonStr.trim());
    
    // CRITICAL FIX: Validate and correct dates if they're in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const validateAndFixDate = (dateStr: string, minDaysFromNow: number = 1): string => {
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime()) || date <= today) {
          // Date is invalid or in the past - calculate a reasonable future date
          const futureDate = new Date(today);
          futureDate.setDate(futureDate.getDate() + minDaysFromNow);
          return futureDate.toISOString().split('T')[0];
        }
        return dateStr;
      } catch {
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + minDaysFromNow);
        return futureDate.toISOString().split('T')[0];
      }
    };
    
    // Calculate reasonable future dates based on price change required
    const daysNeeded = Math.max(7, Math.ceil(Math.abs(priceChange) / (avgAbsDailyReturn * 100) * 1.5));
    
    // Validate and fix all dates
    parsed.estimatedDate = validateAndFixDate(parsed.estimatedDate, daysNeeded);
    parsed.estimatedDateRangeLow = validateAndFixDate(parsed.estimatedDateRangeLow, Math.max(3, Math.floor(daysNeeded * 0.5)));
    parsed.estimatedDateRangeHigh = validateAndFixDate(parsed.estimatedDateRangeHigh, Math.ceil(daysNeeded * 1.5));
    
    // Ensure date range makes sense (low < estimated < high)
    const estDate = new Date(parsed.estimatedDate);
    const lowDate = new Date(parsed.estimatedDateRangeLow);
    const highDate = new Date(parsed.estimatedDateRangeHigh);
    
    if (lowDate >= estDate) {
      const newLow = new Date(estDate);
      newLow.setDate(newLow.getDate() - Math.max(3, Math.floor(daysNeeded * 0.3)));
      if (newLow <= today) {
        newLow.setDate(today.getDate() + 3);
      }
      parsed.estimatedDateRangeLow = newLow.toISOString().split('T')[0];
    }
    
    if (highDate <= estDate) {
      const newHigh = new Date(estDate);
      newHigh.setDate(newHigh.getDate() + Math.max(7, Math.floor(daysNeeded * 0.5)));
      parsed.estimatedDateRangeHigh = newHigh.toISOString().split('T')[0];
    }
    
    console.log(`Price target dates validated: ${parsed.estimatedDateRangeLow} - ${parsed.estimatedDate} - ${parsed.estimatedDateRangeHigh}`);
    
    return parsed;
  } catch (e) {
    console.error("Failed to parse AI response:", content);
    throw new Error("Failed to parse AI price target prediction");
  }
}

// Align OHLCV arrays - remove indices where ANY value is null
function alignArrays(close: any[], high: any[], low: any[], volume: any[]): { close: number[]; high: number[]; low: number[]; volume: number[] } {
  const aligned = { close: [] as number[], high: [] as number[], low: [] as number[], volume: [] as number[] };
  for (let i = 0; i < close.length; i++) {
    if (close[i] != null && high[i] != null && low[i] != null && volume[i] != null) {
      aligned.close.push(close[i]);
      aligned.high.push(high[i]);
      aligned.low.push(low[i]);
      aligned.volume.push(volume[i]);
    }
  }
  return aligned;
}

// Calculate all enhanced indicators
function calculateAllIndicators(stockData: any) {
  const rawClose = stockData.close || [];
  const rawHigh = stockData.high || rawClose;
  const rawLow = stockData.low || rawClose;
  const rawVolume = stockData.volume || new Array(rawClose.length).fill(1000000);
  
  const { close: closePrices, high: highPrices, low: lowPrices, volume: volumes } = alignArrays(rawClose, rawHigh, rawLow, rawVolume);

  const ema12 = calculateEMA(closePrices, 12);
  const ema26 = calculateEMA(closePrices, 26);
  const sma50 = calculateSMA(closePrices, 50);
  const rsi = calculateRSI(closePrices, 14);
  const macd = calculateMACD(closePrices);
  const volatility = calculateVolatility(closePrices, 20);
  
  // Core indicators
  const bollingerBands = calculateBollingerBands(closePrices, 20, 2);
  const atr = calculateATR(highPrices, lowPrices, closePrices, 14);
  const stochastic = calculateStochastic(closePrices, highPrices, lowPrices, 14, 3);
  const adx = calculateADX(highPrices, lowPrices, closePrices, 14);
  const obv = calculateOBV(closePrices, volumes);
  const obvTrend = getOBVTrend(obv, 20);
  const supportResistance = findSupportResistance(closePrices, 60);
  const fibonacci = calculateFibonacciLevels(closePrices, 60);
  
  // NEW: VWAP
  const vwap = calculateVWAP(highPrices, lowPrices, closePrices, volumes);

  return {
    ema12,
    ema26,
    sma50,
    rsi,
    macd,
    volatility,
    bollingerBands,
    atr,
    stochastic,
    adx,
    obv,
    obvTrend,
    supportResistance,
    fibonacci,
    vwap,
  };
}

// Trading style configurations
const tradingStyles = {
  scalping: {
    volatilityPreference: "high",
    holdingPeriod: "Minutes to hours",
    minVolatility: 0.02,
    preferredRegimes: ["volatile"],
    scoreMultiplier: (volatility: number) => volatility > 0.03 ? 1.5 : 1,
    roiMultiplier: 1.0,
  },
  daytrading: {
    volatilityPreference: "medium-high",
    holdingPeriod: "Hours (same day)",
    minVolatility: 0.015,
    preferredRegimes: ["bullish", "bearish", "volatile"],
    scoreMultiplier: (volatility: number) => volatility > 0.02 ? 1.3 : 1,
    roiMultiplier: 1.2,
  },
  swing: {
    volatilityPreference: "medium",
    holdingPeriod: "Days to weeks",
    minVolatility: 0.01,
    preferredRegimes: ["bullish", "bearish", "strong_bullish", "strong_bearish"],
    scoreMultiplier: () => 1,
    roiMultiplier: 1.5,
  },
  position: {
    volatilityPreference: "low",
    holdingPeriod: "Weeks to months",
    minVolatility: 0.005,
    preferredRegimes: ["strong_bullish", "strong_bearish", "bullish", "bearish"],
    scoreMultiplier: (volatility: number) => volatility < 0.02 ? 1.3 : 1,
    roiMultiplier: 2.0,
  },
};

// Screeners by trading style
const screenersByStyle = {
  scalping: ["day_gainers", "day_losers", "most_actives"],
  daytrading: ["day_gainers", "day_losers", "most_actives", "undervalued_growth_stocks"],
  swing: ["day_gainers", "day_losers", "undervalued_growth_stocks", "growth_technology_stocks", "52_wk_high"],
  position: ["undervalued_growth_stocks", "undervalued_large_caps", "growth_technology_stocks", "52_wk_high", "52_wk_low"],
};

async function fetchMarketScreener(tradingStyle: string): Promise<{ ticker: string; percentChange: number; volume: number; marketCap: number }[]> {
  const screeners = screenersByStyle[tradingStyle as keyof typeof screenersByStyle] || screenersByStyle.swing;
  const allTickers = new Map<string, { ticker: string; percentChange: number; volume: number; marketCap: number }>();
  
  for (const screenerId of screeners) {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${screenerId}&count=40`;
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
      
      if (!response.ok) {
        console.warn(`Screener fetch failed: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      const quotes = data?.finance?.result?.[0]?.quotes || [];
      
      const minMarketCap = tradingStyle === "position" ? 10000000000 :
                          tradingStyle === "scalping" ? 500000000 :
                          1000000000;
      
      const minVolume = tradingStyle === "scalping" ? 5000000 :
                       tradingStyle === "daytrading" ? 2000000 :
                       500000;
      
      for (const quote of quotes) {
        if (quote.symbol && 
            !quote.symbol.includes('.') && 
            (quote.marketCap || 0) >= minMarketCap &&
            (quote.regularMarketVolume || 0) >= minVolume) {
          allTickers.set(quote.symbol, {
            ticker: quote.symbol,
            percentChange: Math.abs(quote.regularMarketChangePercent || 0),
            volume: quote.regularMarketVolume || 0,
            marketCap: quote.marketCap || 0,
          });
        }
      }
    } catch (error) {
      console.error("Screener fetch error:", error);
    }
  }
  
  const tickers = Array.from(allTickers.values());
  
  if (tradingStyle === "scalping" || tradingStyle === "daytrading") {
    tickers.sort((a, b) => (b.percentChange * b.volume) - (a.percentChange * a.volume));
  } else if (tradingStyle === "position") {
    tickers.sort((a, b) => b.marketCap - a.marketCap);
  } else {
    tickers.sort((a, b) => b.percentChange - a.percentChange);
  }
  
  console.log(`Fetched ${tickers.length} tickers from screener for ${tradingStyle} style`);
  return tickers.slice(0, 50);
}

const fallbackStocks = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
  "JPM", "V", "JNJ", "WMT", "PG", "UNH", "HD",
  "DIS", "NFLX", "AMD", "INTC", "CRM", "PYPL",
  "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "ADA-USD"
];

// ENHANCED: Guide Analysis with New Indicators
async function analyzeStockForGuide(ticker: string, tradingStyle: string = "swing", volumeData?: number): Promise<any | null> {
  try {
    const stockData = await fetchStockData(ticker);
    
    if (!stockData.close || stockData.close.length < 60) {
      console.log(`${ticker} rejected: insufficient data (${stockData.close?.length || 0} days)`);
      return null;
    }
    
    const rawClose = stockData.close || [];
    const rawHigh = stockData.high || rawClose;
    const rawLow = stockData.low || rawClose;
    const rawVolume = stockData.volume || [];
    const { close: closePrices, high: highPrices, low: lowPrices, volume: volumes } = alignArrays(rawClose, rawHigh, rawLow, rawVolume);
    const latestVolume = volumes[volumes.length - 1] || volumeData || 0;
    
    // Calculate all indicators including new ones
    const ema12 = calculateEMA(closePrices, 12);
    const ema26 = calculateEMA(closePrices, 26);
    const sma50 = calculateSMA(closePrices, 50);
    const rsi = calculateRSI(closePrices, 14);
    const macd = calculateMACD(closePrices);
    const volatility = calculateVolatility(closePrices, 20);
    const bollingerBands = calculateBollingerBands(closePrices, 20, 2);
    const adx = calculateADX(highPrices, lowPrices, closePrices, 14);
    const stochastic = calculateStochastic(closePrices, highPrices, lowPrices, 14, 3);
    const obv = calculateOBV(closePrices, volumes);
    const obvTrend = getOBVTrend(obv, 20);
    const vwap = calculateVWAP(highPrices, lowPrices, closePrices, volumes);
    
    // Use enhanced regime detection
    const regimeInfo = detectRegimeEnhanced(closePrices, rsi, volatility, adx, bollingerBands);
    const regime = regimeInfo.regime;
    
    const currentPrice = closePrices[closePrices.length - 1];
    const latestRSI = rsi[rsi.length - 1];
    const latestMACD = macd.macd[macd.macd.length - 1];
    const latestSignal = macd.signal[macd.signal.length - 1];
    const latestVolatility = volatility[volatility.length - 1] || 0;
    const latestADX = adx.adx[adx.adx.length - 1] || 0;
    const latestStochK = stochastic.k[stochastic.k.length - 1] || 50;
    const latestBBUpper = bollingerBands.upper[bollingerBands.upper.length - 1];
    const latestBBLower = bollingerBands.lower[bollingerBands.lower.length - 1];
    
    const styleConfig = tradingStyles[tradingStyle as keyof typeof tradingStyles] || tradingStyles.swing;
    
    // === HARD REJECTION RULES ===
    if (tradingStyle === "scalping") {
      if (latestVolatility < 0.02) {
        console.log(`${ticker} rejected for scalping: volatility too low (${(latestVolatility * 100).toFixed(1)}%)`);
        return null;
      }
      if (latestVolume < 3000000) {
        console.log(`${ticker} rejected for scalping: volume too low (${latestVolume.toLocaleString()})`);
        return null;
      }
    }
    
    if (tradingStyle === "daytrading") {
      if (latestVolatility < 0.015) {
        console.log(`${ticker} rejected for daytrading: volatility too low (${(latestVolatility * 100).toFixed(1)}%)`);
        return null;
      }
      if (latestVolume < 1000000) {
        console.log(`${ticker} rejected for daytrading: volume too low`);
        return null;
      }
    }
    
    if (tradingStyle === "position") {
      if (latestVolatility > 0.05) {
        console.log(`${ticker} rejected for position: too volatile (${(latestVolatility * 100).toFixed(1)}%)`);
        return null;
      }
      if (regime === "volatile") {
        console.log(`${ticker} rejected for position: volatile regime`);
        return null;
      }
    }
    
    if (tradingStyle === "swing") {
      if (latestVolatility > 0.06) {
        console.log(`${ticker} rejected for swing: too volatile`);
        return null;
      }
      if (latestVolatility < 0.008) {
        console.log(`${ticker} rejected for swing: volatility too low`);
        return null;
      }
    }
    
    // Build indicators object for consensus
    const indicators = {
      rsi, macd, ema12, ema26, sma50, stochastic, adx, bollingerBands, obvTrend, vwap
    };
    
    // Use signal consensus system
    const consensus = calculateSignalConsensus(indicators, currentPrice);
    
    // Detect divergences
    const rsiDivergence = detectRSIDivergence(closePrices, rsi, 30);
    
    // === ENHANCED SCORING WITH CONSENSUS ===
    const priceChange5d = (closePrices[closePrices.length - 1] - closePrices[closePrices.length - 6]) / closePrices[closePrices.length - 6];
    const priceChange20d = (closePrices[closePrices.length - 1] - closePrices[closePrices.length - 21]) / closePrices[closePrices.length - 21];
    
    // Use consensus score as base
    let score = Math.abs(consensus.consensusScore) / 10;
    let direction: "bullish" | "bearish" | "neutral" = consensus.consensusScore > 0 ? "bullish" : consensus.consensusScore < 0 ? "bearish" : "neutral";
    let signals = [...consensus.signalDetails];
    
    // Divergence bonus
    if (rsiDivergence.hasDivergence) {
      if ((rsiDivergence.type === "bullish" && direction === "bullish") ||
          (rsiDivergence.type === "bearish" && direction === "bearish")) {
        score += 2;
        signals.push(`${rsiDivergence.type} RSI divergence`);
      }
    }
    
    // Momentum signals
    if (priceChange5d > 0.03 && priceChange20d > 0.05) {
      score += 1;
      signals.push("strong upward momentum");
      if (direction === "neutral") direction = "bullish";
    } else if (priceChange5d < -0.03 && priceChange20d < -0.05) {
      score += 1;
      signals.push("strong downward momentum");
      if (direction === "neutral") direction = "bearish";
    }
    
    // === STYLE-WEIGHTED SCORING ===
    if (styleConfig.preferredRegimes.includes(regime)) {
      score *= 1.5;
      signals.push(`${regime} regime match`);
    }
    
    if (styleConfig.volatilityPreference === "high" && latestVolatility > 0.025) {
      score *= 1.3;
    } else if (styleConfig.volatilityPreference === "low" && latestVolatility < 0.015) {
      score *= 1.3;
    } else if (styleConfig.volatilityPreference === "medium" && latestVolatility >= 0.01 && latestVolatility <= 0.025) {
      score *= 1.2;
    }
    
    score = score * styleConfig.scoreMultiplier(latestVolatility);
    
    // Require meaningful signal - now using consensus alignment
    if (score < 2.5 || consensus.alignment === "neutral") {
      return null;
    }
    
    // Use calibrated confidence when possible
    const macdDivergence = detectMACDDivergence(closePrices, macd.histogram, 30);
    const confidence = calculateMathematicalConfidence(
      consensus,
      rsiDivergence,
      macdDivergence,
      regimeInfo,
      { score: 0, confidence: 0 }, // No news sentiment for guide (too slow)
      14, // Assume ~2 weeks holding for guide
      true // Default to aligned since we skip weekly fetch for speed
    );
    
    let riskLevel: "low" | "medium" | "high" = "medium";
    if (latestVolatility > 0.03) {
      riskLevel = "high";
    } else if (latestVolatility < 0.015) {
      riskLevel = "low";
    }
    
    // ROI calculation
    const priceChangeMultiplier = direction === "bullish" ? 1 : -1;
    const baseChange = Math.min(0.08, latestVolatility * 2 + 0.02);
    const predictedChange = priceChangeMultiplier * baseChange * styleConfig.roiMultiplier;
    const predictedPrice = currentPrice * (1 + predictedChange);
    
    const expectedROI = ((predictedPrice - currentPrice) / currentPrice) * 100;
    const riskAdjustedROI = expectedROI / (1 + latestVolatility * 10);
    
    return {
      ticker,
      direction,
      confidence,
      explanation: `${signals.slice(0, 4).join(", ")}. Current price $${currentPrice.toFixed(2)}.`,
      strength: Math.min(5, Math.ceil(score)),
      score,
      currentPrice,
      predictedPrice,
      expectedROI: parseFloat(expectedROI.toFixed(2)),
      riskAdjustedROI: parseFloat(riskAdjustedROI.toFixed(2)),
      volatility: latestVolatility,
      volume: latestVolume,
      riskLevel,
      holdingPeriod: styleConfig.holdingPeriod,
      regime,
      regimeStrength: regimeInfo.strength,
      adxStrength: latestADX,
      obvTrend,
      consensusScore: consensus.consensusScore,
      consensusAlignment: consensus.alignment,
      hasDivergence: rsiDivergence.hasDivergence,
      divergenceType: rsiDivergence.type,
    };
  } catch (error) {
    console.error(`Failed to analyze ${ticker}:`, error);
    return null;
  }
}

async function enhanceWithAI(opportunities: any[], tradingStyle: string): Promise<any[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY || opportunities.length === 0) {
    return opportunities;
  }
  
  const styleInfo = tradingStyles[tradingStyle as keyof typeof tradingStyles] || tradingStyles.swing;
  
  const prompt = `You are an expert trading analyst. Analyze these ${tradingStyle} trading opportunities and provide enhanced insights.

TRADING STYLE: ${tradingStyle.toUpperCase()}
HOLDING PERIOD: ${styleInfo.holdingPeriod}

OPPORTUNITIES TO ANALYZE:
${opportunities.map((o, i) => `
${i + 1}. ${o.ticker}
   - Direction: ${o.direction}
   - Current Price: $${o.currentPrice.toFixed(2)}
   - Predicted Price: $${o.predictedPrice.toFixed(2)}
   - Expected ROI: ${o.expectedROI}%
   - Volatility: ${(o.volatility * 100).toFixed(1)}%
   - ADX Strength: ${o.adxStrength?.toFixed(1) || 'N/A'}
   - OBV Trend: ${o.obvTrend || 'N/A'}
   - Consensus Score: ${o.consensusScore?.toFixed(1) || 'N/A'}
   - Consensus Alignment: ${o.consensusAlignment || 'N/A'}
   - Divergence: ${o.hasDivergence ? o.divergenceType : 'None'}
   - Technical Signals: ${o.explanation}
   - Market Regime: ${o.regime}
`).join('\n')}

For each opportunity, provide enhanced analysis. Respond with ONLY valid JSON array:
[
  {
    "ticker": "<ticker>",
    "refinedConfidence": <40-95>,
    "aiReasoning": "<1-2 sentence detailed analysis>",
    "keyCatalyst": "<short catalyst to watch>",
    "riskFactor": "<main risk>",
    "refinedROI": <expected ROI percentage>
  }
]`;

  try {
    console.log("Enhancing opportunities with AI...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert trading analyst. Respond only with valid JSON array." },
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      console.warn("AI enhancement failed, returning original opportunities");
      return opportunities;
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content;
    
    if (!content) {
      return opportunities;
    }
    
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    const enhancements = JSON.parse(jsonStr.trim());
    
    return opportunities.map(opp => {
      const enhancement = enhancements.find((e: any) => e.ticker === opp.ticker);
      if (enhancement) {
        return {
          ...opp,
          confidence: enhancement.refinedConfidence || opp.confidence,
          aiReasoning: enhancement.aiReasoning || null,
          keyCatalyst: enhancement.keyCatalyst || null,
          riskFactor: enhancement.riskFactor || null,
          expectedROI: enhancement.refinedROI || opp.expectedROI,
          aiEnhanced: true,
        };
      }
      return { ...opp, aiEnhanced: false };
    });
  } catch (error) {
    console.error("AI enhancement error:", error);
    return opportunities;
  }
}

async function generateGuideOpportunities(tradingStyle: string = "swing"): Promise<any[]> {
  console.log(`Scanning market for ${tradingStyle} opportunities with ultra-enhanced indicators...`);
  
  let screenerResults: { ticker: string; percentChange: number; volume: number; marketCap: number }[] = [];
  
  try {
    screenerResults = await fetchMarketScreener(tradingStyle);
  } catch (error) {
    console.error("Market screener failed:", error);
  }
  
  const tickersToScan = screenerResults.length > 0 
    ? screenerResults.map(r => ({ ticker: r.ticker, volume: r.volume }))
    : fallbackStocks.map(t => ({ ticker: t, volume: 0 }));
  
  console.log(`Analyzing ${tickersToScan.length} tickers for ${tradingStyle} opportunities`);
  
  const opportunities: any[] = [];
  
  for (let i = 0; i < tickersToScan.length; i += 5) {
    const batch = tickersToScan.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(item => analyzeStockForGuide(item.ticker, tradingStyle, item.volume))
    );
    
    for (const result of results) {
      if (result) {
        opportunities.push(result);
      }
    }
    
    if (i + 5 < tickersToScan.length) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  
  console.log(`Found ${opportunities.length} valid ${tradingStyle} opportunities with ultra-enhanced analysis`);
  
  opportunities.sort((a, b) => b.score - a.score);
  
  const topOpportunities = opportunities.slice(0, 8);
  
  const enhancedOpportunities = await enhanceWithAI(topOpportunities, tradingStyle);
  
  return enhancedOpportunities.slice(0, 6).map(({ score, ...opp }) => opp);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return authError;
    }
    
    const rateLimit = checkRateLimit(user.id);
    if (!rateLimit.allowed) {
      console.log(`Rate limit exceeded for user ${user.id}`);
      return new Response(
        JSON.stringify({ 
          error: "Rate limit exceeded. Please wait before making more requests.",
          retryAfter: Math.ceil(rateLimit.resetIn / 1000)
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetIn / 1000))
          } 
        }
      );
    }
    
    console.log(`Authenticated request from user: ${user.id} (${rateLimit.remaining} requests remaining)`);
    
    const body = await req.json();
    const { mode, ticker, targetDate, targetPrice, tradingStyle } = body;
    
    // Handle guide mode
    if (mode === "guide") {
      console.log(`Processing guide mode for ${tradingStyle || "swing"} trading style`);
      const opportunities = await generateGuideOpportunities(tradingStyle || "swing");
      
      return new Response(
        JSON.stringify({ opportunities }),
        { 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": String(rateLimit.remaining)
          } 
        }
      );
    }
    
    // Validate ticker for all modes
    const TICKER_REGEX = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;
    
    if (!ticker || !TICKER_REGEX.test(ticker.toUpperCase())) {
      return new Response(
        JSON.stringify({ error: "Invalid ticker format. Use AAPL for stocks or BTC-USD for crypto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Fetch stock data
    console.log(`Fetching data for ${ticker.toUpperCase()}...`);
    const stockData = await fetchStockData(ticker.toUpperCase());
    
    if (!stockData.close || stockData.close.length < 60) {
      throw new Error("Insufficient historical data for analysis");
    }
    
    // Calculate all enhanced indicators
    const indicators = calculateAllIndicators(stockData);
    const closePrices = stockData.close.filter((p: number) => p != null);
    const currentPrice = closePrices[closePrices.length - 1];
    
    // Get enhanced regime detection
    const regimeInfo = detectRegimeEnhanced(
      closePrices,
      indicators.rsi,
      indicators.volatility,
      indicators.adx,
      indicators.bollingerBands
    );
    
    // Fetch enhanced news sentiment
    const sentiment = await fetchNewsSentiment(ticker);
    
    // NEW: Calculate signal consensus
    const consensus = calculateSignalConsensus(indicators, currentPrice);
    console.log(`Signal Consensus: ${consensus.consensusScore.toFixed(1)} (${consensus.alignment})`);
    
    // NEW: Detect divergences
    const rsiDivergence = detectRSIDivergence(closePrices, indicators.rsi, 30);
    const macdDivergence = detectMACDDivergence(closePrices, indicators.macd.histogram, 30);
    console.log(`RSI Divergence: ${rsiDivergence.type}, MACD Divergence: ${macdDivergence.type}`);
    
    // NEW: Fetch weekly data for multi-timeframe analysis
    const weeklyData = await fetchWeeklyData(ticker.toUpperCase());
    const weeklyAlignment = getWeeklyTrendAlignment(weeklyData, consensus);
    console.log(`Weekly Alignment: ${weeklyAlignment.aligned ? 'CONFIRMED' : 'CONFLICTING'} (${weeklyAlignment.weeklyTrend})`);
    
    // NEW: Calculate pivot points
    const prevHigh = stockData.high[stockData.high.length - 2] || currentPrice;
    const prevLow = stockData.low[stockData.low.length - 2] || currentPrice;
    const prevClose = closePrices[closePrices.length - 2] || currentPrice;
    const pivotPoints = calculatePivotPoints(prevHigh, prevLow, prevClose);
    
    // Handle price-target mode
    if (mode === "price-target") {
      if (!targetPrice || typeof targetPrice !== "number" || targetPrice <= 0) {
        return new Response(
          JSON.stringify({ error: "Invalid target price. Must be a positive number." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log(`Processing ultra-enhanced price target prediction for ${ticker.toUpperCase()} targeting $${targetPrice}`);
      
      const aiPrediction = await generatePriceTargetPrediction(
        ticker.toUpperCase(),
        targetPrice,
        stockData,
        indicators,
        regimeInfo,
        sentiment,
        consensus,
        rsiDivergence,
        weeklyAlignment
      );
      
      const direction = targetPrice > currentPrice ? "up" : "down";
      const priceChangePercent = ((targetPrice - currentPrice) / currentPrice) * 100;
      
      const historicalData = stockData.timestamps.slice(-60).map((date: string, i: number) => ({
        date,
        price: parseFloat(stockData.close.slice(-60)[i]?.toFixed(2) || "0"),
      }));
      
      const estimatedDateObj = new Date(aiPrediction.estimatedDate);
      const today = new Date();
      const daysToTarget = Math.ceil((estimatedDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      const result = {
        mode: "price-target",
        ticker: ticker.toUpperCase(),
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        targetPrice: parseFloat(targetPrice.toFixed(2)),
        direction,
        priceChangePercent: parseFloat(priceChangePercent.toFixed(2)),
        daysToTarget: Math.max(0, daysToTarget),
        estimatedDate: aiPrediction.estimatedDate,
        estimatedDateRangeLow: aiPrediction.estimatedDateRangeLow,
        estimatedDateRangeHigh: aiPrediction.estimatedDateRangeHigh,
        probability: aiPrediction.probability,
        isRealistic: aiPrediction.isRealistic,
        reasoning: aiPrediction.reasoning,
        keyFactors: aiPrediction.keyFactors || [],
        regime: regimeInfo.regime,
        regimeDescription: regimeInfo.description,
        sentimentScore: sentiment.score,
        sentimentConfidence: sentiment.confidence,
        historicalData,
        currency: stockData.currency || "USD",
        // NEW: Enhanced analysis data
        consensusScore: consensus.consensusScore,
        consensusAlignment: consensus.alignment,
        signalDetails: consensus.signalDetails,
        rsiDivergence: rsiDivergence.hasDivergence ? rsiDivergence.type : null,
        weeklyTrend: weeklyAlignment.weeklyTrend,
        weeklyAligned: weeklyAlignment.aligned,
      };
      
      console.log("Ultra-enhanced price target prediction complete:", result.ticker, `$${result.targetPrice}`, result.estimatedDate);
      
      return new Response(JSON.stringify(result), {
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rateLimit.remaining)
        },
      });
    }
    
    // Regular prediction mode - validate date
    const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

    if (!targetDate || !DATE_REGEX.test(targetDate)) {
      return new Response(
        JSON.stringify({ error: "Invalid date format. Must be YYYY-MM-DD." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate days to target for mathematical confidence
    const targetDateObj = new Date(targetDate);
    const today = new Date();
    const daysToTarget = Math.ceil((targetDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // NEW: Calculate mathematical confidence
    const mathConfidence = calculateMathematicalConfidence(
      consensus,
      rsiDivergence,
      macdDivergence,
      regimeInfo,
      sentiment,
      daysToTarget,
      weeklyAlignment.aligned
    );
    console.log(`Mathematical Confidence: ${mathConfidence}%`);

    // NEW: Calculate dynamic uncertainty
    const dynamicUncertainty = calculateDynamicUncertainty(
      indicators.atr,
      currentPrice,
      regimeInfo,
      daysToTarget,
      indicators.volatility,
      ticker.toUpperCase()
    );
    console.log(`Dynamic Uncertainty: ${dynamicUncertainty.toFixed(1)}%`);

    console.log(`Processing ultra-enhanced prediction for ${ticker.toUpperCase()} targeting ${targetDate}`);
    
    // Get enhanced AI prediction with all new signals
    const aiPrediction = await generateAIPrediction(
      ticker.toUpperCase(),
      targetDate,
      stockData,
      indicators,
      regimeInfo,
      sentiment,
      consensus,
      rsiDivergence,
      macdDivergence,
      mathConfidence,
      dynamicUncertainty,
      weeklyAlignment,
      pivotPoints
    );
    
    const predictedPrice = aiPrediction.predictedPrice;
    const uncertaintyPercent = aiPrediction.uncertaintyPercent / 100;
    
    const historicalData = stockData.timestamps.slice(-60).map((date: string, i: number) => ({
      date,
      price: parseFloat(stockData.close.slice(-60)[i]?.toFixed(2) || "0"),
    }));
    
    // Normalize feature importance
    const totalImportance = aiPrediction.featureImportance.reduce(
      (sum: number, f: any) => sum + f.importance, 0
    );
    const featureImportance = aiPrediction.featureImportance.map((f: any) => ({
      name: f.name,
      importance: f.importance / totalImportance,
    }));
    
    const result = {
      ticker: ticker.toUpperCase(),
      targetDate,
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      predictedPrice: parseFloat(predictedPrice.toFixed(2)),
      uncertaintyLow: parseFloat((predictedPrice * (1 - uncertaintyPercent)).toFixed(2)),
      uncertaintyHigh: parseFloat((predictedPrice * (1 + uncertaintyPercent)).toFixed(2)),
      confidence: aiPrediction.confidence,
      regime: regimeInfo.regime,
      regimeDescription: regimeInfo.description,
      regimeStrength: regimeInfo.strength,
      sentimentScore: sentiment.score,
      sentimentConfidence: sentiment.confidence,
      featureImportance,
      historicalData,
      reasoning: aiPrediction.reasoning,
      currency: stockData.currency || "USD",
      // Enhanced data
      supportLevels: indicators.supportResistance.support,
      resistanceLevels: indicators.supportResistance.resistance,
      fibonacciTrend: indicators.fibonacci.trend,
      obvTrend: indicators.obvTrend,
      // NEW: Ultra-enhanced analysis data
      consensusScore: consensus.consensusScore,
      consensusAlignment: consensus.alignment,
      signalDetails: consensus.signalDetails,
      rsiDivergence: rsiDivergence.hasDivergence ? { type: rsiDivergence.type, strength: rsiDivergence.strength, description: rsiDivergence.description } : null,
      macdDivergence: macdDivergence.hasDivergence ? { type: macdDivergence.type, strength: macdDivergence.strength } : null,
      mathConfidence,
      dynamicUncertainty,
      weeklyTrend: weeklyAlignment.weeklyTrend,
      weeklyAligned: weeklyAlignment.aligned,
      weeklyDescription: weeklyAlignment.description,
      pivotPoints,
      vwap: indicators.vwap[indicators.vwap.length - 1],
    };

    console.log("Ultra-enhanced prediction complete:", result.ticker, result.predictedPrice, `Confidence: ${result.confidence}%`);
    
    return new Response(JSON.stringify(result), {
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": String(rateLimit.remaining)
      },
    });
  } catch (error) {
    console.error("Error in stock-predict:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Prediction failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
