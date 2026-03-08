import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================================
// TECHNICAL INDICATOR FUNCTIONS (replicated from backtest engine)
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
    if (!isNaN(macd[i])) { validIndices.push(i); validMacd.push(macd[i]); }
  }
  const signalRaw = calculateEMA(validMacd, 9);
  const paddedSignal: number[] = new Array(macd.length).fill(NaN);
  for (let i = 0; i < signalRaw.length; i++) { paddedSignal[validIndices[i]] = signalRaw[i]; }
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
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  for (let i = 1; i < period; i++) atr[i] = NaN;
  if (tr.length >= period) {
    atr[period - 1] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < tr.length; i++) {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }
  return atr;
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

function safeGet(arr: number[], defaultVal: number): number {
  if (!arr || arr.length === 0) return defaultVal;
  const v = arr[arr.length - 1];
  return (v == null || isNaN(v)) ? defaultVal : v;
}

// ============================================================================
// WEEKLY BAR AGGREGATION
// ============================================================================

type DataSet = { timestamps: string[]; close: number[]; high: number[]; low: number[]; open: number[]; volume: number[] };

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
  targetAllocation: number;
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

// ============================================================================
// STOCK CLASSIFICATION (simplified for scanner)
// ============================================================================

type StockProfile = "momentum" | "value" | "index" | "volatile";

