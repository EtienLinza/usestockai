// ============================================================================
// REFRESH-DANELFIN-SCORES — nightly cron that pulls Danelfin AI Scores for
// the union of scan universe + watchlists + open positions, and upserts them
// into the `danelfin_scores` table. Free-tier safe: throttled to ~1 req/sec,
// hard-capped, exits early on repeated auth/rate-limit failures.
//
// Trigger: pg_cron at 22:30 ET on weekdays (header x-cron-secret).
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAiScore, isDanelfinConfigured, upsertDanelfinScores, type DanelfinScore } from "../_shared/danelfin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const HARD_CAP = 300;          // max tickers per run (free-tier budget)
const REQUEST_DELAY_MS = 1100; // ~0.9 req/sec
const FAIL_STREAK_LIMIT = 3;   // exit early after 3 consecutive 401/402/429

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function writeHeartbeat(supabase: any, status: string, notes: string, durationMs: number) {
  try {
    await supabase.from("cron_heartbeat").upsert({
      job_name: "refresh-danelfin-scores",
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status,
      notes,
      duration_ms: durationMs,
    }, { onConflict: "job_name" });
  } catch (e) {
    console.warn("heartbeat write failed", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();

  // Cron auth — require BOTH the secret to be configured AND a matching header.
  // (The previous `cronSecret && provided !== cronSecret` check let anyone in
  // when CRON_SECRET was not yet configured.)
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

  if (!isDanelfinConfigured()) {
    await writeHeartbeat(supabase, "skipped", "DANELFIN_API_KEY not configured", Date.now() - started);
    return new Response(JSON.stringify({ ok: false, reason: "no api key" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Build ticker universe ────────────────────────────────────────────────
  const universe = new Set<string>();

  // Latest scan universe sample
  try {
    const { data: scanLog } = await supabase
      .from("scan_universe_log")
      .select("sample_tickers")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sample = (scanLog?.sample_tickers ?? {}) as Record<string, unknown>;
    const tickers = Array.isArray(sample) ? sample : Object.values(sample).flat();
    for (const t of tickers as unknown[]) {
      if (typeof t === "string" && /^[A-Z]{1,10}(-[A-Z]{2,4})?$/.test(t)) universe.add(t);
    }
  } catch (e) { console.warn("scan_universe_log fetch err", e); }

  // All watchlist tickers
  try {
    const { data: wl } = await supabase.from("watchlist").select("ticker");
    for (const r of (wl ?? []) as Array<{ ticker: string }>) {
      if (r.ticker) universe.add(r.ticker.toUpperCase());
    }
  } catch (e) { console.warn("watchlist fetch err", e); }

  // All open virtual positions
  try {
    const { data: pos } = await supabase
      .from("virtual_positions")
      .select("ticker")
      .eq("status", "open");
    for (const r of (pos ?? []) as Array<{ ticker: string }>) {
      if (r.ticker) universe.add(r.ticker.toUpperCase());
    }
  } catch (e) { console.warn("virtual_positions fetch err", e); }

  // Only ~90 tickers fit in one 110s budget, so refresh the *stalest* first
  // and skip anything already scored in the last 2 days. Consecutive runs then
  // rotate through the whole universe instead of re-fetching the same head.
  const freshSet = new Set<string>();
  try {
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const { data: recent } = await supabase
      .from("danelfin_scores")
      .select("ticker")
      .gte("as_of", cutoff);
    for (const r of (recent ?? []) as Array<{ ticker: string }>) freshSet.add(r.ticker.toUpperCase());
  } catch (e) { console.warn("danelfin freshness fetch err", e); }

  const tickers = Array.from(universe).filter(t => !freshSet.has(t)).slice(0, HARD_CAP);
  console.log(`refresh-danelfin-scores: ${tickers.length} stale tickers (${freshSet.size} already fresh)`);


  // ── Fetch loop with throttling + fail-streak guard ───────────────────────
  const fetched: Array<DanelfinScore & { ticker: string }> = [];
  // Same distinction as the EPS job: a null is usually "no Danelfin coverage
  // for this ticker" (US-only, large-cap biased), not an outage. Only thrown
  // errors abort quickly.
  const EMPTY_STREAK_LIMIT = 40;
  let errStreak = 0;
  let emptyStreak = 0;
  let degraded = false;


  // Edge functions are killed at 150s of wall time, and the old code only
  // persisted after the whole loop — so a 300-ticker run at ~1 req/s always
  // died before writing anything. Flush incrementally and stop early.
  const TIME_BUDGET_MS = 110_000;
  const FLUSH_EVERY = 25;
  let upserted = 0;
  let processed = 0;
  const flush = async () => {
    if (fetched.length === 0) return;
    upserted += await upsertDanelfinScores(fetched.splice(0, fetched.length));
  };

  for (let i = 0; i < tickers.length; i++) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      console.log(`danelfin: time budget reached at ${i}/${tickers.length}`);
      break;
    }
    const t = tickers[i];
    processed = i + 1;
    try {
      const score = await getAiScore(t);
      if (score) {
        fetched.push({ ...score, ticker: t });
        errStreak = 0;
        emptyStreak = 0;
      } else {
        emptyStreak++;
        errStreak = 0;
      }
    } catch (e) {
      console.warn(`danelfin fetch ${t} threw`, e);
      errStreak++;
    }
    if (fetched.length >= FLUSH_EVERY) await flush();
    if (errStreak >= FAIL_STREAK_LIMIT || emptyStreak >= EMPTY_STREAK_LIMIT) {
      degraded = true;
      console.warn(`danelfin: aborting at ${i + 1}/${tickers.length} (errStreak=${errStreak} emptyStreak=${emptyStreak})`);
      break;
    }
    if (i < tickers.length - 1) await sleep(REQUEST_DELAY_MS);
  }
  await flush();
  const durationMs = Date.now() - started;
  const status = degraded ? "degraded" : (upserted > 0 ? "ok" : "empty");
  const notes = `attempted=${processed}/${tickers.length} upserted=${upserted}${degraded ? " (early exit)" : ""}`;
  await writeHeartbeat(supabase, status, notes, durationMs);

  return new Response(JSON.stringify({
    ok: true,
    attempted: processed,
    universe: tickers.length,
    upserted,

    degraded,
    duration_ms: durationMs,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
