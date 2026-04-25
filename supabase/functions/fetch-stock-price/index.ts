// ============================================================================
// FETCH-STOCK-PRICE — hybrid Finnhub + Yahoo data fetcher.
//
//   • Live quote / previousClose / marketState  → Finnhub (fast, reliable),
//     falls back to Yahoo intraday meta if Finnhub is unconfigured or fails.
//   • Historical daily candles (5 days)         → Yahoo (Finnhub gates this
//     behind a paid plan).
//   • Optional fundamentals payload             → Finnhub (PE, market cap,
//     beta, 52-week range, industry).
//
// Response shape is backward-compatible: existing callers (Dashboard, alerts,
// portfolio-gate) keep working without any changes. New fields are additive
// and may be null when sources are unavailable.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getQuote, getFundamentals, isFinnhubConfigured } from "../_shared/finnhub.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker ?? "").trim().toUpperCase();
    const includeFundamentals = body?.includeFundamentals === true;

    if (!ticker || !/^[A-Z]{1,10}(-[A-Z]{2,4})?$/.test(ticker)) {
      return new Response(
        JSON.stringify({ error: "Ticker is required and must be valid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`fetch-stock-price ${ticker} (finnhub=${isFinnhubConfigured()}, fundamentals=${includeFundamentals})`);

    // Run all upstream calls in parallel — none of them block each other.
    const [chartRes, intradayRes, finnhubQuote, fundamentals] = await Promise.all([
      // Yahoo daily candles (always needed for priceHistory)
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
        { headers: { "User-Agent": YAHOO_UA } }
      ).catch((e) => { console.warn("yahoo daily failed:", e); return null; }),
      // Yahoo intraday meta (fallback for live quote / marketState)
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`,
        { headers: { "User-Agent": YAHOO_UA } }
      ).catch(() => null),
      // Finnhub real-time quote (primary)
      getQuote(ticker),
      // Finnhub fundamentals (only if requested — saves ~2 API calls)
      includeFundamentals ? getFundamentals(ticker) : Promise.resolve(null),
    ]);

    if (!chartRes || !chartRes.ok) {
      const status = chartRes?.status ?? 0;
      console.error(`Yahoo chart API error: ${status}`);
      // If Finnhub gave us a quote, we can still return a degraded payload
      if (finnhubQuote) {
        return new Response(
          JSON.stringify({
            ticker,
            priceHistory: [],
            latestPrice: finnhubQuote.current,
            latestTimestamp: finnhubQuote.timestamp,
            liveQuote: finnhubQuote.current,
            previousClose: finnhubQuote.previousClose || null,
            marketState: null,
            quoteSource: "finnhub",
            fundamentals: fundamentals ?? null,
            degraded: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to fetch stock data", status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await chartRes.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return new Response(
        JSON.stringify({ error: "No data available for ticker" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const closes = result?.indicators?.quote?.[0]?.close;
    const timestamps = result?.timestamp;
    if (!closes || !timestamps) {
      return new Response(
        JSON.stringify({ error: "Incomplete data from provider" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const priceHistory = timestamps.map((ts: number, i: number) => ({
      timestamp: ts,
      price: closes[i],
    })).filter((item: { price: number | null }) => item.price !== null);

    // Live quote: prefer Finnhub, fall back to Yahoo intraday meta.
    let liveQuote: number | null = null;
    let previousClose: number | null = null;
    let marketState: string | null = null;
    let quoteSource: "finnhub" | "yahoo" | "yahoo-eod" = "yahoo-eod";

    if (finnhubQuote) {
      liveQuote = finnhubQuote.current;
      previousClose = finnhubQuote.previousClose || null;
      quoteSource = "finnhub";
    }

    // Always parse Yahoo meta for marketState (Finnhub doesn't provide it).
    // Also use as live-quote fallback if Finnhub didn't respond.
    if (intradayRes && intradayRes.ok) {
      try {
        const ij = await intradayRes.json();
        const meta = ij?.chart?.result?.[0]?.meta;
        if (meta) {
          if (liveQuote === null && typeof meta.regularMarketPrice === "number") {
            liveQuote = meta.regularMarketPrice;
            quoteSource = "yahoo";
          }
          if (previousClose === null) {
            previousClose = typeof meta.previousClose === "number"
              ? meta.previousClose
              : (typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null);
          }
          marketState = meta.marketState ?? null;
        }
      } catch (e) {
        console.warn("intraday meta parse failed", e);
      }
    }

    console.log(
      `${ticker}: bars=${priceHistory.length} liveQuote=${liveQuote} (src=${quoteSource}) prevClose=${previousClose}`
    );

    return new Response(
      JSON.stringify({
        ticker,
        priceHistory,
        latestPrice: closes[closes.length - 1],
        latestTimestamp: timestamps[timestamps.length - 1],
        liveQuote,
        previousClose,
        marketState,
        quoteSource,
        fundamentals: fundamentals ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("fetch-stock-price error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
