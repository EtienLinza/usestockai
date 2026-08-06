import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient } from "../_shared/supabase-client.ts";
import { requireCronOrUser, cronSecretHeader } from "../_shared/cron-auth.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const denied = await requireCronOrUser(req);
  if (denied) return denied;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = adminClient();

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
      return jsonResponse({ error: "Failed to clear signals", details: deleteError.message }, 500);
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
      return jsonResponse({ success: true, cleared: true, rescanned: true, totalSignals, batches: batch });
    }

    return jsonResponse({ success: true, message: "All signals and old predictions cleared" });
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Failed";
    return jsonResponse({ error: message }, 500);
  }
});
