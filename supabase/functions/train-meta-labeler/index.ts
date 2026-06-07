// ============================================================================
// TRAIN META-LABELER — nightly cron job.
//
// Pulls the last 180 days of closed `signal_outcomes`, builds a feature
// matrix, and fits a logistic regression via plain-JS gradient descent
// (no deps). Persists the fitted model into `meta_label_model` so the
// runtime engine can use it for secondary filtering.
//
// Cold-start safe: if fewer than 40 closed outcomes exist, exit early —
// the loader returns null and the runtime treats meta-labeling as a no-op.
// ============================================================================

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { META_FEATURE_NAMES, type MetaFeatures } from "../_shared/meta-labeler.ts";

interface OutcomeRow {
  conviction: number | null;
  strategy: string | null;
  regime: string | null;
  realized_pnl_pct: number | null;
  status: string | null;
  exit_reason: string | null;
  entry_date: string | null;
  contributing_rules: any;
}

function dayOfWeek(d: Date): number { return d.getUTCDay(); }
function hourOfDay(d: Date): number {
  // ET hour, approximate (subtract 5h from UTC; ignores DST for simplicity).
  return (d.getUTCHours() + 24 - 5) % 24;
}

function buildFeatures(row: OutcomeRow): MetaFeatures | null {
  const conv = Number(row.conviction);
  if (!Number.isFinite(conv)) return null;
  const cr = row.contributing_rules || {};
  const atrPct = Number(cr.atr_pct ?? cr.atrPct ?? 0.02);
  const relStrength = Number(cr.rel_strength ?? cr.relStrength ?? 0);
  const sectorMomentum = Number(cr.sector_momentum ?? cr.sectorMomentum ?? 0);
  const eps = Number(cr.eps_revision_score ?? 0);
  // AUDIT FIX (#2): use macro regime persisted in contributing_rules
  // (bull_quiet/bull_volatile/bear_quiet/bear_volatile/neutral) rather than
  // the ticker-level `signal_outcomes.regime` (trending/ranging/breakout).
  // Inference passes the same macro regime, so this eliminates train/serve skew.
  const macroRegime = (cr.market_regime as string | null) ?? null;
  const ed = row.entry_date ? new Date(row.entry_date) : new Date();
  return {
    conviction: conv,
    atrPct: Number.isFinite(atrPct) ? atrPct : 0.02,
    relStrength: Number.isFinite(relStrength) ? relStrength : 0,
    sectorMomentum: Number.isFinite(sectorMomentum) ? sectorMomentum : 0,
    epsRevisionScore: Number.isFinite(eps) ? eps : 0,
    regime: macroRegime,
    hourOfDay: hourOfDay(ed),
    dayOfWeek: dayOfWeek(ed),
  };
}

function vectorize(f: MetaFeatures): number[] {
  const r = f.regime ?? "neutral";
  return [
    f.conviction,
    f.atrPct,
    f.relStrength,
    f.sectorMomentum,
    f.epsRevisionScore,
    r === "bull_quiet" ? 1 : 0,
    r === "bull_volatile" ? 1 : 0,
    r === "bear_quiet" ? 1 : 0,
    r === "bear_volatile" ? 1 : 0,
    f.hourOfDay,
    f.dayOfWeek,
  ];
}

function sigmoid(z: number): number {
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z); return e / (1 + e);
}

function standardize(X: number[][]): { Xz: number[][]; means: number[]; stds: number[] } {
  const n = X.length;
  const p = X[0].length;
  const means = new Array(p).fill(0);
  const stds = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    means[j] = s / n;
  }
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const d = X[i][j] - means[j];
      s += d * d;
    }
    stds[j] = Math.sqrt(s / Math.max(1, n - 1)) || 1;
  }
  const Xz: number[][] = Array.from({ length: n }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xz[i][j] = (X[i][j] - means[j]) / stds[j];
    }
  }
  return { Xz, means, stds };
}

function fitLogistic(
  X: number[][],
  y: number[],
  opts: { lr?: number; l2?: number; iters?: number; weights?: number[] } = {},
): { intercept: number; weights: number[] } {
  const lr = opts.lr ?? 0.1;
  const l2 = opts.l2 ?? 1e-3;
  const iters = opts.iters ?? 400;
  const n = X.length;
  const p = X[0].length;
  const sw = opts.weights && opts.weights.length === n ? opts.weights : null;
  const wSum = sw ? sw.reduce((a, b) => a + b, 0) : n;
  let b = 0;
  const w = new Array(p).fill(0);
  for (let t = 0; t < iters; t++) {
    let gb = 0;
    const gw = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < p; j++) z += w[j] * X[i][j];
      const ph = sigmoid(z);
      const err = (ph - y[i]) * (sw ? sw[i] : 1);
      gb += err;
      for (let j = 0; j < p; j++) gw[j] += err * X[i][j];
    }
    b -= lr * (gb / wSum);
    for (let j = 0; j < p; j++) {
      w[j] -= lr * (gw[j] / wSum + l2 * w[j]);
    }
  }
  return { intercept: b, weights: w };
}


