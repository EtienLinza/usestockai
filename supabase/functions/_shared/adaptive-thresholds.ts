// ============================================================================
// ADAPTIVE SIGNAL THRESHOLDS (WS2)
//
// The signal engine ships with hand-set indicator thresholds per stock profile
// (adxThreshold / rsiOversold / rsiOverbought / buyThreshold). The nightly
// `tune-signal-thresholds` job learns small, clamped deltas on top of those
// defaults per (profile × market regime) and writes the winners here with
// status='active'. This module is the read side: the live autotrader and the
// scanner load the active rows once per run and pass them into
// `evaluateSignal(..., paramOverrides)`.
//
// Cold-start safe: no rows → empty map → engine defaults, unchanged behaviour.
// ============================================================================

export interface TunedParams {
  adxThreshold?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  buyThreshold?: number;
  shortThreshold?: number;
}

export type ThresholdMap = Map<string, TunedParams>;

const KEY = (profile: string, regime: string) =>
  `${String(profile).toLowerCase()}|${String(regime || "neutral").toLowerCase()}`;

/** Hard safety clamps — a tuned value may never drift further than this from
 *  the engine default, no matter what the data says. Layer 1 of 2. */
export const PARAM_CLAMPS: Record<keyof TunedParams, number> = {
  adxThreshold: 8,
  rsiOversold: 6,
  rsiOverbought: 6,
  buyThreshold: 10,
  shortThreshold: 10,
};

export const ABSOLUTE_BOUNDS: Record<keyof TunedParams, [number, number]> = {
  adxThreshold: [12, 40],
  rsiOversold: [15, 40],
  rsiOverbought: [60, 85],
  buyThreshold: [50, 90],
  shortThreshold: [50, 90],
};

export function clampParam(
  key: keyof TunedParams,
  base: number,
  candidate: number,
): number {
  const maxDelta = PARAM_CLAMPS[key];
  const [lo, hi] = ABSOLUTE_BOUNDS[key];
  const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, candidate - base));
  return Math.round(Math.max(lo, Math.min(hi, base + clampedDelta)));
}

/** Load all active tuned rows. Never throws — a failure degrades to defaults. */
export async function loadAdaptiveThresholds(supabase: any): Promise<ThresholdMap> {
  const map: ThresholdMap = new Map();
  try {
    const { data, error } = await supabase
      .from("adaptive_signal_params")
      .select("profile, market_regime, params")
      .eq("status", "active");
    if (error) throw error;
    for (const row of data ?? []) {
      const p = (row.params ?? {}) as TunedParams;
      const clean: TunedParams = {};
      for (const k of Object.keys(PARAM_CLAMPS) as Array<keyof TunedParams>) {
        const v = p[k];
        if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
      }
      if (Object.keys(clean).length > 0) {
        map.set(KEY(row.profile, row.market_regime), clean);
      }
    }
  } catch (e) {
    console.warn("[adaptive-thresholds] load failed — using engine defaults", e);
  }
  return map;
}

/** Resolve overrides for a ticker: exact (profile × regime) first, then the
 *  regime-agnostic `all` row, then nothing. */
export function resolveThresholds(
  map: ThresholdMap | null | undefined,
  profile: string | null | undefined,
  marketRegime: string | null | undefined,
): TunedParams | undefined {
  if (!map || map.size === 0 || !profile) return undefined;
  return (
    map.get(KEY(profile, marketRegime ?? "neutral")) ??
    map.get(KEY(profile, "all")) ??
    undefined
  );
}
