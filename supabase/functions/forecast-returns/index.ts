// On-demand multi-horizon return forecaster.
// POST { ticker } → { ticker, asOfPrice, daily, weekly, monthly, quarterly, yearly }
// Pulls ~1y of daily closes from Yahoo, runs drift+vol GBM forecast.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { computeReturnForecasts } from "../_shared/return-forecasts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker ?? "").trim().toUpperCase();
    if (!ticker || !/^[A-Z]{1,10}(-[A-Z]{2,4})?$/.test(ticker)) {
      return new Response(JSON.stringify({ error: "Invalid ticker" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
    const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA } });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch price history" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const cleanCloses = closes.filter((c): c is number => typeof c === "number" && c > 0);

    const forecasts = computeReturnForecasts(cleanCloses);
    if (!forecasts) {
      return new Response(JSON.stringify({ error: "Insufficient price history" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ticker, ...forecasts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("forecast-returns error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
