// ============================================================================
// DETECT-DRIFT — Milestone 4 nightly drift monitor.
//
// Two flavors:
//   • Feature drift  — PSI (Population Stability Index) comparing the last
//     30d of signal_outcomes.feature_snapshot distributions against a
//     180d baseline (per numeric feature, up to 10 features).
//   • Concept drift  — ADWIN over the daily win-rate series (last 180d
//     of closed signal_outcomes ordered by day).
//
// Writes to `drift_detections`. Callers (scanners, meta-labeler) can react
// by tightening gates or scheduling early retrains.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { detectAdwinDrift } from "../_shared/adwin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const RECENT_DAYS = 30;
const BASELINE_DAYS = 180;
const PSI_BINS = 10;
const PSI_WARN = 0.1;
const PSI_CRIT = 0.25;
const NUMERIC_FEATURES = [
  "atr_pct", "annualized_vol", "macro_score", "sector_bonus",
  "danelfin_score", "eps_revision_score",
];

function psi(recent: number[], baseline: number[], bins = PSI_BINS): number {
  if (recent.length < 20 || baseline.length < 40) return 0;
  const all = [...baseline].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 1; i < bins; i++) {
    edges.push(all[Math.floor((all.length * i) / bins)]);
  }
  const buckets = (xs: number[]) => {
    const c = new Array(bins).fill(0);
    for (const x of xs) {
      let b = 0;
      for (const e of edges) { if (x <= e) break; b++; }
      c[b]++;
    }
    return c.map(n => Math.max(1e-6, n / xs.length));
  };
  const p = buckets(baseline); const q = buckets(recent);
  let s = 0;
  for (let i = 0; i < bins; i++) s += (q[i] - p[i]) * Math.log(q[i] / p[i]);
  return Math.round(s * 10000) / 10000;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireCronOrUser(req);
  if (denied) return denied;

  const started = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const baselineIso = new Date(Date.now() - BASELINE_DAYS * 24 * 3600 * 1000).toISOString();
    const recentIso = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000).toISOString();

    const { data: rows } = await supabase
      .from("signal_outcomes")
      .select("feature_snapshot, closed_at, pnl_pct, status")
      .gte("closed_at", baselineIso)
      .not("feature_snapshot", "is", null)
      .limit(20000);

    const all = (rows ?? []) as any[];
    const detections: Record<string, unknown>[] = [];

    // ── Feature-drift (PSI) ─────────────────────────────────────────────
    for (const feat of NUMERIC_FEATURES) {
      const baseline: number[] = [];
      const recent: number[] = [];
      for (const r of all) {
        const v = Number((r.feature_snapshot ?? {})[feat]);
        if (!Number.isFinite(v)) continue;
        baseline.push(v);
        if (r.closed_at && r.closed_at >= recentIso) recent.push(v);
      }
      const value = psi(recent, baseline);
      if (value >= PSI_WARN) {
        detections.push({
          drift_kind: "feature", metric: "psi", feature_name: feat,
          value, threshold: PSI_WARN,
          severity: value >= PSI_CRIT ? "critical" : "warn",
          window_days: RECENT_DAYS,
          details: { baseline_n: baseline.length, recent_n: recent.length },
        });
      }
    }

    // ── Concept drift (ADWIN over daily win-rate) ───────────────────────
    const closed = all.filter(r => r.status === "closed" && r.pnl_pct != null && r.closed_at);
    const byDay: Record<string, { w: number; n: number }> = {};
    for (const r of closed) {
      const day = String(r.closed_at).slice(0, 10);
      const b = (byDay[day] ??= { w: 0, n: 0 });
      b.n++; if (Number(r.pnl_pct) > 0) b.w++;
    }
    const series = Object.keys(byDay).sort().map(d => byDay[d].w / Math.max(1, byDay[d].n));
    if (series.length >= 40) {
      const adwin = detectAdwinDrift(series);
      if (adwin.drift) {
        detections.push({
          drift_kind: "concept", metric: "adwin", feature_name: "win_rate",
          value: Math.abs(adwin.preMean - adwin.postMean),
          threshold: 0.05,
          severity: adwin.severity === "hard" ? "critical" : "warn",
          window_days: series.length,
          details: adwin as unknown as Record<string, unknown>,
        });
      }
    }

    if (detections.length > 0) {
      const { error: ie } = await supabase.from("drift_detections").insert(detections);
      if (ie) console.error("drift insert:", ie.message);
    }

    const ms = Date.now() - started;
    await recordHeartbeat("detect-drift", started, "ok",
      `detections=${detections.length} rows=${all.length}`);
    return new Response(JSON.stringify({ ok: true, detections: detections.length, rows: all.length, ms }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[detect-drift] fatal:", msg);
    await recordHeartbeat("detect-drift", started, "error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
