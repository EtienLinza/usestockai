import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getQuoteWithFallback } from "../_shared/finnhub.ts";

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

// Fetch current price — Finnhub primary, Yahoo fallback (centralized helper)
async function fetchCurrentPrice(ticker: string): Promise<{ price: number; source: string } | null> {
  const q = await getQuoteWithFallback(ticker);
  if (!q) return null;
  return { price: q.price, source: q.source };
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

            // Send email notification
            try {
              const emailResponse = await fetch(
                `${supabaseUrl}/functions/v1/send-alert-email`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${supabaseServiceKey}`,
                  },
                  body: JSON.stringify({
                    userId: alert.user_id,
                    ticker: alert.ticker,
                    targetPrice: alert.target_price,
                    currentPrice: currentPrice,
                    direction: alert.direction,
                  }),
                }
              );
              const emailResult = await emailResponse.json();
              console.log(`Email notification result for ${alert.ticker}:`, emailResult);
            } catch (emailError) {
              console.error(`Failed to send email for alert ${alert.id}:`, emailError);
            }
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
