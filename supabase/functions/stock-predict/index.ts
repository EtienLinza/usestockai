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
    // Reset or initialize rate limit
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

// Technical indicator calculations
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

function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      rsi[i] = NaN;
    } else {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi[i] = 100 - (100 / (1 + rs));
    }
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

async function fetchNewsSentiment(ticker: string, apiKey: string): Promise<number> {
  if (!apiKey || apiKey.length < 20) {
    console.log("No valid NewsAPI key provided, skipping sentiment analysis");
    return 0;
  }
  
  try {
    const url = `https://newsapi.org/v2/everything?q=${ticker}&sortBy=publishedAt&apiKey=${apiKey}&pageSize=20`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== "ok" || !data.articles?.length) {
      return 0;
    }
    
    const positiveWords = ['surge', 'gain', 'rise', 'up', 'growth', 'profit', 'beat', 'strong', 'bull', 'buy', 'upgrade'];
    const negativeWords = ['fall', 'drop', 'decline', 'down', 'loss', 'miss', 'weak', 'bear', 'sell', 'downgrade', 'crash'];
    
    let totalScore = 0;
    for (const article of data.articles) {
      const text = (article.title + ' ' + (article.description || '')).toLowerCase();
      let score = 0;
      
      for (const word of positiveWords) {
        if (text.includes(word)) score += 0.1;
      }
      for (const word of negativeWords) {
        if (text.includes(word)) score -= 0.1;
      }
      
      totalScore += Math.max(-1, Math.min(1, score));
    }
    
    return totalScore / data.articles.length;
  } catch (error) {
    console.error("Error fetching news sentiment:", error);
    return 0;
  }
}

async function generateAIPrediction(
  ticker: string,
  targetDate: string,
  stockData: any,
  indicators: any,
  regime: string,
  sentiment: number
): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }
  
  const currentPrice = stockData.close[stockData.close.length - 1];
  
  // Handle null/undefined values safely for crypto and stocks
  const safeToFixed = (val: number | null | undefined, digits: number = 2): string => {
    if (val === null || val === undefined || isNaN(val)) return "N/A";
    return val.toFixed(digits);
  };
  
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
  };
  
  const prompt = `You are an expert quantitative analyst. Analyze this ${ticker.includes('-') ? 'cryptocurrency' : 'stock'} data and provide a prediction.

ASSET: ${ticker}
TARGET DATE: ${targetDate}
CURRENT PRICE: $${safeToFixed(recentData.currentPrice)}
MARKET REGIME: ${regime}
NEWS SENTIMENT: ${safeToFixed(sentiment)} (scale -1 to 1)

RECENT PRICE DATA (last 30 days):
${recentData.dates.map((d: string, i: number) => `${d}: $${safeToFixed(recentData.prices[i])}`).join('\n')}

TECHNICAL INDICATORS (last 5 values):
- EMA12: ${recentData.ema12.map((v: number) => safeToFixed(v)).join(', ')}
- EMA26: ${recentData.ema26.map((v: number) => safeToFixed(v)).join(', ')}
- SMA50: ${recentData.sma50.map((v: number) => safeToFixed(v)).join(', ')}
- RSI14: ${recentData.rsi.map((v: number) => safeToFixed(v, 1)).join(', ')}
- MACD: ${recentData.macd.map((v: number) => safeToFixed(v, 3)).join(', ')}
- MACD Signal: ${recentData.macdSignal.map((v: number) => safeToFixed(v, 3)).join(', ')}
- Volatility: ${recentData.volatility.map((v: number) => v != null ? safeToFixed(v * 100) + '%' : 'N/A').join(', ')}

Based on technical analysis, market regime, and sentiment, provide your prediction. You MUST respond with ONLY valid JSON in this exact format:
{
  "predictedPrice": <number>,
  "uncertaintyPercent": <number between 2 and 15>,
  "confidence": <number between 40 and 95>,
  "reasoning": "<brief 1-2 sentence explanation>",
  "featureImportance": [
    {"name": "EMA Crossover", "importance": <0-1>},
    {"name": "RSI Signal", "importance": <0-1>},
    {"name": "MACD Trend", "importance": <0-1>},
    {"name": "Volatility", "importance": <0-1>},
    {"name": "Market Regime", "importance": <0-1>},
    {"name": "News Sentiment", "importance": <0-1>}
  ]
}`;

  console.log("Calling Lovable AI for prediction...");
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a quantitative financial analyst. Respond only with valid JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
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

