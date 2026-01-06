import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchYahooQuote(ticker: string): Promise<{ price: number; change: number } | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const price = result.meta?.regularMarketPrice || 0;
    const prevClose = result.meta?.chartPreviousClose || result.meta?.previousClose || price;
    const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    return { price, change };
  } catch (error) {
    console.error(`Error fetching ${ticker}:`, error);
    return null;
  }
}

async function fetchScreenerData(screenerId: string): Promise<any[]> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${screenerId}&count=10`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    return data?.finance?.result?.[0]?.quotes || [];
  } catch (error) {
    console.error(`Error fetching screener ${screenerId}:`, error);
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Fetching market sentiment data...");

    // Fetch major indices
    const [sp500, nasdaq, dow, vix] = await Promise.all([
      fetchYahooQuote("^GSPC"),
      fetchYahooQuote("^IXIC"),
      fetchYahooQuote("^DJI"),
      fetchYahooQuote("^VIX"),
    ]);

    // Fetch gainers and losers
    const [gainersData, losersData] = await Promise.all([
      fetchScreenerData("day_gainers"),
      fetchScreenerData("day_losers"),
    ]);

    // Calculate fear/greed score based on:
    // 1. VIX level (inverted - high VIX = fear)
    // 2. Market momentum (positive = greed)
    // 3. Market breadth approximation from gainers/losers
    let fearGreedScore = 50; // neutral baseline

    // VIX component (0-25 points)
    const vixValue = vix?.price || 20;
    if (vixValue < 15) fearGreedScore += 25;
    else if (vixValue < 20) fearGreedScore += 15;
    else if (vixValue < 25) fearGreedScore += 5;
    else if (vixValue < 30) fearGreedScore -= 10;
    else fearGreedScore -= 25;

    // Market momentum component (0-25 points)
    const avgChange = ((sp500?.change || 0) + (nasdaq?.change || 0) + (dow?.change || 0)) / 3;
    if (avgChange > 1.5) fearGreedScore += 25;
    else if (avgChange > 0.5) fearGreedScore += 15;
    else if (avgChange > 0) fearGreedScore += 5;
    else if (avgChange > -0.5) fearGreedScore -= 5;
    else if (avgChange > -1.5) fearGreedScore -= 15;
    else fearGreedScore -= 25;

    // Clamp to 0-100
    fearGreedScore = Math.max(0, Math.min(100, fearGreedScore));

    // Format gainers/losers
    const gainers = gainersData.slice(0, 5).map((q: any) => ({
      ticker: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      change: q.regularMarketChangePercent || 0,
      volume: q.regularMarketVolume || 0,
    }));

    const losers = losersData.slice(0, 5).map((q: any) => ({
      ticker: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      change: q.regularMarketChangePercent || 0,
      volume: q.regularMarketVolume || 0,
    }));

    const result = {
      fearGreedScore,
      sp500Change: sp500?.change || 0,
      nasdaqChange: nasdaq?.change || 0,
      dowChange: dow?.change || 0,
      vixValue: vixValue,
      gainers,
      losers,
      updatedAt: new Date().toISOString(),
    };

    console.log("Market sentiment data fetched successfully");

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Market sentiment error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});