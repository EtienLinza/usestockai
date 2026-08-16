// ============================================================================
// PREFETCH-BARS — incremental job that warms ticker_bars_cache with 1y daily
// OHLCV. Runs on a short cadence after the US close: each invocation works a
// time-budgeted slice of the tickers that are still STALE, so the whole
// universe converges over a handful of runs instead of blowing the worker's
// compute limit in one pass.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import { discoverTickers } from "../_shared/scan-pipeline.ts";
import { upsertBars } from "../_shared/bars-cache.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { requireCronOrUser } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const PARALLELISM = 12;
const TIME_BUDGET_MS = 40_000; // stay well under the worker CPU limit

function freshCutoff(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = await requireCronOrUser(req);
  if (denied) return denied;
  const startedAt = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const disco = await discoverTickers();
    const universe = disco.tickers;

    // Which tickers are already fresh? Skip them entirely.
    const fresh = new Set<string>();
    const cutoff = freshCutoff();
    const CH = 500;
    for (let i = 0; i < universe.length; i += CH) {
      const slice = universe.slice(i, i + CH);
      const { data, error } = await supabase
        .from("ticker_bars_cache")
        .select("ticker")
        .in("ticker", slice)
        .gte("as_of", cutoff);
      if (error) console.warn("prefetch-bars fresh-check err", error.message);
      for (const r of data ?? []) fresh.add((r as { ticker: string }).ticker);
    }

    const stale = universe.filter((t) => !fresh.has(t));
    console.log(`prefetch-bars: universe=${universe.length} fresh=${fresh.size} stale=${stale.length}`);

    let written = 0, failed = 0, processed = 0;
    const work = stale.slice(0, MAX_PER_RUN);
    for (let i = 0; i < work.length; i += PARALLELISM) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        console.log(`prefetch-bars: time budget reached at ${processed}/${work.length}`);
        break;
      }
      const slice = work.slice(i, i + PARALLELISM);
      const results = await Promise.all(slice.map(async (t) => {
        const bars = await fetchDailyHistory(t, "1y");
        return bars && bars.close.length >= 200 ? { ticker: t, bars } : null;
      }));
      const ok = results.filter(Boolean) as { ticker: string; bars: any }[];
      processed += slice.length;
      failed += slice.length - ok.length;
      written += await upsertBars(ok);
    }


    const remaining = Math.max(0, stale.length - processed);
    const elapsed = Date.now() - startedAt;
    const msg = `wrote=${written} failed=${failed} remaining=${remaining} universe=${universe.length} ${elapsed}ms`;
    console.log("prefetch-bars done:", msg);
    await recordHeartbeat("prefetch-bars", startedAt, remaining > 0 ? "degraded" : "ok", msg);
    return new Response(
      JSON.stringify({ ok: true, written, failed, remaining, universe: universe.length, elapsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await recordHeartbeat("prefetch-bars", startedAt, "error", m);
    return new Response(JSON.stringify({ error: m }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