// Trading style configurations
const tradingStyles = {
  scalping: {
    volatilityPreference: "high",
    holdingPeriod: "Minutes to hours",
    minVolatility: 0.02,
    preferredRegimes: ["volatile"],
    scoreMultiplier: (volatility: number) => volatility > 0.03 ? 1.5 : 1,
    roiMultiplier: 1.0, // Short-term, smaller moves
  },
  daytrading: {
    volatilityPreference: "medium-high",
    holdingPeriod: "Hours (same day)",
    minVolatility: 0.015,
    preferredRegimes: ["volatile", "bullish", "bearish"],
    scoreMultiplier: (volatility: number) => volatility > 0.02 ? 1.3 : 1,
    roiMultiplier: 1.2,
  },
  swing: {
    volatilityPreference: "medium",
    holdingPeriod: "Days to weeks",
    minVolatility: 0.01,
    preferredRegimes: ["bullish", "bearish"],
    scoreMultiplier: (volatility: number) => volatility > 0.01 && volatility < 0.03 ? 1.4 : 1,
    roiMultiplier: 1.5,
  },
  position: {
    volatilityPreference: "low",
    holdingPeriod: "Weeks to months",
    minVolatility: 0,
    preferredRegimes: ["bullish", "neutral"],
    scoreMultiplier: (volatility: number) => volatility < 0.02 ? 1.5 : 1,
    roiMultiplier: 2.0, // Long-term, larger potential moves
  },
};

