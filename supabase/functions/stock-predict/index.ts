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
// ENHANCED TECHNICAL INDICATORS
// ============================================================================

function calculateEMA(prices: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  ema[0] = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
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

// NEW: Bollinger Bands
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

// NEW: Average True Range (ATR)
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

// NEW: Stochastic Oscillator
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

  // Calculate %D (SMA of %K)
  const validK = k.filter(v => !isNaN(v));
  const d = calculateSMA(validK, dPeriod);
  
  // Pad d to match k length
  const paddedD: number[] = new Array(k.length - validK.length).fill(NaN).concat(d);

  return { k, d: paddedD };
}

// NEW: Average Directional Index (ADX)
function calculateADX(high: number[], low: number[], close: number[], period: number = 14): { adx: number[]; plusDI: number[]; minusDI: number[] } {
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

  const adx = calculateEMA(dx.filter(v => !isNaN(v)), period);

  // Pad arrays to match original length
  const padLength = close.length - adx.length;
  const paddedADX = new Array(padLength).fill(NaN).concat(adx);
  const paddedPlusDI = [NaN].concat(plusDI);
  const paddedMinusDI = [NaN].concat(minusDI);

  return { adx: paddedADX, plusDI: paddedPlusDI, minusDI: paddedMinusDI };
}

// NEW: On Balance Volume (OBV)
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

// NEW: OBV Trend (rising, falling, neutral)
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

// NEW: Support & Resistance Detection
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

// NEW: Fibonacci Retracement Levels
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

