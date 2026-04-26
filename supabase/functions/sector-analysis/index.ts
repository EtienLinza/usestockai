import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchDailyCloses } from "../_shared/yahoo-history.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SECTOR_ETFS = [
  { sector: "Technology", etfTicker: "XLK" },
  { sector: "Healthcare", etfTicker: "XLV" },
  { sector: "Financials", etfTicker: "XLF" },
  { sector: "Energy", etfTicker: "XLE" },
  { sector: "Consumer Discretionary", etfTicker: "XLY" },
  { sector: "Consumer Staples", etfTicker: "XLP" },
  { sector: "Industrials", etfTicker: "XLI" },
  { sector: "Materials", etfTicker: "XLB" },
  { sector: "Utilities", etfTicker: "XLU" },
  { sector: "Real Estate", etfTicker: "XLRE" },
  { sector: "Communications", etfTicker: "XLC" },
];

// Sector ETF history — Yahoo (Finnhub free tier blocks /stock/candle).
async function fetchETFData(ticker: string): Promise<{
  dailyChange: number;
  weeklyChange: number;
  monthlyChange: number;
} | null> {
  const closes = await fetchDailyCloses(ticker, "3mo");
  if (closes.length < 2) return null;

  const currentPrice = closes[closes.length - 1];
  const prevDayPrice = closes[closes.length - 2] || currentPrice;
  const weekAgoPrice = closes[Math.max(0, closes.length - 6)] || currentPrice;
  const monthAgoPrice = closes[Math.max(0, closes.length - 22)] || closes[0] || currentPrice;

  const dailyChange = prevDayPrice > 0 ? ((currentPrice - prevDayPrice) / prevDayPrice) * 100 : 0;
  const weeklyChange = weekAgoPrice > 0 ? ((currentPrice - weekAgoPrice) / weekAgoPrice) * 100 : 0;
  const monthlyChange = monthAgoPrice > 0 ? ((currentPrice - monthAgoPrice) / monthAgoPrice) * 100 : 0;

  return { dailyChange, weeklyChange, monthlyChange };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Fetching sector analysis data...");

    const sectorPromises = SECTOR_ETFS.map(async ({ sector, etfTicker }) => {
      const data = await fetchETFData(etfTicker);
      if (!data) {
        return {
          sector,
          etfTicker,
          dailyChange: 0,
          weeklyChange: 0,
          monthlyChange: 0,
        };
      }
      return {
        sector,
        etfTicker,
        ...data,
      };
    });

    const sectors = await Promise.all(sectorPromises);

    console.log(`Fetched data for ${sectors.length} sectors`);

    return new Response(
      JSON.stringify({
        sectors,
        updatedAt: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Sector analysis error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});