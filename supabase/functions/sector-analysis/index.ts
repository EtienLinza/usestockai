import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchDailyCloses } from "../_shared/yahoo-history.ts";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";

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
  const preflight = handleCors(req);
  if (preflight) return preflight;

  // Gate to authenticated users + cron so anon traffic can't drain Yahoo quota.
  const denied = await requireCronOrUser(req, { allowAuthenticatedUser: true });
  if (denied) return denied;


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

    return jsonResponse({
      sectors,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Sector analysis error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});