// ============================================================================
// MANAGE-MODELS — Milestone 5
// Runs nightly after calibrate-weights + train-user-models. Handles the full
// Champion/Challenger lifecycle plus the daily engine-health report.
//
//   1. Score shadow metrics — replay each open challenger against recently
//      closed signal_outcomes (out-of-training paper predictions).
//   2. Stress-test challengers — replay against market_memory regime buckets.
//   3. Promote/rollback — challengers with pass stress + ≥shadow_days better
//      logloss than champion get promoted; auto-rollback if new champion's
//      calibration error jumps > threshold.
//   4. Write model_health_reports — daily engine-health snapshot.
//
// One cron beyond calibrate/user-models. Pure closed-form maths.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { predictEnsemble, type EnsembleModel } from "../_shared/ensemble.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SHADOW_WINDOW_DAYS = 3;           // paper-trade at least 3 days before promotion
const STRESS_MIN_LOGLOSS_MARGIN = 1.10; // challenger regime logLoss ≤ champion * 1.10 required
const PROMOTE_MIN_IMPROVEMENT = 0.005;  // absolute logLoss improvement vs champion
const ROLLBACK_CALIB_ERROR = 0.20;      // trigger rollback if calibration error jumps this much
const DEFAULT_LOGLOSS_BASELINE = 0.693; // log(2) — random guess reference when no champion

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function evaluate(preds: number[], y: number[]) {
  const n = preds.length;
  if (n === 0) return { n: 0, logLoss: null, brier: null, accuracy: null, calibError: null };
  let ll = 0, br = 0, correct = 0;
  const buckets: Record<string, { pSum: number; ySum: number; n: number }> = {};
  for (let i = 0; i < n; i++) {
    const p = clamp(preds[i], 1e-6, 1 - 1e-6);
    ll += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
    br += (p - y[i]) ** 2;
    if ((p >= 0.5 ? 1 : 0) === y[i]) correct++;
    const b = String(Math.min(9, Math.floor(p * 10)));
    (buckets[b] ??= { pSum: 0, ySum: 0, n: 0 });
    buckets[b].pSum += p; buckets[b].ySum += y[i]; buckets[b].n += 1;
  }
  let calibErr = 0, calibN = 0;
  for (const b of Object.values(buckets)) {
    if (b.n < 5) continue;
    calibErr += (b.n / n) * Math.abs(b.pSum / b.n - b.ySum / b.n);
    calibN += b.n;
  }
  return {
    n,
    logLoss: ll / n,
    brier: br / n,
    accuracy: correct / n,
    calibError: calibN > 0 ? calibErr : null,
  };
}

function coefsToModel(row: any): EnsembleModel | null {
  try {
    const c = row.coefficients ?? {};
    if (!c.meta || !c.featureMeans || !c.featureStds) return null;
    return {
      featureNames: row.feature_list ?? [],
      featureMeans: c.featureMeans,
      featureStds: c.featureStds,
      logistic: c.logistic ?? null,
      nb: c.nb ?? null,
      ridge: c.ridge ?? null,
      tree: c.tree ?? null,
      meta: c.meta,
      isotonic: c.isotonic ?? [],
      platt: c.platt ?? { a: 1, b: 0 },
      regimeMetaWeights: c.regimeMetaWeights ?? {},
      training: {
        trainedAt: row.created_at,
        sampleSize: row.validation_metrics?.holdout?.n ?? 0,
        holdoutReport: row.validation_metrics?.holdout ?? { n: 0, logLoss: 0, brier: 0, accuracy: 0 },
        perModel: row.validation_metrics?.perModel ?? {},
        featureSampleSize: row.validation_metrics?.featureSampleSize ?? [],
      },
    };
  } catch {
    return null;
  }
}