// ENHANCED: Regime Detection with ADX
function detectRegimeEnhanced(
  prices: number[],
  rsi: number[],
  volatility: number[],
  adx: { adx: number[]; plusDI: number[]; minusDI: number[] },
  bollingerBands: { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[] }
): { regime: string; strength: number; description: string } {
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
      return { regime: "strong_bullish", strength: latestADX, description: "Strong uptrend confirmed by ADX > 25 with +DI dominance" };
    } else {
      return { regime: "strong_bearish", strength: latestADX, description: "Strong downtrend confirmed by ADX > 25 with -DI dominance" };
    }
  }

  // Volatility breakout
  if (latestVol > avgVol * 1.5 || bbBandwidth > 0.1) {
    return { regime: "volatile", strength: latestVol / avgVol, description: "High volatility regime - Bollinger Bands expanding" };
  }

  // Bollinger Band extremes
  if (currentPrice > bbUpper && latestRSI > 70) {
    return { regime: "overbought", strength: latestRSI, description: "Price above upper Bollinger Band with RSI > 70" };
  }
  if (currentPrice < bbLower && latestRSI < 30) {
    return { regime: "oversold", strength: 100 - latestRSI, description: "Price below lower Bollinger Band with RSI < 30" };
  }

  // Weak trend / ranging
  if (latestADX < 20) {
    return { regime: "ranging", strength: 20 - latestADX, description: "No clear trend, ADX < 20 indicates ranging/consolidation" };
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
      for (const word of positiveWords) {
        if (text.includes(word)) score += 0.08;
      }
      for (const word of negativeWords) {
        if (text.includes(word)) score -= 0.08;
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

// ENHANCED: AI Prediction with All New Indicators
async function generateAIPrediction(
  ticker: string,
  targetDate: string,
  stockData: any,
  indicators: any,
  regimeInfo: { regime: string; strength: number; description: string },
  sentiment: { score: number; articleCount: number; confidence: number }
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
    // New indicators
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
  
  const prompt = `You are an expert quantitative analyst with access to comprehensive technical indicators. Analyze this ${ticker.includes('-') ? 'cryptocurrency' : 'stock'} data and provide a prediction.

ASSET: ${ticker}
TARGET DATE: ${targetDate}
CURRENT PRICE: $${safeToFixed(recentData.currentPrice)}

MARKET REGIME: ${regimeInfo.regime.toUpperCase()}
Regime Strength: ${safeToFixed(regimeInfo.strength, 1)}
Regime Description: ${regimeInfo.description}

NEWS SENTIMENT: ${safeToFixed(sentiment.score)} (scale -1 to 1)
Articles Analyzed: ${sentiment.articleCount}
Sentiment Confidence: ${safeToFixed(sentiment.confidence * 100)}%

SUPPORT & RESISTANCE LEVELS:
- Support: ${indicators.supportResistance.support.map((s: number) => `$${safeToFixed(s)}`).join(', ') || 'None detected'}
- Resistance: ${indicators.supportResistance.resistance.map((r: number) => `$${safeToFixed(r)}`).join(', ') || 'None detected'}

FIBONACCI LEVELS (${indicators.fibonacci.trend}):
${indicators.fibonacci.levels.map((l: { ratio: number; price: number }) => `- ${(l.ratio * 100).toFixed(1)}%: $${safeToFixed(l.price)}`).join('\n')}

RECENT PRICE DATA (last 30 days):
${recentData.dates.map((d: string, i: number) => `${d}: $${safeToFixed(recentData.prices[i])}`).join('\n')}

CLASSIC INDICATORS (last 5 values):
- EMA12: ${recentData.ema12.map((v: number) => safeToFixed(v)).join(', ')}
- EMA26: ${recentData.ema26.map((v: number) => safeToFixed(v)).join(', ')}
- SMA50: ${recentData.sma50.map((v: number) => safeToFixed(v)).join(', ')}
- RSI14: ${recentData.rsi.map((v: number) => safeToFixed(v, 1)).join(', ')}
- MACD: ${recentData.macd.map((v: number) => safeToFixed(v, 3)).join(', ')}
- MACD Signal: ${recentData.macdSignal.map((v: number) => safeToFixed(v, 3)).join(', ')}
- Volatility: ${recentData.volatility.map((v: number) => v != null ? safeToFixed(v * 100) + '%' : 'N/A').join(', ')}

ADVANCED INDICATORS (last 5 values):
- Stochastic %K: ${recentData.stochK.map((v: number) => safeToFixed(v, 1)).join(', ')}
- Stochastic %D: ${recentData.stochD.map((v: number) => safeToFixed(v, 1)).join(', ')}
- ADX (trend strength): ${recentData.adx.map((v: number) => safeToFixed(v, 1)).join(', ')}
- +DI: ${recentData.plusDI.map((v: number) => safeToFixed(v, 1)).join(', ')}
- -DI: ${recentData.minusDI.map((v: number) => safeToFixed(v, 1)).join(', ')}
- ATR: ${recentData.atr.map((v: number) => safeToFixed(v, 2)).join(', ')}
- Bollinger Upper: ${recentData.bbUpper.map((v: number) => safeToFixed(v)).join(', ')}
- Bollinger Lower: ${recentData.bbLower.map((v: number) => safeToFixed(v)).join(', ')}
- BB Bandwidth: ${recentData.bbBandwidth.map((v: number) => safeToFixed(v * 100, 1) + '%').join(', ')}

VOLUME ANALYSIS:
- OBV Trend: ${indicators.obvTrend}

Based on ALL technical indicators, market regime, support/resistance levels, and sentiment, provide your prediction. You MUST respond with ONLY valid JSON in this exact format:
{
  "predictedPrice": <number>,
  "uncertaintyPercent": <number between 2 and 15>,
  "confidence": <number between 40 and 95>,
  "reasoning": "<brief 2-3 sentence explanation including key indicators>",
  "featureImportance": [
    {"name": "EMA Crossover", "importance": <0-1>},
    {"name": "RSI Signal", "importance": <0-1>},
    {"name": "MACD Trend", "importance": <0-1>},
    {"name": "Stochastic", "importance": <0-1>},
    {"name": "ADX Trend Strength", "importance": <0-1>},
    {"name": "Bollinger Bands", "importance": <0-1>},
    {"name": "Support/Resistance", "importance": <0-1>},
    {"name": "Volume (OBV)", "importance": <0-1>},
    {"name": "Market Regime", "importance": <0-1>},
    {"name": "News Sentiment", "importance": <0-1>}
  ]
}`;

  console.log("Calling Lovable AI for enhanced prediction...");
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a quantitative financial analyst with expertise in technical analysis. Respond only with valid JSON." },
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

// ENHANCED: Price Target Prediction with All Indicators
async function generatePriceTargetPrediction(
  ticker: string,
  targetPrice: number,
  stockData: any,
  indicators: any,
  regimeInfo: { regime: string; strength: number; description: string },
  sentiment: { score: number; articleCount: number; confidence: number }
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
  
  const recentData = {
    prices: stockData.close.slice(-30),
    dates: stockData.timestamps.slice(-30),
    currentPrice: currentPrice,
    rsi: indicators.rsi.slice(-5),
    volatility: indicators.volatility.slice(-5),
    stochK: indicators.stochastic.k.slice(-5),
    adx: indicators.adx.adx.slice(-5),
    atr: indicators.atr.slice(-5),
  };
  
  const prompt = `You are an expert quantitative analyst. Analyze when this ${ticker.includes('-') ? 'cryptocurrency' : 'stock'} might reach the target price.

ASSET: ${ticker}
CURRENT PRICE: $${safeToFixed(currentPrice)}
TARGET PRICE: $${safeToFixed(targetPrice)}
REQUIRED CHANGE: ${priceChange > 0 ? '+' : ''}${safeToFixed(priceChange)}% (${direction})

MARKET REGIME: ${regimeInfo.regime.toUpperCase()}
Regime Description: ${regimeInfo.description}

NEWS SENTIMENT: ${safeToFixed(sentiment.score)} (scale -1 to 1, ${sentiment.articleCount} articles)

SUPPORT & RESISTANCE LEVELS:
- Support: ${indicators.supportResistance.support.map((s: number) => `$${safeToFixed(s)}`).join(', ') || 'None'}
- Resistance: ${indicators.supportResistance.resistance.map((r: number) => `$${safeToFixed(r)}`).join(', ') || 'None'}

HISTORICAL PERFORMANCE:
- 30-Day Change: ${safeToFixed(change30d)}%
- 90-Day Change: ${safeToFixed(change90d)}%
- 180-Day Change: ${safeToFixed(change180d)}%
- Average Daily Return: ${safeToFixed(avgDailyReturn * 100, 3)}%
- Average Daily Volatility: ${safeToFixed(avgAbsDailyReturn * 100, 3)}%

RECENT PRICES (last 30 days):
${recentData.dates.map((d: string, i: number) => `${d}: $${safeToFixed(recentData.prices[i])}`).join('\n')}

TECHNICAL INDICATORS (last 5 values):
- RSI14: ${recentData.rsi.map((v: number) => safeToFixed(v, 1)).join(', ')}
- Stochastic %K: ${recentData.stochK.map((v: number) => safeToFixed(v, 1)).join(', ')}
- ADX: ${recentData.adx.map((v: number) => safeToFixed(v, 1)).join(', ')}
- ATR: ${recentData.atr.map((v: number) => safeToFixed(v, 2)).join(', ')}
- Volatility: ${recentData.volatility.map((v: number) => v != null ? safeToFixed(v * 100) + '%' : 'N/A').join(', ')}
- OBV Trend: ${indicators.obvTrend}

Analyze the likelihood and timeframe for reaching the target price of $${safeToFixed(targetPrice)}. Consider:
1. Is this target realistic based on historical movement patterns and support/resistance?
2. How long might it take based on average daily/monthly returns and current trend strength (ADX)?
3. What's the probability of reaching this target given current market regime?

You MUST respond with ONLY valid JSON in this exact format:
{
  "estimatedDate": "<YYYY-MM-DD most likely date>",
  "estimatedDateRangeLow": "<YYYY-MM-DD best case / earliest>",
  "estimatedDateRangeHigh": "<YYYY-MM-DD worst case / latest>",
  "probability": <0-100 percentage chance of hitting target>,
  "isRealistic": <true or false>,
  "reasoning": "<2-3 sentence explanation of the analysis and timeline>",
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
        { role: "system", content: "You are a quantitative financial analyst specializing in price target analysis. Respond only with valid JSON." },
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
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    console.error("Failed to parse AI response:", content);
    throw new Error("Failed to parse AI price target prediction");
  }
}

// Calculate all enhanced indicators
function calculateAllIndicators(stockData: any) {
  const closePrices = stockData.close.filter((p: number) => p != null);
  const highPrices = stockData.high?.filter((p: number) => p != null) || closePrices;
  const lowPrices = stockData.low?.filter((p: number) => p != null) || closePrices;
  const volumes = stockData.volume?.filter((v: number) => v != null) || new Array(closePrices.length).fill(1000000);

  const ema12 = calculateEMA(closePrices, 12);
  const ema26 = calculateEMA(closePrices, 26);
  const sma50 = calculateSMA(closePrices, 50);
  const rsi = calculateRSI(closePrices, 14);
  const macd = calculateMACD(closePrices);
  const volatility = calculateVolatility(closePrices, 20);
  
  // New indicators
  const bollingerBands = calculateBollingerBands(closePrices, 20, 2);
  const atr = calculateATR(highPrices, lowPrices, closePrices, 14);
  const stochastic = calculateStochastic(closePrices, highPrices, lowPrices, 14, 3);
  const adx = calculateADX(highPrices, lowPrices, closePrices, 14);
  const obv = calculateOBV(closePrices, volumes);
  const obvTrend = getOBVTrend(obv, 20);
  const supportResistance = findSupportResistance(closePrices, 60);
  const fibonacci = calculateFibonacciLevels(closePrices, 60);

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
    preferredRegimes: ["volatile", "bullish", "bearish", "strong_bullish", "strong_bearish"],
    scoreMultiplier: (volatility: number) => volatility > 0.02 ? 1.3 : 1,
    roiMultiplier: 1.2,
  },
  swing: {
    volatilityPreference: "medium",
    holdingPeriod: "Days to weeks",
    minVolatility: 0.01,
    preferredRegimes: ["bullish", "bearish", "strong_bullish", "strong_bearish"],
    scoreMultiplier: (volatility: number) => volatility > 0.01 && volatility < 0.03 ? 1.4 : 1,
    roiMultiplier: 1.5,
  },
  position: {
    volatilityPreference: "low",
    holdingPeriod: "Weeks to months",
    minVolatility: 0,
    preferredRegimes: ["bullish", "neutral", "strong_bullish"],
    scoreMultiplier: (volatility: number) => volatility < 0.02 ? 1.5 : 1,
    roiMultiplier: 2.0,
  },
};

// Style-specific screener configurations
const screenersByStyle: Record<string, string[]> = {
  scalping: [
    "most_actives",
    "day_gainers",
    "day_losers",
    "small_cap_gainers",
  ],
  daytrading: [
    "most_actives",
    "day_gainers",
    "day_losers",
    "growth_technology_stocks",
  ],
  swing: [
    "undervalued_growth_stocks",
    "growth_technology_stocks",
    "day_gainers",
    "day_losers",
  ],
  position: [
    "undervalued_large_caps",
    "undervalued_growth_stocks",
    "most_actives",
  ],
};

async function fetchMarketScreener(tradingStyle: string): Promise<{ ticker: string; percentChange: number; volume: number; marketCap: number }[]> {
  const screenerIds = screenersByStyle[tradingStyle] || screenersByStyle.swing;
  const screenerUrls = screenerIds.map(id => 
    `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${id}&count=30`
  );
  
  const allTickers: Map<string, { ticker: string; percentChange: number; volume: number; marketCap: number }> = new Map();
  
  if (tradingStyle === "scalping" || tradingStyle === "daytrading") {
    const cryptoTickers = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "AVAX-USD"];
    for (const ticker of cryptoTickers) {
      allTickers.set(ticker, { ticker, percentChange: 5, volume: 1000000000, marketCap: 100000000000 });
    }
  }
  
  for (const url of screenerUrls) {
    try {
      console.log(`Fetching screener: ${url}`);
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
    
    const closePrices = stockData.close.filter((p: number) => p != null);
    const highPrices = stockData.high?.filter((p: number) => p != null) || closePrices;
    const lowPrices = stockData.low?.filter((p: number) => p != null) || closePrices;
    const volumes = stockData.volume?.filter((v: number) => v != null) || [];
    const latestVolume = volumes[volumes.length - 1] || volumeData || 0;
    
    // Calculate all indicators including new ones
    const ema12 = calculateEMA(closePrices, 12);
    const ema26 = calculateEMA(closePrices, 26);
    const rsi = calculateRSI(closePrices, 14);
    const macd = calculateMACD(closePrices);
    const volatility = calculateVolatility(closePrices, 20);
    const bollingerBands = calculateBollingerBands(closePrices, 20, 2);
    const adx = calculateADX(highPrices, lowPrices, closePrices, 14);
    const stochastic = calculateStochastic(closePrices, highPrices, lowPrices, 14, 3);
    const obv = calculateOBV(closePrices, volumes);
    const obvTrend = getOBVTrend(obv, 20);
    
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
    
    // === ENHANCED SCORING WITH NEW INDICATORS ===
    const priceChange5d = (closePrices[closePrices.length - 1] - closePrices[closePrices.length - 6]) / closePrices[closePrices.length - 6];
    const priceChange20d = (closePrices[closePrices.length - 1] - closePrices[closePrices.length - 21]) / closePrices[closePrices.length - 21];
    
    let score = 0;
    let direction: "bullish" | "bearish" | "neutral" = "neutral";
    let signals: string[] = [];
    
    // RSI signals
    if (latestRSI < 30) {
      score += 2;
      signals.push("oversold RSI");
      direction = "bullish";
    } else if (latestRSI > 70) {
      score += 2;
      signals.push("overbought RSI");
      direction = "bearish";
    }
    
    // Stochastic signals (new)
    if (latestStochK < 20) {
      score += 1.5;
      signals.push("oversold stochastic");
      if (direction === "neutral") direction = "bullish";
    } else if (latestStochK > 80) {
      score += 1.5;
      signals.push("overbought stochastic");
      if (direction === "neutral") direction = "bearish";
    }
    
    // MACD crossover
    if (latestMACD > latestSignal && macd.macd[macd.macd.length - 2] <= macd.signal[macd.signal.length - 2]) {
      score += 2;
      signals.push("bullish MACD crossover");
      direction = "bullish";
    } else if (latestMACD < latestSignal && macd.macd[macd.macd.length - 2] >= macd.signal[macd.signal.length - 2]) {
      score += 2;
      signals.push("bearish MACD crossover");
      direction = "bearish";
    }
    
    // Bollinger Band signals (new)
    if (currentPrice < latestBBLower) {
      score += 1.5;
      signals.push("below lower Bollinger Band");
      if (direction === "neutral") direction = "bullish";
    } else if (currentPrice > latestBBUpper) {
      score += 1.5;
      signals.push("above upper Bollinger Band");
      if (direction === "neutral") direction = "bearish";
    }
    
    // ADX trend strength bonus (new)
    if (latestADX > 25) {
      score += 1;
      signals.push(`strong trend (ADX: ${latestADX.toFixed(0)})`);
    }
    
    // Volume confirmation via OBV (new)
    if (obvTrend === "rising" && direction === "bullish") {
      score += 1;
      signals.push("volume confirms bullish");
    } else if (obvTrend === "falling" && direction === "bearish") {
      score += 1;
      signals.push("volume confirms bearish");
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
    
    // Require meaningful signal
    if (score < 2.5 || signals.length === 0) {
      return null;
    }
    
    const confidence = Math.min(92, 45 + score * 6);
    
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
      explanation: `${signals.join(", ")}. Current price $${currentPrice.toFixed(2)}.`,
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
  console.log(`Scanning market for ${tradingStyle} opportunities with enhanced indicators...`);
  
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
  
  console.log(`Found ${opportunities.length} valid ${tradingStyle} opportunities with enhanced analysis`);
  
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
    
    // Handle price-target mode
    if (mode === "price-target") {
      if (!targetPrice || typeof targetPrice !== "number" || targetPrice <= 0) {
        return new Response(
          JSON.stringify({ error: "Invalid target price. Must be a positive number." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log(`Processing enhanced price target prediction for ${ticker.toUpperCase()} targeting $${targetPrice}`);
      
      const aiPrediction = await generatePriceTargetPrediction(
        ticker.toUpperCase(),
        targetPrice,
        stockData,
        indicators,
        regimeInfo,
        sentiment
      );
      
      const currentPrice = closePrices[closePrices.length - 1];
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
      };
      
      console.log("Enhanced price target prediction complete:", result.ticker, `$${result.targetPrice}`, result.estimatedDate);
      
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

    console.log(`Processing enhanced prediction for ${ticker.toUpperCase()} targeting ${targetDate}`);
    
    // Get enhanced AI prediction
    const aiPrediction = await generateAIPrediction(
      ticker.toUpperCase(),
      targetDate,
      stockData,
      indicators,
      regimeInfo,
      sentiment
    );
    
    const currentPrice = closePrices[closePrices.length - 1];
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
      // Additional enhanced data
      supportLevels: indicators.supportResistance.support,
      resistanceLevels: indicators.supportResistance.resistance,
      fibonacciTrend: indicators.fibonacci.trend,
      obvTrend: indicators.obvTrend,
    };

    console.log("Enhanced prediction complete:", result.ticker, result.predictedPrice);
    
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