// Fetch market movers from Yahoo Finance screener
async function fetchMarketScreener(): Promise<{ ticker: string; percentChange: number; volume: number; marketCap: number }[]> {
  const screenerUrls = [
    "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=25",
    "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers&count=25",
    "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=most_actives&count=25",
  ];
  
  const allTickers: Map<string, { ticker: string; percentChange: number; volume: number; marketCap: number }> = new Map();
  
  // Add crypto tickers
  const cryptoTickers = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "ADA-USD", "DOGE-USD", "AVAX-USD", "DOT-USD"];
  for (const ticker of cryptoTickers) {
    allTickers.set(ticker, { ticker, percentChange: 0, volume: 0, marketCap: 0 });
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
      
      for (const quote of quotes) {
        if (quote.symbol && !quote.symbol.includes('.') && quote.marketCap > 1000000000) { // Min $1B market cap
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
  
  // Convert to array and sort by percentage change
  const tickers = Array.from(allTickers.values());
  tickers.sort((a, b) => b.percentChange - a.percentChange);
  
  console.log(`Fetched ${tickers.length} tickers from market screener`);
  return tickers.slice(0, 40); // Return top 40 for analysis
}

// Fallback stock list if screener fails
const fallbackStocks = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
  "JPM", "V", "JNJ", "WMT", "PG", "UNH", "HD",
  "DIS", "NFLX", "AMD", "INTC", "CRM", "PYPL",
  "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "ADA-USD"
];

// Analyze a single stock for the Guide mode with ROI calculation
async function analyzeStockForGuide(ticker: string, tradingStyle: string = "swing"): Promise<any | null> {
  try {
    const stockData = await fetchStockData(ticker);
    
    if (!stockData.close || stockData.close.length < 60) {
      return null;
    }
    
    const closePrices = stockData.close.filter((p: number) => p != null);
    
    const indicators = {
      ema12: calculateEMA(closePrices, 12),
      ema26: calculateEMA(closePrices, 26),
      sma50: calculateSMA(closePrices, 50),
      rsi: calculateRSI(closePrices, 14),
      macd: calculateMACD(closePrices),
      volatility: calculateVolatility(closePrices, 20),
    };
    
    const regime = detectRegime(closePrices, indicators.rsi, indicators.volatility);
    const currentPrice = closePrices[closePrices.length - 1];
    const latestRSI = indicators.rsi[indicators.rsi.length - 1];
    const latestMACD = indicators.macd.macd[indicators.macd.macd.length - 1];
    const latestSignal = indicators.macd.signal[indicators.macd.signal.length - 1];
    const latestVolatility = indicators.volatility[indicators.volatility.length - 1];
    
    // Get trading style config
    const styleConfig = tradingStyles[tradingStyle as keyof typeof tradingStyles] || tradingStyles.swing;
    
    // Calculate momentum score
    const priceChange5d = (closePrices[closePrices.length - 1] - closePrices[closePrices.length - 6]) / closePrices[closePrices.length - 6];
    const priceChange20d = (closePrices[closePrices.length - 1] - closePrices[closePrices.length - 21]) / closePrices[closePrices.length - 21];
    
    // Score the opportunity
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
    
    // MACD crossover
    if (latestMACD > latestSignal && indicators.macd.macd[indicators.macd.macd.length - 2] <= indicators.macd.signal[indicators.macd.signal.length - 2]) {
      score += 2;
      signals.push("bullish MACD crossover");
      direction = "bullish";
    } else if (latestMACD < latestSignal && indicators.macd.macd[indicators.macd.macd.length - 2] >= indicators.macd.signal[indicators.macd.signal.length - 2]) {
      score += 2;
      signals.push("bearish MACD crossover");
      direction = "bearish";
    }
    
    // Momentum
    if (priceChange5d > 0.03 && priceChange20d > 0.05) {
      score += 1;
      signals.push("strong upward momentum");
      if (direction === "neutral") direction = "bullish";
    } else if (priceChange5d < -0.03 && priceChange20d < -0.05) {
      score += 1;
      signals.push("strong downward momentum");
      if (direction === "neutral") direction = "bearish";
    }
    
    // Trading style specific scoring
    if (styleConfig.preferredRegimes.includes(regime)) {
      score += 1;
    }
    
    // Apply style-specific volatility multiplier
    score = score * styleConfig.scoreMultiplier(latestVolatility);
    
    // Only return if there's a meaningful signal
    if (score < 2 || signals.length === 0) {
      return null;
    }
    
    // Calculate confidence based on score
    const confidence = Math.min(90, 50 + score * 8);
    
    // Calculate risk level based on volatility and trading style
    let riskLevel: "low" | "medium" | "high" = "medium";
    if (latestVolatility > 0.03) {
      riskLevel = "high";
    } else if (latestVolatility < 0.015) {
      riskLevel = "low";
    }
    
    // Calculate predicted price change and ROI
    const priceChangeMultiplier = direction === "bullish" ? 1 : -1;
    const baseChange = Math.min(0.08, latestVolatility * 2 + 0.02);
    const predictedChange = priceChangeMultiplier * baseChange * styleConfig.roiMultiplier;
    const predictedPrice = currentPrice * (1 + predictedChange);
    
    // Calculate expected ROI
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
      riskLevel,
      holdingPeriod: styleConfig.holdingPeriod,
      regime,
    };
  } catch (error) {
    console.error(`Failed to analyze ${ticker}:`, error);
    return null;
  }
}

// Enhance top opportunities with AI insights
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
        temperature: 0.7,
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
    
    // Merge AI insights with original data
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

