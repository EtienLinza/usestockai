// ============================================================================
// ENSEMBLE-LOADER — read the promoted 4-model champion back from `model_versions`
// so the live autotrader can score fresh entries with the best trained model.
//
// The training pipeline (calibrate-weights) writes each nightly ensemble as a
// `challenger` row; manage-models promotes the best to `champion` after
// shadow-scoring + stress tests. This loader reconstructs the portable
// `EnsembleModel` from the stored coefficient blob so the consumer (autotrader)
// never re-trains — it just calls `predictEnsemble`.
// ============================================================================
import type { EnsembleModel } from "./ensemble.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Reconstruct an `EnsembleModel` from a `model_versions` row's `coefficients`
 * blob. Returns null on malformed/missing rows (caller treats null as
 * cold-start pass-through — no champion available yet).
 */
export function coefsToModel(row: any): EnsembleModel | null {
  try {
    const c = row?.coefficients ?? {};
    if (!c.meta || !c.featureMeans || !c.featureStds) return null;
    return {
      featureNames: row?.feature_list ?? [],
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
        trainedAt: row?.created_at,
        sampleSize: row?.validation_metrics?.holdout?.n ?? 0,
        holdoutReport: row?.validation_metrics?.holdout ?? { n: 0, logLoss: 0, brier: 0, accuracy: 0 },
        perModel: row?.validation_metrics?.perModel ?? {},
        featureSampleSize: row?.validation_metrics?.featureSampleSize ?? [],
      },
    };
  } catch {
    return null;
  }
}

/**
 * Load the latest promoted ensemble champion for live entry scoring.
 * Queries `model_versions` for the active `status='champion'` ensemble row,
 * newest first. Returns null when no champion exists yet (cold start) or on
 * any error — the caller falls back to the simple meta-labeler.
 */
export async function loadChampionEnsemble(
  supabase: SupabaseClient,
): Promise<EnsembleModel | null> {
  try {
    const { data, error } = await supabase
      .from("model_versions")
      .select("*")
      .eq("status", "champion")
      .eq("model_kind", "ensemble")
      .order("deployed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return coefsToModel(data);
  } catch {
    return null;
  }
}
