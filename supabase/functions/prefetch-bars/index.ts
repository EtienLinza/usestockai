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
const TIME_BUDGET_MS = 40_000; // wall-clock guard
const MAX_PER_RUN = 400;   // hard work cap per invocation (CPU limit guard)
// After this many consecutive failed fetches a symbol is quarantined. The
// universe carries a long tail of delisted / foreign / <200-bar tickers that
// can never succeed; the old time-derived rotation kept landing on them and
// burned the whole per-run budget without writing anything.
const FAILURE_QUARANTINE_AT = 3;
const QUARANTINE_DAYS = 30;

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

    const staleAll = universe.filter((t) => !fresh.has(t));

    // Drop symbols that are currently quarantined for repeated fetch failures.
    const quarantined = new Set<string>();
    const failCounts = new Map<string, number>();
    {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("ticker_fetch_failures")
        .select("ticker, consecutive_failures, quarantined_until");
      if (error) console.warn("prefetch-bars quarantine read err", error.message);
      for (const r of (data ?? []) as Array<{ ticker: string; consecutive_failures: number; quarantined_until: string | null }>) {
        failCounts.set(r.ticker, r.consecutive_failures ?? 0);
        if (r.quarantined_until && r.quarantined_until > nowIso) quarantined.add(r.ticker);
      }
    }

    const stale = staleAll.filter((t) => !quarantined.has(t));
    console.log(
      `prefetch-bars: universe=${universe.length} fresh=${fresh.size} stale=${stale.length} quarantined=${quarantined.size}`,
    );

    let written = 0, failed = 0, processed = 0;
    // Oldest-first is unnecessary now that dead symbols are quarantined: the
    // remaining stale list is genuinely fetchable, so a simple head slice
    // converges within a few runs.
    const work = stale.slice(0, MAX_PER_RUN);
    const failedTickers: string[] = [];
    const recoveredTickers: string[] = [];

    for (let i = 0; i < work.length; i += PARALLELISM) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        console.log(`prefetch-bars: time budget reached at ${processed}/${work.length}`);
        break;
      }
      const slice = work.slice(i, i + PARALLELISM);
      const results = await Promise.all(slice.map(async (t) => {
        const bars = await fetchDailyHistory(t, "1y").catch(() => null);
        return bars && bars.close.length >= 200 ? { ticker: t, bars } : null;
      }));
      const ok = results.filter(Boolean) as { ticker: string; bars: any }[];
      const okSet = new Set(ok.map((o) => o.ticker));
      for (const t of slice) {
        if (okSet.has(t)) { if (failCounts.has(t)) recoveredTickers.push(t); }
        else failedTickers.push(t);
      }
      processed += slice.length;
      failed += slice.length - ok.length;
      written += await upsertBars(ok);
    }

    // Persist failure bookkeeping so the next run skips the dead tail.
    if (failedTickers.length > 0) {
      const nowIso = new Date().toISOString();
      const rows = failedTickers.map((t) => {
        const n = (failCounts.get(t) ?? 0) + 1;
        return {
          ticker: t,
          consecutive_failures: n,
          last_failure_at: nowIso,
          quarantined_until: n >= FAILURE_QUARANTINE_AT
            ? new Date(Date.now() + QUARANTINE_DAYS * 86_400_000).toISOString()
            : null,
          updated_at: nowIso,
        };
      });
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase
          .from("ticker_fetch_failures")
          .upsert(rows.slice(i, i + 200), { onConflict: "ticker" });
        if (error) console.warn("prefetch-bars failure upsert err", error.message);
      }
    }
    if (recoveredTickers.length > 0) {
      for (let i = 0; i < recoveredTickers.length; i += 200) {
        const { error } = await supabase
          .from("ticker_fetch_failures")
          .delete()
          .in("ticker", recoveredTickers.slice(i, i + 200));
        if (error) console.warn("prefetch-bars failure clear err", error.message);
      }
    }

    const remaining = Math.max(0, stale.length - processed);
    const elapsed = Date.now() - startedAt;
    const msg = `wrote=${written} failed=${failed} quarantined=${quarantined.size} remaining=${remaining} universe=${universe.length} ${elapsed}ms`;
    console.log("prefetch-bars done:", msg);
    await recordHeartbeat("prefetch-bars", startedAt, remaining > 0 ? "degraded" : "ok", msg);
    return new Response(
      JSON.stringify({
        ok: true, written, failed, remaining,
        quarantined: quarantined.size, universe: universe.length, elapsed,
      }),
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