// Generate guide opportunities with market-wide scanning
async function generateGuideOpportunities(tradingStyle: string = "swing"): Promise<any[]> {
  console.log(`Scanning market for ${tradingStyle} opportunities...`);
  
  // Try to fetch from market screener first
  let tickersToScan: string[] = [];
  
  try {
    const screenerResults = await fetchMarketScreener();
    if (screenerResults.length >= 10) {
      tickersToScan = screenerResults.map(r => r.ticker);
      console.log(`Using ${tickersToScan.length} tickers from market screener`);
    }
  } catch (error) {
    console.warn("Market screener failed, using fallback list");
  }
  
  // Fallback to hardcoded list if screener fails
  if (tickersToScan.length < 10) {
    tickersToScan = fallbackStocks;
    console.log("Using fallback stock list");
  }
  
  // Limit to top 30 for technical analysis
  tickersToScan = tickersToScan.slice(0, 30);
  
  const opportunities: any[] = [];
  
  // Analyze stocks in batches to avoid rate limits
  for (let i = 0; i < tickersToScan.length; i += 5) {
    const batch = tickersToScan.slice(i, i + 5);
    const results = await Promise.all(batch.map(ticker => analyzeStockForGuide(ticker, tradingStyle)));
    
    for (const result of results) {
      if (result) {
        opportunities.push(result);
      }
    }
    
    // Small delay between batches
    if (i + 5 < tickersToScan.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  // Sort by expected ROI (highest first)
  opportunities.sort((a, b) => Math.abs(b.expectedROI) - Math.abs(a.expectedROI));
  
  // Take top 8 for AI enhancement
  const topOpportunities = opportunities.slice(0, 8);
  
  // Enhance with AI
  const enhancedOpportunities = await enhanceWithAI(topOpportunities, tradingStyle);
  
  // Return top 6 with score removed from output
  return enhancedOpportunities.slice(0, 6).map(({ score, ...opp }) => opp);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication before processing any request
    const { user, error: authError } = await verifyAuth(req);
    if (authError) {
      return authError;
    }
    
    // Check rate limit
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
    const { mode, ticker, targetDate, newsApiKey, tradingStyle } = body;
    
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
    
    // Regular prediction mode - validate inputs server-side
    // Supports both stocks (AAPL) and crypto (BTC-USD) formats
    const TICKER_REGEX = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;
    const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

    if (!ticker || !TICKER_REGEX.test(ticker.toUpperCase())) {
      return new Response(
        JSON.stringify({ error: "Invalid ticker format. Use AAPL for stocks or BTC-USD for crypto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!targetDate || !DATE_REGEX.test(targetDate)) {
      return new Response(
        JSON.stringify({ error: "Invalid date format. Must be YYYY-MM-DD." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing prediction for ${ticker.toUpperCase()} targeting ${targetDate}`);
    
    // Fetch real stock data
    const stockData = await fetchStockData(ticker.toUpperCase());
    
    if (!stockData.close || stockData.close.length < 60) {
      throw new Error("Insufficient historical data for analysis");
    }
    
    // Calculate technical indicators
    const closePrices = stockData.close.filter((p: number) => p != null);
    
    const indicators = {
      ema12: calculateEMA(closePrices, 12),
      ema26: calculateEMA(closePrices, 26),
      sma50: calculateSMA(closePrices, 50),
      rsi: calculateRSI(closePrices, 14),
      macd: calculateMACD(closePrices),
      volatility: calculateVolatility(closePrices, 20),
    };
    
    // Detect market regime
    const regime = detectRegime(closePrices, indicators.rsi, indicators.volatility);
    
    // Fetch news sentiment
    const sentiment = await fetchNewsSentiment(ticker, newsApiKey || "");
    
    // Get AI prediction
    const aiPrediction = await generateAIPrediction(
      ticker.toUpperCase(),
      targetDate,
      stockData,
      indicators,
      regime,
      sentiment
    );
    
    const currentPrice = closePrices[closePrices.length - 1];
    const predictedPrice = aiPrediction.predictedPrice;
    const uncertaintyPercent = aiPrediction.uncertaintyPercent / 100;
    
    // Prepare historical data for chart
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
      regime,
      sentimentScore: sentiment,
      featureImportance,
      historicalData,
      reasoning: aiPrediction.reasoning,
      currency: stockData.currency || "USD",
    };

    console.log("Prediction complete:", result.ticker, result.predictedPrice);
    
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