function computeAUC(scores: number[], labels: number[]): number {
  // Mann-Whitney U statistic AUC. O(n log n).
  const idx = scores.map((s, i) => ({ s, l: labels[i] })).sort((a, b) => a.s - b.s);
  let rankSum = 0;
  let pos = 0;
  for (let i = 0; i < idx.length; i++) {
    if (idx[i].l === 1) {
      rankSum += (i + 1);
      pos++;
    }
  }
  const neg = idx.length - pos;
  if (pos === 0 || neg === 0) return 0.5;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const cutoff = new Date(Date.now() - 180 * 86400000).toISOString();

    const { data, error } = await supabase
      .from("signal_outcomes")
      .select("conviction, strategy, regime, realized_pnl_pct, status, exit_reason, entry_date, contributing_rules")
      .gte("entry_date", cutoff)
      .in("status", ["closed", "stopped_out", "took_profit"])
      .limit(5000);

    if (error) {
      console.error("[train-meta] fetch err", error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rows = (data ?? []) as OutcomeRow[];

    const X: number[][] = [];
    const y: number[] = [];
    const entryAges: number[] = []; // days since trade
    const now = Date.now();
    for (const r of rows) {
      const pnl = Number(r.realized_pnl_pct);
      if (!Number.isFinite(pnl)) continue;
      const f = buildFeatures(r);
      if (!f) continue;
      X.push(vectorize(f));
      const win = r.exit_reason === "take_profit" || pnl > 0 ? 1 : 0;
      y.push(win);
      const ed = r.entry_date ? new Date(r.entry_date).getTime() : now;
      entryAges.push(Math.max(0, (now - ed) / 86400000));
    }

    if (X.length < 40) {
      console.log(`[train-meta] not enough samples (${X.length} < 40) — skipping fit`);
      return new Response(JSON.stringify({ skipped: true, samples: X.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const posCount = y.reduce((a, b) => a + b, 0);
    if (posCount < 5 || posCount > y.length - 5) {
      console.log(`[train-meta] degenerate labels (pos=${posCount}/${y.length}) — skipping fit`);
      return new Response(JSON.stringify({ skipped: true, reason: "degenerate_labels" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Drift-aware sample weighting ─────────────────────────────────────
    // Check for recent ADWIN drift events. If any fired in the last 30 days,
    // weight the most-recent 30 days × 3 instead of the default × 2.
    const { data: drift } = await supabase
      .from("drift_events")
      .select("detected_at, severity")
      .gte("detected_at", new Date(now - 30 * 86400000).toISOString())
      .limit(5);
    const recentDriftHard = (drift ?? []).some((d: any) => d.severity === "hard");
    const recentDriftSoft = (drift ?? []).some((d: any) => d.severity === "soft");
    const recentMult = recentDriftHard ? 3.0 : recentDriftSoft ? 2.5 : 2.0;
    const sampleWeights = entryAges.map(a => a <= 30 ? recentMult : a <= 60 ? 1.5 : 1.0);
    console.log(`[train-meta] drift=${recentDriftHard ? "hard" : recentDriftSoft ? "soft" : "none"} → recent-window weight ×${recentMult}`);

    const { Xz, means, stds } = standardize(X);
    const { intercept, weights } = fitLogistic(Xz, y, { lr: 0.1, l2: 1e-3, iters: 400, weights: sampleWeights });


    // Compute in-sample AUC for monitoring.
    const scores: number[] = [];
    for (let i = 0; i < Xz.length; i++) {
      let z = intercept;
      for (let j = 0; j < weights.length; j++) z += weights[j] * Xz[i][j];
      scores.push(sigmoid(z));
    }
    const auc = computeAUC(scores, y);

    const payload = {
      intercept,
      coefficients: { weights, means, stds },
      feature_names: META_FEATURE_NAMES as unknown as string[],
      sample_size: X.length,
      auc: Math.round(auc * 10000) / 10000,
    };

    const { error: insErr } = await supabase
      .from("meta_label_model")
      .insert(payload);
    if (insErr) {
      console.error("[train-meta] insert err", insErr.message);
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prune older models (keep last 10).
    const { data: existing } = await supabase
      .from("meta_label_model")
      .select("id")
      .order("trained_at", { ascending: false })
      .range(10, 999);
    if (existing && existing.length > 0) {
      const toDel = (existing as Array<{ id: string }>).map(r => r.id);
      await supabase.from("meta_label_model").delete().in("id", toDel);
    }

    console.log(`[train-meta] trained on ${X.length} samples, AUC=${payload.auc}`);
    return new Response(JSON.stringify({ ok: true, samples: X.length, auc: payload.auc }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[train-meta] fatal", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
