import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getQuoteWithFallback } from "../_shared/finnhub.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { requireCronOrUser, cronSecretHeader } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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

  const denied = await requireCronOrUser(req, { allowAuthenticatedUser: true });
  if (denied) return denied;

  const startedAt = Date.now();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Determine scope: cron callers (valid x-cron-secret) may scan all users;
    // authenticated user callers can only ever check their own alerts. We
    // derive the user id from the JWT and IGNORE any body.user_id field to
    // prevent IDOR across accounts.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

    let userId: string | null = null;
    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "");
        const { data } = await supabase.auth.getUser(token);
        userId = data?.user?.id ?? null;
      }
      if (!userId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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

    // Fetch all prices in parallel (chunked) — quotes are cached in Postgres
    // so duplicates collapse to one Finnhub call per ticker per minute.
    const tickers = [...tickerMap.keys()];
    const CHUNK = 10;
    const priceByTicker = new Map<string, number>();
    for (let i = 0; i < tickers.length; i += CHUNK) {
      const slice = tickers.slice(i, i + CHUNK);
      const results = await Promise.all(slice.map(async (tk) => {
        const q = await fetchCurrentPrice(tk);
        return { tk, q };
      }));
      for (const { tk, q } of results) {
        if (q !== null) priceByTicker.set(tk, q.price);
      }
    }

    // Evaluate alerts, claim atomically, send email exactly once per claim
    for (const [ticker, tickerAlerts] of tickerMap) {
      const currentPrice = priceByTicker.get(ticker);
      if (currentPrice === undefined) {
        console.warn(`Could not fetch price for ${ticker}, skipping`);
        continue;
      }

      for (const alert of tickerAlerts) {
        const shouldFire =
          (alert.direction === "above" && currentPrice >= alert.target_price) ||
          (alert.direction === "below" && currentPrice <= alert.target_price);
        if (!shouldFire) continue;

        // Atomic claim — returns true only for the caller that flips the row.
        // Concurrent crons race safely; loser gets `false` and skips email.
        const { data: claimed, error: claimErr } = await supabase
          .rpc("claim_price_alert", { _alert_id: alert.id });

        if (claimErr) {
          console.error(`Failed to claim alert ${alert.id}:`, claimErr);
          continue;
        }
        if (!claimed) continue;

        console.log(`TRIGGERED: ${ticker} ${alert.direction} $${alert.target_price} (current: $${currentPrice})`);
        triggeredAlerts.push({
          id: alert.id,
          ticker: alert.ticker,
          target_price: alert.target_price,
          current_price: currentPrice,
        });

        try {
          await fetch(`${supabaseUrl}/functions/v1/send-alert-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
              ...cronSecretHeader(),
            },
            body: JSON.stringify({
              userId: alert.user_id,
              ticker: alert.ticker,
              targetPrice: alert.target_price,
              currentPrice,
              direction: alert.direction,
            }),
          });
        } catch (emailError) {
          console.error(`Failed to send email for alert ${alert.id}:`, emailError);
        }
      }
    }

    console.log(`Triggered ${triggeredAlerts.length} alerts`);

    await recordHeartbeat(
      "check-price-alerts",
      startedAt,
      "ok",
      `checked=${alerts.length} triggered=${triggeredAlerts.length}`,
    );

    return new Response(
      JSON.stringify({
        message: `Checked ${alerts.length} alerts, triggered ${triggeredAlerts.length}`,
        triggered: triggeredAlerts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("check-price-alerts error:", error);
    await recordHeartbeat(
      "check-price-alerts",
      startedAt,
      "error",
      error instanceof Error ? error.message : "Unknown error",
    );
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
