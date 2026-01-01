import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PriceAlert {
  id: string;
  user_id: string;
  ticker: string;
  target_price: number;
  direction: "above" | "below";
  is_triggered: boolean;
}

// Fetch current price from Yahoo Finance
async function fetchCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch price for ${ticker}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price || null;
  } catch (error) {
    console.error(`Error fetching price for ${ticker}:`, error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get optional user_id from request body for on-demand checking
    let userId: string | null = null;
    try {
      const body = await req.json();
      userId = body?.user_id || null;
    } catch {
      // No body provided, check all alerts
    }

    // Fetch active (non-triggered) alerts
    let query = supabase
      .from("price_alerts")
      .select("*")
      .eq("is_triggered", false);

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data: alerts, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching alerts:", fetchError);
      throw fetchError;
    }

    if (!alerts || alerts.length === 0) {
      console.log("No active alerts to check");
      return new Response(
        JSON.stringify({ message: "No active alerts", triggered: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Checking ${alerts.length} active alerts`);

    // Group alerts by ticker for efficient fetching
    const tickerMap = new Map<string, PriceAlert[]>();
    for (const alert of alerts) {
      const existing = tickerMap.get(alert.ticker) || [];
      existing.push(alert);
      tickerMap.set(alert.ticker, existing);
    }

    const triggeredAlerts: { id: string; ticker: string; target_price: number; current_price: number }[] = [];

    // Check each ticker
    for (const [ticker, tickerAlerts] of tickerMap) {
      const currentPrice = await fetchCurrentPrice(ticker);

      if (currentPrice === null) {
        console.warn(`Could not fetch price for ${ticker}, skipping`);
        continue;
      }

      console.log(`${ticker}: current price $${currentPrice.toFixed(2)}`);

      for (const alert of tickerAlerts) {
        let isTriggered = false;

        if (alert.direction === "above" && currentPrice >= alert.target_price) {
          isTriggered = true;
        } else if (alert.direction === "below" && currentPrice <= alert.target_price) {
          isTriggered = true;
        }

        if (isTriggered) {
          console.log(
            `TRIGGERED: ${ticker} ${alert.direction} $${alert.target_price} (current: $${currentPrice})`
          );

          // Update alert as triggered
          const { error: updateError } = await supabase
            .from("price_alerts")
            .update({
              is_triggered: true,
              triggered_at: new Date().toISOString(),
            })
            .eq("id", alert.id);

          if (updateError) {
            console.error(`Failed to update alert ${alert.id}:`, updateError);
          } else {
            triggeredAlerts.push({
              id: alert.id,
              ticker: alert.ticker,
              target_price: alert.target_price,
              current_price: currentPrice,
            });
          }
        }
      }

      // Small delay between tickers to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`Triggered ${triggeredAlerts.length} alerts`);

    return new Response(
      JSON.stringify({
        message: `Checked ${alerts.length} alerts, triggered ${triggeredAlerts.length}`,
        triggered: triggeredAlerts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("check-price-alerts error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
