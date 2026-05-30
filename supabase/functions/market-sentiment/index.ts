import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getQuoteWithFallback } from "../_shared/finnhub.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Live index quote — Finnhub primary, Yahoo fallback.
// NOTE: Finnhub uses different ticker codes for indices than Yahoo
// (e.g. ^GSPC vs SPY). For free-tier reliability we map Yahoo index symbols
// to their tradable ETF proxies for Finnhub, then fall back to Yahoo's native
// index endpoint if Finnhub returns nothing.
const FINNHUB_INDEX_PROXY: Record<string, string> = {
  "^GSPC": "SPY",  // S&P 500
  "^IXIC": "QQQ",  // Nasdaq 100 proxy
  "^DJI":  "DIA",  // Dow Jones
  "^VIX":  "",     // VIX has no ETF proxy on free tier — Yahoo only
};

async function fetchYahooQuote(ticker: string): Promise<{ price: number; change: number } | null> {
  // For indices, prefer the Finnhub-friendly ETF proxy when available.
  const proxy = FINNHUB_INDEX_PROXY[ticker];
  if (proxy) {
    const q = await getQuoteWithFallback(proxy);
    if (q && q.price > 0 && q.changePct !== null) {
      return { price: q.price, change: q.changePct };
    }
  }
  // Fall back to Yahoo's native chart endpoint (handles ^GSPC, ^VIX, etc).
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

// ── CNN Fear & Greed Index (real) ────────────────────────────────────────────
// CNN's public dataviz endpoint also returns the live VIX series, so we use it
// for both the F&G score AND as one of the VIX fallbacks.
interface CnnFearGreed {
  score: number | null;
  vix: number | null;
}

async function fetchCnnFearGreedAndVix(): Promise<CnnFearGreed> {
  try {
    const r = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Origin": "https://www.cnn.com",
          "Referer": "https://www.cnn.com/",
        },
      },
    );
    if (!r.ok) {
      console.warn("CNN F&G HTTP", r.status);
      return { score: null, vix: null };
    }
    const j: any = await r.json();
    const score =
      typeof j?.fear_and_greed?.score === "number"
        ? Math.round(j.fear_and_greed.score)
        : null;
    const vixSeries: Array<{ x: number; y: number }> =
      j?.market_volatility_vix?.data ?? [];
    const lastVix = vixSeries.length ? vixSeries[vixSeries.length - 1]?.y : null;
    const vix = typeof lastVix === "number" && lastVix > 0 ? lastVix : null;
    return { score, vix };
  } catch (e) {
    console.warn("CNN F&G error:", e instanceof Error ? e.message : e);
    return { score: null, vix: null };
  }
}

// Stooq fallback for VIX — returns CSV with the latest close.
async function fetchVixFromStooq(): Promise<number | null> {
  try {
    const r = await fetch("https://stooq.com/q/l/?s=^vix&f=sd2t2ohlcv&h&e=csv", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;
    const cols = lines[1].split(",");
    // Header: Symbol,Date,Time,Open,High,Low,Close,Volume
    const close = parseFloat(cols[6]);
    return Number.isFinite(close) && close > 0 ? close : null;
  } catch (e) {
    console.warn("Stooq VIX error:", e instanceof Error ? e.message : e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Fetching market sentiment data...");

    const [sp500, nasdaq, dow, vixYahoo, cnn, gainersData, losersData] =
      await Promise.all([
        fetchYahooQuote("^GSPC"),
        fetchYahooQuote("^IXIC"),
        fetchYahooQuote("^DJI"),
        fetchYahooQuote("^VIX"),
        fetchCnnFearGreedAndVix(),
        fetchScreenerData("day_gainers"),
        fetchScreenerData("day_losers"),
      ]);

    // VIX: prefer Yahoo (intraday), then CNN, then Stooq. No fake default.
    let vixValue: number | null =
      vixYahoo?.price && vixYahoo.price > 0 ? vixYahoo.price : null;
    if (vixValue === null) vixValue = cnn.vix;
    if (vixValue === null) vixValue = await fetchVixFromStooq();

    // Fear/Greed: prefer CNN's real index. Fall back to internal heuristic
    // only if CNN is unreachable so the UI never shows a hard error.
    let fearGreedScore: number;
    if (cnn.score !== null) {
      fearGreedScore = cnn.score;
    } else {
      fearGreedScore = 50;
      const v = vixValue ?? 20;
      if (v < 15) fearGreedScore += 25;
      else if (v < 20) fearGreedScore += 15;
      else if (v < 25) fearGreedScore += 5;
      else if (v < 30) fearGreedScore -= 10;
      else fearGreedScore -= 25;

      const avgChange =
        ((sp500?.change || 0) + (nasdaq?.change || 0) + (dow?.change || 0)) / 3;
      if (avgChange > 1.5) fearGreedScore += 25;
      else if (avgChange > 0.5) fearGreedScore += 15;
      else if (avgChange > 0) fearGreedScore += 5;
      else if (avgChange > -0.5) fearGreedScore -= 5;
      else if (avgChange > -1.5) fearGreedScore -= 15;
      else fearGreedScore -= 25;

      fearGreedScore = Math.max(0, Math.min(100, fearGreedScore));
    }

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
      fearGreedSource: cnn.score !== null ? "cnn" : "internal",
      sp500Change: sp500?.change || 0,
      nasdaqChange: nasdaq?.change || 0,
      dowChange: dow?.change || 0,
      vixValue, // may be null if every source failed — UI shows "—"
      gainers,
      losers,
      updatedAt: new Date().toISOString(),
    };

    console.log("Market sentiment data fetched successfully", {
      fearGreedScore,
      vixValue,
      source: result.fearGreedSource,
    });

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
