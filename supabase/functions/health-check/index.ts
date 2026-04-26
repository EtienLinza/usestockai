// ============================================================================
// HEALTH-CHECK — system-health snapshot for the ops UI.
// Reports each known scheduled job's last heartbeat, age, and freshness state.
// Public (no JWT required) so the landing/status page can ping it, but it
// only reveals job names + timestamps, never user data.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface JobConfig {
  name: string;
  // Maximum acceptable age in minutes during market hours before we flag it
  // as stale. After hours, we relax to 12h for any market-hours job.
  maxAgeMinutesMarket: number;
  // Always-on jobs (e.g. nightly digest) keep the same threshold 24/7.
  alwaysOn?: boolean;
}

const KNOWN_JOBS: JobConfig[] = [
  { name: "market-scanner", maxAgeMinutesMarket: 30 },
  { name: "check-price-alerts", maxAgeMinutesMarket: 20 },
  { name: "check-sell-alerts", maxAgeMinutesMarket: 20 },
  { name: "autotrader-scan", maxAgeMinutesMarket: 30 },
  { name: "calibrate-weights", maxAgeMinutesMarket: 60 * 24 + 60, alwaysOn: true },
  { name: "weekly-digest", maxAgeMinutesMarket: 60 * 24 * 7 + 60, alwaysOn: true },
];

function isMarketHoursUTC(d: Date): boolean {
  // Rough US market hours: Mon-Fri 13:30–20:00 UTC (9:30-16:00 ET, ignoring DST).
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= 13 * 60 + 30 && minutes <= 20 * 60;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(JSON.stringify({ error: "Backend not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(url, key);
    const { data: rows, error } = await supabase
      .from("cron_heartbeat")
      .select("job_name, last_run_at, duration_ms, status, notes");
    if (error) throw error;

    const byName = new Map((rows ?? []).map((r) => [r.job_name, r]));
    const now = new Date();
    const marketOpen = isMarketHoursUTC(now);

    const jobs = KNOWN_JOBS.map((cfg) => {
      const row = byName.get(cfg.name);
      if (!row) {
        return {
          name: cfg.name,
          status: "unknown" as const,
          lastRunAt: null,
          ageMinutes: null,
          durationMs: null,
          message: "No heartbeat recorded yet.",
        };
      }
      const last = new Date(row.last_run_at);
      const ageMin = Math.round((now.getTime() - last.getTime()) / 60_000);
      const threshold = cfg.alwaysOn || marketOpen
        ? cfg.maxAgeMinutesMarket
        : 12 * 60; // after-hours grace for market-hours jobs
      let state: "healthy" | "stale" | "error" = "healthy";
      if (row.status === "error") state = "error";
      else if (ageMin > threshold) state = "stale";
      return {
        name: cfg.name,
        status: state,
        lastRunAt: row.last_run_at,
        ageMinutes: ageMin,
        durationMs: row.duration_ms,
        message: row.notes ?? null,
      };
    });

    const overall = jobs.some((j) => j.status === "error")
      ? "degraded"
      : jobs.some((j) => j.status === "stale" || j.status === "unknown")
      ? "warn"
      : "healthy";

    return new Response(
      JSON.stringify({
        overall,
        marketOpen,
        checkedAt: now.toISOString(),
        jobs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("health-check failed:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