const INDEX_TICKERS = new Set(["SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "IVV", "RSP"]);

function classifyStockSimple(close: number[], high: number[], low: number[], ticker: string): StockProfile {
  if (INDEX_TICKERS.has(ticker.toUpperCase())) return "index";
  
  const n = close.length;
  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push((close[i] - close[i - 1]) / close[i - 1]);
  const retMean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const avgVolatility = Math.sqrt(returns.reduce((a, b) => a + (b - retMean) ** 2, 0) / returns.length);

  const atr = calculateATR(high, low, close, 14);
  let atrPctSum = 0, atrPctCount = 0;
  for (let i = 14; i < n; i++) {
    if (!isNaN(atr[i]) && close[i] > 0) { atrPctSum += atr[i] / close[i]; atrPctCount++; }
  }
  const atrPctAvg = atrPctCount > 0 ? atrPctSum / atrPctCount : 0.02;

  // Trend score via MA alignment
  const sma50 = calculateSMA(close, 50);
  const sma200 = calculateSMA(close, 200);
  let maAlignedCount = 0, maValidCount = 0;
  for (let i = 199; i < n; i++) {
    if (!isNaN(sma50[i]) && !isNaN(sma200[i])) {
      maValidCount++;
      if (close[i] > sma50[i] && sma50[i] > sma200[i]) maAlignedCount++;
    }
  }
  const trendScore = maValidCount > 0 ? maAlignedCount / maValidCount : 0;

  if (atrPctAvg > 0.025 && trendScore < 0.4) return "volatile";
  if (trendScore > 0.6) return "momentum";
  return "index";
}

const PROFILE_WEEKLY_PARAMS: Record<StockProfile, { fastMA: number; slowMA: number; rsiLong: number }> = {
  momentum: { fastMA: 10, slowMA: 40, rsiLong: 45 },
  value: { fastMA: 13, slowMA: 50, rsiLong: 35 },
  index: { fastMA: 10, slowMA: 40, rsiLong: 40 },
  volatile: { fastMA: 8, slowMA: 30, rsiLong: 50 },
};

// ============================================================================
// SIGNAL STRENGTH / CONVICTION COMPUTATION
// ============================================================================

function computeSignalConviction(
  close: number[], high: number[], low: number[], volume: number[],
): { conviction: number; regime: string; strategy: string; reasoning: string } {
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

  const rsiVal = safeGet(rsi, 50);
  const adxVal = safeGet(adxData.adx, 0);
  const pdi = safeGet(adxData.plusDI, 0);
  const mdi = safeGet(adxData.minusDI, 0);
  const e12 = safeGet(ema12, currentPrice);
  const e26 = safeGet(ema26, currentPrice);
  const s50 = safeGet(sma50, currentPrice);
  const s200 = safeGet(sma200, currentPrice);
  const macdH = safeGet(macdData.histogram, 0);
  const sk = safeGet(stochK, 50);

  let regime = "neutral";
  if (adxVal > 40 && pdi > mdi && rsiVal > 60) regime = "strong_bullish";
  else if (adxVal > 40 && mdi > pdi && rsiVal < 40) regime = "strong_bearish";
  else if (adxVal > 25 && pdi > mdi) regime = "bullish";
  else if (adxVal > 25 && mdi > pdi) regime = "bearish";
  else if (rsiVal > 70) regime = "overbought";
  else if (rsiVal < 30) regime = "oversold";

  // Trend conviction
  let conviction = 0;
  let strategy = "none";
  const reasons: string[] = [];

  if (adxVal > 20) {
    const trendBuy = [e12 > e26, currentPrice > s50, macdH > 0, rsiVal >= 35 && rsiVal <= 75];
    const trendScore = trendBuy.filter(Boolean).length;
    if (trendScore >= 3 && currentPrice > s200) {
      conviction = trendScore * 15 + Math.min((adxVal - 20) * 0.5, 10) + Math.min(Math.abs(macdH) * 5, 8);
      strategy = "trend";
      reasons.push(`Trend: ${trendScore}/4 conditions met`);
      if (e12 > e26) reasons.push("EMA12 > EMA26");
      if (currentPrice > s50) reasons.push("Price > SMA50");
      if (macdH > 0) reasons.push("MACD positive");
    }
  }

  // Mean reversion
  if (conviction < 50 && (rsiVal < 30 || currentPrice < safeGet(bb.lower, currentPrice * 0.9))) {
    const mrScore = [rsiVal < 30, currentPrice < safeGet(bb.lower, currentPrice * 0.9), sk < 20].filter(Boolean).length;
    if (mrScore >= 2) {
      conviction = Math.max(conviction, mrScore * 16 + Math.min(Math.abs(rsiVal - 50) * 0.3, 10));
      strategy = "mean_reversion";
      reasons.push(`Mean Reversion: RSI=${rsiVal.toFixed(0)}, oversold bounce setup`);
    }
  }

  // Breakout
  const bbBW = safeGet(bb.bandwidth, 0.1);
  const bwSlice = bb.bandwidth.filter(v => !isNaN(v));
  const bwAvg = bwSlice.length >= 50 ? bwSlice.slice(-50).reduce((a, b) => a + b, 0) / 50 : 0.1;
  if (conviction < 50 && bbBW < bwAvg * 0.7 && currentPrice > safeGet(bb.upper, currentPrice)) {
    conviction = Math.max(conviction, 55);
    strategy = "breakout";
    reasons.push("Bollinger squeeze breakout");
  }

  return {
    conviction: Math.min(100, Math.round(conviction)),
    regime,
    strategy,
    reasoning: reasons.join(". ") || "No clear signal",
  };
}

// ============================================================================
// YAHOO FINANCE DATA FETCHER
// ============================================================================

async function fetchYahooData(ticker: string, range: string = "1y"): Promise<DataSet | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=1d`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.chart?.error) return null;
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
// SCANNING UNIVERSE — 75 tickers across all 11 GICS sectors
// ============================================================================

const SCAN_UNIVERSE: Record<string, string[]> = {
  "Technology": ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AVGO", "CRM", "AMD", "ADBE", "ORCL"],
  "Healthcare": ["UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT"],
  "Financials": ["JPM", "V", "MA", "BAC", "GS", "MS", "BLK", "AXP"],
  "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "TJX"],
  "Communication Services": ["NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS"],
  "Industrials": ["CAT", "HON", "UPS", "BA", "GE", "RTX", "DE"],
  "Consumer Staples": ["PG", "KO", "PEP", "COST", "WMT", "PM"],
  "Energy": ["XOM", "CVX", "COP", "SLB", "EOG"],
  "Utilities": ["NEE", "DUK", "SO", "AEP"],
  "Real Estate": ["PLD", "AMT", "CCI", "SPG"],
  "Materials": ["LIN", "APD", "SHW", "FCX"],
};

const ALL_TICKERS = Object.values(SCAN_UNIVERSE).flat();

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const startTime = Date.now();
    const body = await req.json().catch(() => ({}));
    const { batch = 0, batchSize = 25, checkSells = false, userId = null } = body;

    // Determine which tickers to scan in this batch
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, ALL_TICKERS.length);
    const tickersToScan = ALL_TICKERS.slice(start, end);

    if (tickersToScan.length === 0) {
      return new Response(JSON.stringify({ 
        signals: [], 
        batch, 
        totalBatches: Math.ceil(ALL_TICKERS.length / batchSize),
        done: true 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Scanning batch ${batch}: ${tickersToScan.join(", ")}`);

    // Fetch SPY for regime context
    const spyData = await fetchYahooData("SPY", "1y");
    let spyBearish = false;
    if (spyData && spyData.close.length >= 200) {
      const spySMA200 = calculateSMA(spyData.close, 200);
      const lastSMA200 = safeGet(spySMA200, 0);
      spyBearish = spyData.close[spyData.close.length - 1] < lastSMA200;
    }

    // Fetch all tickers in parallel (batched to avoid rate limits)
    const FETCH_BATCH = 5;
    const allData: (DataSet | null)[] = [];
    for (let i = 0; i < tickersToScan.length; i += FETCH_BATCH) {
      const batch = tickersToScan.slice(i, i + FETCH_BATCH);
      const results = await Promise.all(batch.map(t => fetchYahooData(t, "1y")));
      allData.push(...results);
      if (i + FETCH_BATCH < tickersToScan.length) {
        await new Promise(r => setTimeout(r, 200)); // small delay between batches
      }
    }

    const signals: {
      ticker: string;
      signal_type: "BUY" | "SELL";
      entry_price: number;
      confidence: number;
      regime: string;
      stock_profile: string;
      weekly_bias: string;
      target_allocation: number;
      reasoning: string;
      strategy: string;
      sector: string;
    }[] = [];

    for (let ti = 0; ti < tickersToScan.length; ti++) {
      const ticker = tickersToScan[ti];
      const data = allData[ti];
      if (!data || data.close.length < 200) continue;

      try {
        // 1. Classify stock
        const profile = classifyStockSimple(data.close, data.high, data.low, ticker);
        const weeklyParams = PROFILE_WEEKLY_PARAMS[profile];

        // 2. Build weekly data
        const weeklyData = aggregateToWeekly(data);
        const wIdx = weeklyData.close.length - 1;

        // 3. Compute weekly bias
        const weeklyATR = calculateATR(weeklyData.high, weeklyData.low, weeklyData.close, 14);
        let isLowVol = false;
        {
          let wAtrPctSum = 0, wAtrPctCount = 0;
          for (let wi = 14; wi < weeklyData.close.length; wi++) {
            if (!isNaN(weeklyATR[wi]) && weeklyData.close[wi] > 0) {
              wAtrPctSum += weeklyATR[wi] / weeklyData.close[wi]; wAtrPctCount++;
            }
          }
          isLowVol = wAtrPctCount > 0 && (wAtrPctSum / wAtrPctCount) < 0.02;
        }

        if (wIdx < Math.max(weeklyParams.slowMA, 40) + 10) continue;

        const weeklyBias = computeWeeklyBias(
          weeklyData.close, weeklyData.high, weeklyData.low, wIdx,
          weeklyParams, isLowVol,
        );

        if (weeklyBias.bias === "flat") continue;

        // SPY filter: don't short when SPY is bullish
        if (weeklyBias.bias === "short" && !spyBearish) continue;

        // 4. Check daily entry signal
        const lastIdx = data.close.length - 1;
        const hasEntry = hasDailyEntrySignal(data.close, data.high, data.low, data.volume, lastIdx, weeklyBias.bias);
        if (!hasEntry) continue;

        // 5. Compute conviction
        const { conviction, regime, strategy, reasoning } = computeSignalConviction(
          data.close, data.high, data.low, data.volume,
        );

        if (conviction < 55) continue; // Only high-quality signals

        // Find sector
        let sector = "Unknown";
        for (const [s, tickers] of Object.entries(SCAN_UNIVERSE)) {
          if (tickers.includes(ticker)) { sector = s; break; }
        }

        signals.push({
          ticker,
          signal_type: weeklyBias.bias === "long" ? "BUY" : "SELL",
          entry_price: data.close[lastIdx],
          confidence: conviction,
          regime,
          stock_profile: profile,
          weekly_bias: weeklyBias.bias,
          target_allocation: Math.abs(weeklyBias.targetAllocation),
          reasoning,
          strategy,
          sector,
        });
      } catch (err) {
        console.error(`Error analyzing ${ticker}:`, err);
      }
    }

    // Sort by confidence descending
    signals.sort((a, b) => b.confidence - a.confidence);

    // Write signals to DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (signals.length > 0) {
      // Clear old signals from this batch's tickers
      const tickerList = tickersToScan;
      await supabase.from("live_signals").delete().in("ticker", tickerList);

      // Insert new signals with 24h expiry
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const rows = signals.map(s => ({
        ticker: s.ticker,
        signal_type: s.signal_type,
        entry_price: s.entry_price,
        confidence: s.confidence,
        regime: s.regime,
        stock_profile: s.stock_profile,
        weekly_bias: s.weekly_bias,
        target_allocation: s.target_allocation,
        reasoning: s.reasoning,
        strategy: s.strategy,
        expires_at: expiresAt,
      }));

      const { error } = await supabase.from("live_signals").insert(rows);
      if (error) console.error("Failed to insert signals:", error);
    }

    // Check sell signals for user positions if requested
    let sellSignals: { ticker: string; reason: string; currentPrice: number }[] = [];
    if (checkSells && userId) {
      const { data: openPositions } = await supabase
        .from("virtual_positions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "open");

      if (openPositions && openPositions.length > 0) {
        let totalPositionsValue = 0;

        for (const pos of openPositions) {
          // Try to get data from current batch, otherwise fetch individually
          let posData = allData[tickersToScan.indexOf(pos.ticker)];
          if (!posData) {
            posData = await fetchYahooData(pos.ticker, "1y");
          }
          if (!posData) continue;

          const currentPrice = posData.close[posData.close.length - 1];
          totalPositionsValue += currentPrice * Number(pos.shares);

          const pnlPct = pos.position_type === "long"
            ? ((currentPrice - Number(pos.entry_price)) / Number(pos.entry_price)) * 100
            : ((Number(pos.entry_price) - currentPrice) / Number(pos.entry_price)) * 100;

          // Hard stop: -8%
          if (pnlPct < -8) {
            sellSignals.push({ ticker: pos.ticker, reason: `Hard stop triggered (${pnlPct.toFixed(1)}% loss)`, currentPrice });
          }
          // Take profit: +15%
          else if (pnlPct > 15) {
            sellSignals.push({ ticker: pos.ticker, reason: `Take profit target reached (+${pnlPct.toFixed(1)}%)`, currentPrice });
          }
          // Weekly reversal check
          else if (posData.close.length >= 200) {
            const profile = classifyStockSimple(posData.close, posData.high, posData.low, pos.ticker);
            const weeklyData = aggregateToWeekly(posData);
            const wIdx = weeklyData.close.length - 1;
            const weeklyParams = PROFILE_WEEKLY_PARAMS[profile];
            const weeklyBias = computeWeeklyBias(weeklyData.close, weeklyData.high, weeklyData.low, wIdx, weeklyParams);

            if ((pos.position_type === "long" && weeklyBias.bias !== "long") ||
                (pos.position_type === "short" && weeklyBias.bias !== "short")) {
              sellSignals.push({ ticker: pos.ticker, reason: `Weekly trend reversed to ${weeklyBias.bias}`, currentPrice });
            }
          }
        }

        // Log portfolio snapshot
        const STARTING_CASH = 100000;
        const totalInvested = openPositions.reduce((sum, p) => sum + Number(p.entry_price) * Number(p.shares), 0);
        const cash = STARTING_CASH - totalInvested;
        const totalValue = cash + totalPositionsValue;
        const today = new Date().toISOString().split("T")[0];

        const { error: logError } = await supabase.from("virtual_portfolio_log").upsert(
          {
            user_id: userId,
            date: today,
            total_value: totalValue,
            cash,
            positions_value: totalPositionsValue,
          },
          { onConflict: "user_id,date", ignoreDuplicates: false }
        );
        if (logError) console.error("Portfolio log error:", logError);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`Scan complete: ${signals.length} signals from ${tickersToScan.length} tickers in ${elapsed}ms`);

    return new Response(JSON.stringify({
      signals,
      sellSignals,
      batch,
      totalBatches: Math.ceil(ALL_TICKERS.length / batchSize),
      done: end >= ALL_TICKERS.length,
      scanned: tickersToScan.length,
      elapsed,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Scanner error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Scanner failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
