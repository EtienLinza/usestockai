// ============================================================================
// REFRESH-EPS-REVISIONS — nightly cron that pulls EPS estimate revision
// momentum for the union of scan universe + watchlists + open positions, and
// upserts into the `eps_revisions` table. Free-tier safe: throttled to ~1
// req/sec, hard-capped, exits early on repeated auth/rate-limit failures.
//
// Mirrors refresh-danelfin-scores. Trigger: pg_cron at 02:45 UTC weekdays.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getEpsRevision, isEpsRevisionsConfigured, upsertEpsRevisions, type EpsRevision } from "../_shared/eps-revisions.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase-client.ts";

const HARD_CAP = 300;
const REQUEST_DELAY_MS = 1100;
const FAIL_STREAK_LIMIT = 5;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function writeHeartbeat(supabase: any, status: string, notes: string, durationMs: number) {
  try {
    await supabase.from("cron_heartbeat").upsert({
      job_name: "refresh-eps-revisions",
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status,
      notes,
      duration_ms: durationMs,
    }, { onConflict: "job_name" });
  } catch (e) { console.warn("heartbeat write failed", e); }
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const started = Date.now();

  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!cronSecret || !provided || provided !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = adminClient();

  if (!isEpsRevisionsConfigured()) {
    await writeHeartbeat(supabase, "skipped", "FINNHUB_API_KEY not configured", Date.now() - started);
    return jsonResponse({ ok: false, reason: "no api key" });
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
  console.log(`refresh-eps-revisions: ${tickers.length} tickers (capped at ${HARD_CAP})`);

  const fetched: EpsRevision[] = [];
  let failStreak = 0;
  let degraded = false;

  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i];
    try {
      const rev = await getEpsRevision(t);
      if (rev) { fetched.push(rev); failStreak = 0; }
      else failStreak++;
    } catch (e) {
      console.warn(`eps fetch ${t} threw`, e);
      failStreak++;
    }
    if (failStreak >= FAIL_STREAK_LIMIT) {
      degraded = true;
      console.warn(`eps: ${FAIL_STREAK_LIMIT} consecutive failures, exiting at ${i + 1}/${tickers.length}`);
      break;
    }
    if (i < tickers.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  const upserted = await upsertEpsRevisions(fetched);
  const durationMs = Date.now() - started;
  const status = degraded ? "degraded" : (fetched.length > 0 ? "ok" : "empty");
  const notes = `attempted=${tickers.length} fetched=${fetched.length} upserted=${upserted}${degraded ? " (early exit)" : ""}`;
  await writeHeartbeat(supabase, status, notes, durationMs);

  return jsonResponse({
    ok: true, attempted: tickers.length, fetched: fetched.length, upserted, degraded, duration_ms: durationMs,
  });
});