function flattenSnap(snap: Record<string, unknown> | null | undefined): Record<string, number> {
  if (!snap) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v ? 1 : 0;
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try { await requireCronOrUser(req); } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const report: Record<string, unknown> = { steps: {} };

  try {
    // ── Load current champion + open challengers per model_kind ─────────────
    const { data: models } = await supabase
      .from("model_versions")
      .select("*")
      .in("status", ["champion", "challenger"])
      .order("created_at", { ascending: false })
      .limit(50);
    const champions: Record<string, any> = {};
    const challengers: any[] = [];
    for (const m of (models ?? [])) {
      if (m.status === "champion" && !champions[m.model_kind]) champions[m.model_kind] = m;
      if (m.status === "challenger") challengers.push(m);
    }

    // ── STEP 1. Shadow scoring — replay each challenger over recently closed
    //           signal_outcomes (rows with feature_snapshot & realized_pnl_pct)
    //           that were closed AFTER the challenger's training window ended.
    const sinceIso = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const { data: recentClosed } = await supabase
      .from("signal_outcomes")
      .select("id, conviction, realized_pnl_pct, strategy, regime, regime_probs, feature_snapshot, entry_date, exit_date")
      .eq("status", "closed")
      .gte("exit_date", sinceIso)
      .not("feature_snapshot", "is", null)
      .not("realized_pnl_pct", "is", null)
      .limit(5000);
    const rowsAll = (recentClosed ?? []) as any[];
    report.steps = { ...(report.steps as any), shadow_rows_available: rowsAll.length };

    const shadowSummaries: Record<string, any> = {};
    for (const ch of challengers) {
      const model = coefsToModel(ch);
      if (!model) { shadowSummaries[ch.id] = { skipped: "no_model" }; continue; }
      const trainEnd = ch.training_window_end ? new Date(ch.training_window_end).getTime() : 0;
      const rows = rowsAll.filter((r) => {
        const exit = r.exit_date ? new Date(r.exit_date).getTime() : 0;
        return exit > trainEnd; // strictly out-of-sample
      });
      if (rows.length < 30) {
        await supabase.from("model_versions")
          .update({ shadow_metrics: { n: rows.length, insufficient: true, evaluated_at: new Date().toISOString() } })
          .eq("id", ch.id);
        shadowSummaries[ch.id] = { insufficient: true, n: rows.length };
        continue;
      }
      const preds: number[] = [];
      const ys: number[] = [];
      for (const r of rows) {
        const features = { conviction: Number(r.conviction) || 0, ...flattenSnap(r.feature_snapshot) };
        const p = predictEnsemble(model, features, { regime: r.regime, regimeProbs: r.regime_probs });
        if (Number.isFinite(p)) {
          preds.push(p);
          ys.push(Number(r.realized_pnl_pct) > 0 ? 1 : 0);
        }
      }
      const metrics = evaluate(preds, ys);
      const ageDays = (Date.now() - new Date(ch.created_at).getTime()) / (24 * 3600 * 1000);
      const shadow = { ...metrics, age_days: Math.round(ageDays * 10) / 10, evaluated_at: new Date().toISOString() };
      await supabase.from("model_versions").update({ shadow_metrics: shadow }).eq("id", ch.id);
      shadowSummaries[ch.id] = shadow;
    }

    // ── STEP 2. Stress-test — replay each challenger over regime buckets in
    //           market_memory. Reject if any large-enough bucket blows up.
    const { data: memRaw } = await supabase
      .from("market_memory")
      .select("features, regime_probs, outcome_win, outcome_return_pct, strategy")
      .not("features", "is", null)
      .not("outcome_return_pct", "is", null)
      .limit(20000);
    const mem = (memRaw ?? []) as any[];
    const stressSummaries: Record<string, any> = {};
    for (const ch of challengers) {
      const model = coefsToModel(ch);
      if (!model) continue;
      if (mem.length < 200) {
        const stress = { skipped: true, reason: "insufficient_memory", n: mem.length };
        await supabase.from("model_versions").update({ stress_test_results: stress }).eq("id", ch.id);
        stressSummaries[ch.id] = stress;
        continue;
      }
      // Bucket by dominant regime (fallback to "unknown")
      const buckets: Record<string, { preds: number[]; ys: number[] }> = {};
      for (const r of mem) {
        const rp = (r.regime_probs ?? {}) as Record<string, number>;
        let dom = "unknown", best = 0;
        for (const [k, v] of Object.entries(rp)) if (v > best) { best = v; dom = k; }
        const p = predictEnsemble(model, flattenSnap(r.features), { regime: dom, regimeProbs: rp });
        if (!Number.isFinite(p)) continue;
        const y = r.outcome_win == null ? (Number(r.outcome_return_pct) > 0 ? 1 : 0) : (r.outcome_win ? 1 : 0);
        (buckets[dom] ??= { preds: [], ys: [] });
        buckets[dom].preds.push(p);
        buckets[dom].ys.push(y);
      }
      const perRegime: Record<string, any> = {};
      let worstLogLoss = 0; let pass = true; let reason: string | null = null;
      const champLogLoss = champions[ch.model_kind]?.validation_metrics?.holdout?.logLoss ?? DEFAULT_LOGLOSS_BASELINE;
      const threshold = champLogLoss * STRESS_MIN_LOGLOSS_MARGIN;
      for (const [reg, b] of Object.entries(buckets)) {
        const m = evaluate(b.preds, b.ys);
        perRegime[reg] = m;
        if (b.preds.length >= 100 && m.logLoss != null) {
          if (m.logLoss > worstLogLoss) worstLogLoss = m.logLoss;
          if (m.logLoss > threshold) { pass = false; reason = `regime=${reg} logLoss=${m.logLoss.toFixed(3)} > ${threshold.toFixed(3)}`; }
        }
      }
      const stress = {
        pass, reason, threshold, champion_baseline: champLogLoss, worst_regime_logloss: worstLogLoss,
        per_regime: perRegime, evaluated_at: new Date().toISOString(),
      };
      await supabase.from("model_versions").update({ stress_test_results: stress }).eq("id", ch.id);
      stressSummaries[ch.id] = { pass, reason, worstLogLoss };
    }

    // ── STEP 3. Promotion — pick the newest challenger per kind that satisfies
    //           shadow-days, non-inferior shadow logloss, and stress-test pass.
    const promotions: any[] = [];
    for (const kind of Object.keys(
      challengers.reduce((a, c) => ((a[c.model_kind] = true), a), {} as Record<string, boolean>),
    )) {
      const eligible = challengers.filter((c) => c.model_kind === kind);
      // pick oldest challenger with enough shadow_days first
      eligible.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const champ = champions[kind];
      const champLogLoss = champ?.validation_metrics?.holdout?.logLoss ?? DEFAULT_LOGLOSS_BASELINE;
      for (const ch of eligible) {
        const shadow = ch.shadow_metrics ?? shadowSummaries[ch.id];
        const stress = ch.stress_test_results ?? stressSummaries[ch.id];
        const ageDays = (Date.now() - new Date(ch.created_at).getTime()) / (24 * 3600 * 1000);
        if (ageDays < SHADOW_WINDOW_DAYS) { promotions.push({ id: ch.id, kind, decision: "wait_shadow", ageDays }); continue; }
        if (!shadow || shadow.insufficient || shadow.logLoss == null) { promotions.push({ id: ch.id, kind, decision: "no_shadow" }); continue; }
        if (!stress || stress.skipped || stress.pass === false) { promotions.push({ id: ch.id, kind, decision: "stress_fail", reason: stress?.reason }); continue; }
        if (shadow.logLoss > champLogLoss - PROMOTE_MIN_IMPROVEMENT) {
          promotions.push({ id: ch.id, kind, decision: "not_better", shadow: shadow.logLoss, champ: champLogLoss });
          continue;
        }
        // Promote.
        if (champ) {
          await supabase.from("model_versions")
            .update({ status: "retired", retired_at: new Date().toISOString() })
            .eq("id", champ.id);
        }
        await supabase.from("model_versions")
          .update({ status: "champion", deployed_at: new Date().toISOString(), parent_version_id: champ?.id ?? null })
          .eq("id", ch.id);
        // Retire other stale challengers of same kind
        await supabase.from("model_versions")
          .update({ status: "retired", retired_at: new Date().toISOString() })
          .eq("model_kind", kind).eq("status", "challenger").neq("id", ch.id);
        promotions.push({ id: ch.id, kind, decision: "promoted", improvement: champLogLoss - shadow.logLoss });
        break; // only one champion per kind per run
      }
    }

    // ── STEP 3b. Auto-rollback — if current champion's out-of-sample
    //           calibration error jumps > ROLLBACK_CALIB_ERROR vs its own
    //           holdout, revert to most recent 'retired' predecessor.
    const rollbacks: any[] = [];
    const { data: liveChamps } = await supabase.from("model_versions").select("*").eq("status", "champion");
    for (const champ of (liveChamps ?? [])) {
      const model = coefsToModel(champ);
      if (!model) continue;
      const rows = rowsAll.filter((r) => {
        const exit = r.exit_date ? new Date(r.exit_date).getTime() : 0;
        return exit > new Date(champ.deployed_at ?? champ.created_at).getTime();
      });
      if (rows.length < 40) continue;
      const preds: number[] = [], ys: number[] = [];
      for (const r of rows) {
        const p = predictEnsemble(model, { conviction: Number(r.conviction) || 0, ...flattenSnap(r.feature_snapshot) }, { regime: r.regime, regimeProbs: r.regime_probs });
        if (Number.isFinite(p)) { preds.push(p); ys.push(Number(r.realized_pnl_pct) > 0 ? 1 : 0); }
      }
      const live = evaluate(preds, ys);
      const holdoutCE = champ.validation_metrics?.holdout?.calibError ?? null;
      if (live.calibError != null && holdoutCE != null && live.calibError - holdoutCE > ROLLBACK_CALIB_ERROR) {
        // Rollback: retire current, revive most recent retired of same kind.
        const { data: prev } = await supabase.from("model_versions")
          .select("id").eq("model_kind", champ.model_kind).eq("status", "retired")
          .order("retired_at", { ascending: false }).limit(1).maybeSingle();
        await supabase.from("model_versions")
          .update({ status: "retired", retired_at: new Date().toISOString(),
                    notes: `auto-rollback: liveCE=${live.calibError.toFixed(3)} vs holdout=${holdoutCE.toFixed(3)}` })
          .eq("id", champ.id);
        if (prev?.id) {
          await supabase.from("model_versions")
            .update({ status: "champion", deployed_at: new Date().toISOString(), retired_at: null })
            .eq("id", prev.id);
          rollbacks.push({ retired: champ.id, restored: prev.id, kind: champ.model_kind });
        } else {
          rollbacks.push({ retired: champ.id, restored: null, kind: champ.model_kind, note: "no_predecessor" });
        }
      }
    }

    // ── STEP 4. Write model_health_reports row for today ────────────────────
    // Roll up champion out-of-sample metrics + drift + promotion/rollback log.
    const { data: latestChampion } = await supabase
      .from("model_versions").select("*").eq("status", "champion").eq("model_kind", "ensemble").maybeSingle();

    let health: any = { n: 0 };
    if (latestChampion) {
      const model = coefsToModel(latestChampion);
      if (model && rowsAll.length) {
        const preds: number[] = [], ys: number[] = [];
        for (const r of rowsAll) {
          const p = predictEnsemble(model, { conviction: Number(r.conviction) || 0, ...flattenSnap(r.feature_snapshot) }, { regime: r.regime, regimeProbs: r.regime_probs });
          if (Number.isFinite(p)) { preds.push(p); ys.push(Number(r.realized_pnl_pct) > 0 ? 1 : 0); }
        }
        health = evaluate(preds, ys);
      }
    }

    const { data: driftRows } = await supabase.from("drift_detections")
      .select("*").order("detected_at", { ascending: false }).limit(20);
    const featureDrift = (driftRows ?? []).filter((d: any) => d.drift_type === "feature");
    const conceptDrift = (driftRows ?? []).filter((d: any) => d.drift_type === "concept");

    await supabase.from("model_health_reports").insert({
      report_date: new Date().toISOString().slice(0, 10),
      calibration_error: health.calibError,
      brier_score: health.brier,
      log_loss: health.logLoss,
      feature_drift: featureDrift,
      concept_drift: conceptDrift,
      top_features: latestChampion?.validation_metrics?.perModel ?? {},
      bottom_features: {},
      deployments: promotions.filter((p) => p.decision === "promoted"),
      rollbacks,
      retired_strategies: [],
      training_time_ms: Date.now() - startedAt,
      anomalies_rejected: 0,
      notes: JSON.stringify({
        champion_id: latestChampion?.id ?? null,
        shadow_evaluated: Object.keys(shadowSummaries).length,
        stress_evaluated: Object.keys(stressSummaries).length,
        promotions,
      }),
    });

    await recordHeartbeat("manage-models", startedAt, "ok",
      `challengers=${challengers.length} promoted=${promotions.filter((p) => p.decision === "promoted").length} rollbacks=${rollbacks.length}`);

    return new Response(JSON.stringify({
      ok: true,
      challengers: challengers.length,
      champions: Object.keys(champions).length,
      promotions,
      rollbacks,
      health,
      ms: Date.now() - startedAt,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[manage-models] fatal:", msg);
    await recordHeartbeat("manage-models", startedAt, "error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
