import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  // Use Yahoo Finance via a CORS proxy or direct API
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
    
    // Simple sentiment scoring based on keywords
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
  
  const recentData = {
    prices: stockData.close.slice(-30),
    dates: stockData.timestamps.slice(-30),
    currentPrice: stockData.close[stockData.close.length - 1],
    ema12: indicators.ema12.slice(-5),
    ema26: indicators.ema26.slice(-5),
    sma50: indicators.sma50.slice(-5),
    rsi: indicators.rsi.slice(-5),
    macd: indicators.macd.macd.slice(-5),
    macdSignal: indicators.macd.signal.slice(-5),
    volatility: indicators.volatility.slice(-5),
  };
  
  const prompt = `You are an expert quantitative analyst. Analyze this stock data and provide a prediction.

STOCK: ${ticker}
TARGET DATE: ${targetDate}
CURRENT PRICE: $${recentData.currentPrice.toFixed(2)}
MARKET REGIME: ${regime}
NEWS SENTIMENT: ${sentiment.toFixed(2)} (scale -1 to 1)

RECENT PRICE DATA (last 30 days):
${recentData.dates.map((d: string, i: number) => `${d}: $${recentData.prices[i]?.toFixed(2)}`).join('\n')}

TECHNICAL INDICATORS (last 5 values):
- EMA12: ${recentData.ema12.map((v: number) => v?.toFixed(2)).join(', ')}
- EMA26: ${recentData.ema26.map((v: number) => v?.toFixed(2)).join(', ')}
- SMA50: ${recentData.sma50.map((v: number) => v?.toFixed(2)).join(', ')}
- RSI14: ${recentData.rsi.map((v: number) => v?.toFixed(1)).join(', ')}
- MACD: ${recentData.macd.map((v: number) => v?.toFixed(3)).join(', ')}
- MACD Signal: ${recentData.macdSignal.map((v: number) => v?.toFixed(3)).join(', ')}
- Volatility: ${recentData.volatility.map((v: number) => (v * 100)?.toFixed(2) + '%').join(', ')}

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
  
  // Parse JSON from response (handle markdown code blocks)
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { ticker, targetDate, newsApiKey } = await req.json();
    
    if (!ticker || !targetDate) {
      return new Response(
        JSON.stringify({ error: "Ticker and targetDate are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing prediction for ${ticker} targeting ${targetDate}`);
    
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in stock-predict:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Prediction failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
