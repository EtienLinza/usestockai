import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { ticker } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({ error: "Ticker is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Fetching stock price for: ${ticker}`);

    // Fetch chart (daily history) and live quote in parallel.
    const [chartRes, quoteRes] = await Promise.all([
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
      ),
      fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`,
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
      ).catch(() => null),
    ]);

    if (!chartRes.ok) {
      console.error(`Yahoo Finance chart API error: ${chartRes.status}`);
      return new Response(
        JSON.stringify({ error: "Failed to fetch stock data", status: chartRes.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await chartRes.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      console.error("No data in Yahoo Finance response");
      return new Response(
        JSON.stringify({ error: "No data available for ticker" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const closes = result?.indicators?.quote?.[0]?.close;
    const timestamps = result?.timestamp;

    if (!closes || !timestamps) {
      console.error("Missing price data in response");
      return new Response(
        JSON.stringify({ error: "Incomplete data from provider" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const priceHistory = timestamps.map((ts: number, i: number) => ({
      timestamp: ts,
      price: closes[i],
    })).filter((item: { price: number | null }) => item.price !== null);

    // Live quote (best-effort — falls back to last close if quote endpoint is unavailable).
    let liveQuote: number | null = null;
    let previousClose: number | null = null;
    let marketState: string | null = null;
    if (quoteRes && quoteRes.ok) {
      try {
        const qj = await quoteRes.json();
        const q = qj?.quoteResponse?.result?.[0];
        if (q) {
          liveQuote = q.regularMarketPrice ?? null;
          previousClose = q.regularMarketPreviousClose ?? null;
          marketState = q.marketState ?? null;
        }
      } catch (e) {
        console.warn("quote parse failed", e);
      }
    }

    console.log(`Fetched ${priceHistory.length} bars for ${ticker}; liveQuote=${liveQuote} prevClose=${previousClose}`);

    return new Response(
      JSON.stringify({
        ticker,
        priceHistory,
        latestPrice: closes[closes.length - 1],
        latestTimestamp: timestamps[timestamps.length - 1],
        liveQuote,
        previousClose,
        marketState,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching stock price:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
