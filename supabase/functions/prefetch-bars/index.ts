// ============================================================================
// PREFETCH-BARS — daily job that warms ticker_bars_cache with 1y daily OHLCV.
// Runs after US close so subsequent scans hit the cache instead of Yahoo.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import { discoverTickers } from "../_shared/scan-pipeline.ts";
import { upsertBars } from "../_shared/bars-cache.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { requireCronOrUser } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const PARALLELISM = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = await requireCronOrUser(req);
  if (denied) return denied;
  const startedAt = Date.now();
  try {
    const disco = await discoverTickers();
    const tickers = disco.tickers;
    console.log(`prefetch-bars: ${tickers.length} tickers`);

    let written = 0, failed = 0;
    for (let i = 0; i < tickers.length; i += PARALLELISM) {
      const slice = tickers.slice(i, i + PARALLELISM);
      const results = await Promise.all(slice.map(async t => {
        const bars = await fetchDailyHistory(t, "1y");
        return bars && bars.close.length >= 200 ? { ticker: t, bars } : null;
      }));
      const ok = results.filter(Boolean) as { ticker: string; bars: any }[];
      failed += slice.length - ok.length;
      written += await upsertBars(ok);
    }

    const elapsed = Date.now() - startedAt;
    const msg = `wrote=${written} failed=${failed} universe=${tickers.length} ${elapsed}ms`;
    console.log("prefetch-bars done:", msg);
    await recordHeartbeat("prefetch-bars", startedAt, "ok", msg);
    return new Response(JSON.stringify({ ok: true, written, failed, universe: tickers.length, elapsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await recordHeartbeat("prefetch-bars", startedAt, "error", m);
    return new Response(JSON.stringify({ error: m }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
