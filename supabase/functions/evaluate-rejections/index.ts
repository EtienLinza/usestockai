// ============================================================================
// EVALUATE-REJECTIONS — nightly "were we right to say no?" audit.
//
// `label-rejected-signals` already prices what each rejected candidate would
// have done. Nothing until now read those labels back. This job does:
//
//   1. Group labeled rejections from the trailing window by rejection_reason.
//   2. Compute would-have-won rate, mean counterfactual return, target/stop
//      hit rates → write one `rejection_accuracy` row per reason.
//   3. Turn a clearly-too-strict gate into a small, clamped delta in
//      `gate_adjustments`, which live code reads through
//      `_shared/gate-adjustments.ts`.
//
// Deltas move at most one step per night and are clamped both here and in the
// resolver, so the gates can drift but never fly open.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { GATE_CLAMPS, type GateKey } from "../_shared/gate-adjustments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const WINDOW_DAYS = 90;
const MIN_SAMPLE = 25;      // below this we report but never move a gate
const STEP = { conviction_floor: 1, earnings_blackout_days: 1, correlation_threshold: 0.02 };

/** Which gate each rejection reason controls. Reasons with no gate are report-only. */
const REASON_TO_GATE: Record<string, GateKey> = {
  below_conviction_floor: "conviction_floor",
  below_cross_sectional_rank: "conviction_floor",
  earnings_blackout: "earnings_blackout_days",
  correlation_gate: "correlation_threshold",
  correlated_position: "correlation_threshold",
};

interface Agg {
  n: number; wins: number; sumRet: number; target: number; stop: number;
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
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from("rejected_signals")
      .select("rejection_reason, counterfactual_return_pct, counterfactual_hit_target, counterfactual_hit_stop")
      .not("labeled_at", "is", null)
      .not("counterfactual_return_pct", "is", null)
      .gte("created_at", since)
      .limit(20000);
    if (error) throw error;

    const byReason = new Map<string, Agg>();
    for (const r of rows ?? []) {
      const reason = String((r as any).rejection_reason ?? "unknown");
      const a = byReason.get(reason) ?? { n: 0, wins: 0, sumRet: 0, target: 0, stop: 0 };
      const ret = Number((r as any).counterfactual_return_pct);
      a.n += 1;
      a.sumRet += ret;
      if (ret > 0) a.wins += 1;
      if ((r as any).counterfactual_hit_target) a.target += 1;
      if ((r as any).counterfactual_hit_stop) a.stop += 1;
      byReason.set(reason, a);
    }

    if (byReason.size === 0) {
      await recordHeartbeat("evaluate-rejections", started, "ok", "no labeled rejections in window");
      return new Response(JSON.stringify({ ok: true, reasons: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 1. Report rows ───────────────────────────────────────────────────
    const reportRows: Record<string, unknown>[] = [];
    const verdicts: Record<string, string> = {};
    for (const [reason, a] of byReason.entries()) {
      const winRate = a.wins / a.n;
      const avgRet = a.sumRet / a.n;
      // A gate is "too strict" when the trades it blocked would have been
      // materially profitable on average AND won more often than not.
      let verdict = "ok";
      if (a.n >= MIN_SAMPLE) {
        if (winRate >= 0.58 && avgRet >= 0.5) verdict = "too_strict";
        else if (winRate <= 0.42 && avgRet <= -0.5) verdict = "well_calibrated";
      } else {
        verdict = "insufficient_sample";
      }
      verdicts[reason] = verdict;
      reportRows.push({
        window_days: WINDOW_DAYS,
        rejection_reason: reason,
        sample_size: a.n,
        would_win_rate: Math.round(winRate * 10000) / 10000,
        avg_return_pct: Math.round(avgRet * 1000) / 1000,
        hit_target_rate: Math.round((a.target / a.n) * 10000) / 10000,
        hit_stop_rate: Math.round((a.stop / a.n) * 10000) / 10000,
        verdict,
        notes: { min_sample: MIN_SAMPLE },
      });
    }
    const { error: ie } = await supabase.from("rejection_accuracy").insert(reportRows);
    if (ie) console.error("[evaluate-rejections] report insert:", ie.message);

    // ─── 2. Gate deltas (one clamped step per night) ──────────────────────
    const { data: current } = await supabase
      .from("gate_adjustments").select("gate_key, delta, sample_size");
    const currentMap = new Map<string, number>();
    for (const g of current ?? []) currentMap.set(String((g as any).gate_key), Number((g as any).delta ?? 0));

    // Aggregate verdicts per gate — several reasons can feed the same gate.
    const gateVotes = new Map<GateKey, { loosen: number; keep: number; n: number; reasons: string[] }>();
    for (const [reason, a] of byReason.entries()) {
      const gate = REASON_TO_GATE[reason];
      if (!gate || a.n < MIN_SAMPLE) continue;
      const v = gateVotes.get(gate) ?? { loosen: 0, keep: 0, n: 0, reasons: [] };
      if (verdicts[reason] === "too_strict") v.loosen += 1;
      if (verdicts[reason] === "well_calibrated") v.keep += 1;
      v.n += a.n;
      v.reasons.push(reason);
      gateVotes.set(gate, v);
    }

    const gateRows: Record<string, unknown>[] = [];
    for (const [gate, v] of gateVotes.entries()) {
      const clamp = GATE_CLAMPS[gate];
      const step = STEP[gate];
      const prev = currentMap.get(gate) ?? 0;
      let next = prev;
      let rationale: string;
      if (v.loosen > v.keep) {
        // Blocked trades were winners → ease the gate one step.
        next = prev - step;
        rationale = `loosen: ${v.reasons.join(",")} blocked profitable candidates (n=${v.n})`;
      } else if (v.keep > v.loosen) {
        // Gate is doing its job → decay any accumulated loosening back to 0.
        next = prev < 0 ? Math.min(0, prev + step) : prev > 0 ? Math.max(0, prev - step) : 0;
        rationale = `well calibrated: decaying adjustment toward neutral (n=${v.n})`;
      } else {
        rationale = `no clear verdict (n=${v.n})`;
      }
      next = Math.max(clamp.min, Math.min(clamp.max, Math.round(next * 1000) / 1000));
      gateRows.push({
        gate_key: gate, delta: next,
        min_delta: clamp.min, max_delta: clamp.max,
        sample_size: v.n, rationale, updated_at: new Date().toISOString(),
      });
    }
    if (gateRows.length > 0) {
      const { error: ge } = await supabase
        .from("gate_adjustments").upsert(gateRows, { onConflict: "gate_key" });
      if (ge) console.error("[evaluate-rejections] gate upsert:", ge.message);
    }

    const ms = Date.now() - started;
    await recordHeartbeat("evaluate-rejections", started, "ok",
      `reasons=${reportRows.length} gates=${gateRows.length} ${ms}ms`);
    return new Response(JSON.stringify({
      ok: true, reasons: reportRows.length, gates: gateRows, verdicts, ms,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[evaluate-rejections] fatal:", msg);
    await recordHeartbeat("evaluate-rejections", started, "error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
