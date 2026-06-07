// ============================================================================
// META-LABELER — Lopez-de-Prado-style secondary classifier.
//
// Given the primary signal engine already says BUY/SHORT, the meta-labeler
// predicts P(this specific instance is profitable) using a simple logistic
// regression over persisted features. The model is retrained nightly by the
// `train-meta-labeler` edge function on the last 180d of `signal_outcomes`.
//
// Design:
//   • Logistic regression (no deps, fully explainable)
//   • Features standardized via mean/std stored in the model row
//   • Missing model OR missing features → metaScore = null (pass-through)
//   • Filter logic lives in the autotrader, NOT in the signal engine, so the
//     backtest stays deterministic.
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const META_FEATURE_NAMES = [
  "conviction",
  "atr_pct",
  "rel_strength",
  "sector_momentum",
  "eps_revision_score",
  "regime_bull_quiet",
  "regime_bull_volatile",
  "regime_bear_quiet",
  "regime_bear_volatile",
  "hour_of_day",
  "day_of_week",
] as const;

export type MetaFeatureName = typeof META_FEATURE_NAMES[number];

export interface MetaLabelModel {
  intercept: number;
  /** Length matches feature_names. */
  coefficients: number[];
  feature_names: string[];
  /** Per-feature standardization parameters. */
  means: number[];
  stds: number[];
  trained_at: string;
  sample_size: number;
  auc: number | null;
}

export interface MetaFeatures {
  conviction: number;
  atrPct: number;
  relStrength: number;
  sectorMomentum: number;
  epsRevisionScore: number;
  regime: string | null; // bull_quiet | bull_volatile | bear_quiet | bear_volatile | neutral
  hourOfDay: number;     // 0..23 ET
  dayOfWeek: number;     // 0..6
}

function buildFeatureVector(f: MetaFeatures): number[] {
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
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * Score a candidate signal. Returns probability ∈ [0,1] or null when the
 * model is missing or malformed (caller treats null as pass-through).
 */
export function scoreMetaLabel(
  model: MetaLabelModel | null | undefined,
  features: MetaFeatures,
): number | null {
  if (!model) return null;
  const x = buildFeatureVector(features);
  if (x.length !== model.coefficients.length) return null;
  if (model.means.length !== x.length || model.stds.length !== x.length) return null;
  let z = model.intercept;
  for (let i = 0; i < x.length; i++) {
    const std = model.stds[i] > 1e-9 ? model.stds[i] : 1;
    const xn = (x[i] - model.means[i]) / std;
    z += model.coefficients[i] * xn;
  }
  return sigmoid(z);
}

// ── DB loader ───────────────────────────────────────────────────────────────
let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _client;
}

export async function loadLatestMetaModel(): Promise<MetaLabelModel | null> {
  try {
    const { data, error } = await client()
      .from("meta_label_model")
      .select("intercept, coefficients, feature_names, sample_size, auc, trained_at")
      .order("trained_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const row = data[0] as any;
    const coeffs = row.coefficients;
    if (!coeffs || typeof coeffs !== "object") return null;
    return {
      intercept: Number(row.intercept) || 0,
      coefficients: Array.isArray(coeffs.weights) ? coeffs.weights : [],
      means: Array.isArray(coeffs.means) ? coeffs.means : [],
      stds: Array.isArray(coeffs.stds) ? coeffs.stds : [],
      feature_names: Array.isArray(row.feature_names) ? row.feature_names : [],
      trained_at: row.trained_at,
      sample_size: Number(row.sample_size) || 0,
      auc: row.auc != null ? Number(row.auc) : null,
    };
  } catch (e) {
    console.warn("[meta-label load]", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Suggested gate semantics for callers (autotrader):
 *   • null model OR null score          → pass through (no effect)
 *   • score < 0.30                      → HARD skip
 *   • score < 0.45 AND conviction < 80  → demote (consensus-only, no entry)
 *   • otherwise                         → pass through
 */
export function metaLabelDecision(
  score: number | null,
  conviction: number,
): "PASS" | "DEMOTE" | "SKIP" {
  if (score === null || !Number.isFinite(score)) return "PASS";
  if (score < 0.30) return "SKIP";
  if (score < 0.45 && conviction < 80) return "DEMOTE";
  return "PASS";
}
