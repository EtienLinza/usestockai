// ============================================================================
// REFRESH-SHORT-INTEREST — nightly cron that pulls short-interest snapshots
// for the union of scan universe + watchlists + open positions, and upserts
// into the `short_interest_history` table. Mirrors refresh-eps-revisions.
// Trigger: pg_cron at 03:00 UTC weekdays.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getShortInterest, isShortInterestConfigured, upsertShortInterest, type ShortInterestSnapshot } from "../_shared/short-interest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const HARD_CAP = 300;
const REQUEST_DELAY_MS = 1100;
const FAIL_STREAK_LIMIT = 5;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function writeHeartbeat(supabase: ReturnType<typeof createClient>, status: string, notes: string, durationMs: number) {
  try {
    await supabase.from("cron_heartbeat").upsert({
      job_name: "refresh-short-interest",
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status, notes, duration_ms: durationMs,
    }, { onConflict: "job_name" });
  } catch (e) { console.warn("heartbeat write failed", e); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();

  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!cronSecret || !provided || provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!isShortInterestConfigured()) {
    await writeHeartbeat(supabase, "skipped", "FINNHUB_API_KEY not configured", Date.now() - started);
    return new Response(JSON.stringify({ ok: false, reason: "no api key" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const universe = new Set<string>();
  try {
    const { data: scanLog } = await supabase
      .from("scan_universe_log")
      .select("sample_tickers")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const sample = (scanLog?.sample_tickers ?? {}) as Record<string, unknown>;
    const tickers = Array.isArray(sample) ? sample : Object.values(sample).flat();
    for (const t of tickers as unknown[]) {
      if (typeof t === "string" && /^[A-Z]{1,10}$/.test(t)) universe.add(t);
    }
  } catch (e) { console.warn("scan_universe_log fetch err", e); }

  try {
    const { data: wl } = await supabase.from("watchlist").select("ticker");
    for (const r of (wl ?? []) as Array<{ ticker: string }>) {
      if (r.ticker && /^[A-Z]{1,10}$/.test(r.ticker.toUpperCase())) universe.add(r.ticker.toUpperCase());
    }
  } catch (e) { console.warn("watchlist fetch err", e); }

  try {
    const { data: pos } = await supabase
      .from("virtual_positions").select("ticker").eq("status", "open");
    for (const r of (pos ?? []) as Array<{ ticker: string }>) {
      if (r.ticker && /^[A-Z]{1,10}$/.test(r.ticker.toUpperCase())) universe.add(r.ticker.toUpperCase());
    }
  } catch (e) { console.warn("virtual_positions fetch err", e); }

  const tickers = Array.from(universe).slice(0, HARD_CAP);
  console.log(`refresh-short-interest: ${tickers.length} tickers (capped at ${HARD_CAP})`);

  const fetched: ShortInterestSnapshot[] = [];
  let failStreak = 0;
  let degraded = false;

  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i];
    try {
      const si = await getShortInterest(t);
      if (si) { fetched.push(si); failStreak = 0; }
      else failStreak++;
    } catch (e) {
      console.warn(`si fetch ${t} threw`, e);
      failStreak++;
    }
    if (failStreak >= FAIL_STREAK_LIMIT) {
      degraded = true;
      console.warn(`si: ${FAIL_STREAK_LIMIT} consecutive failures, exiting at ${i + 1}/${tickers.length}`);
      break;
    }
    if (i < tickers.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  const upserted = await upsertShortInterest(fetched);
  const durationMs = Date.now() - started;
  const status = degraded ? "degraded" : (fetched.length > 0 ? "ok" : "empty");
  const notes = `attempted=${tickers.length} fetched=${fetched.length} upserted=${upserted}${degraded ? " (early exit)" : ""}`;
  await writeHeartbeat(supabase, status, notes, durationMs);

  return new Response(JSON.stringify({
    ok: true, attempted: tickers.length, fetched: fetched.length, upserted, degraded, duration_ms: durationMs,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
