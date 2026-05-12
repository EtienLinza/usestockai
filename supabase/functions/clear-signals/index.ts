import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser, cronSecretHeader } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireCronOrUser(req, { allowAuthenticatedUser: true });
  if (denied) return denied;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body is fine */ }
    const autoRescan = body.autoRescan ?? false;

    // Delete all live signals, but preserve fresh pre-market signals (≤6h old)
    // so the staleness sweep doesn't wipe out the morning's pre-open scan
    // before traders have a chance to see it.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { error: deleteError } = await supabase
      .from("live_signals")
      .delete()
      .or(`source.neq.premarket,created_at.lt.${sixHoursAgo}`);

    if (deleteError) {
      console.error("Failed to clear signals:", deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to clear signals", details: deleteError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clear old prediction_runs (older than 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("prediction_runs")
      .delete()
      .lt("created_at", oneDayAgo);

    // If autoRescan is true, trigger a full market scan (all batches sequentially)
    if (autoRescan) {
      console.log("Auto-rescan triggered, running market scanner batches...");
      let batch = 0;
      let done = false;
      let tickerList: string[] | undefined;
      let totalSignals = 0;

      while (!done) {
        const invokeBody: Record<string, unknown> = { batch, batchSize: 25 };
        if (tickerList) invokeBody.tickerList = tickerList;

        const scanRes = await fetch(`${supabaseUrl}/functions/v1/market-scanner`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${anonKey}`,
            ...cronSecretHeader(),
          },
          body: JSON.stringify(invokeBody),
        });

        if (!scanRes.ok) {
          console.error(`Scan batch ${batch} failed:`, await scanRes.text());
          break;
        }

        const scanData = await scanRes.json();
        totalSignals += scanData.signals?.length || 0;
        done = scanData.done;
        if (scanData.tickerList && !tickerList) tickerList = scanData.tickerList;
        batch++;

        // Small delay between batches
        if (!done) await new Promise(r => setTimeout(r, 500));
      }

      console.log(`Auto-rescan complete: ${totalSignals} signals across ${batch} batches`);
      return new Response(
        JSON.stringify({ success: true, cleared: true, rescanned: true, totalSignals, batches: batch }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "All signals and old predictions cleared" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Failed";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
