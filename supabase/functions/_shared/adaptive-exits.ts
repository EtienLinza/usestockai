// ============================================================================
// ADAPTIVE EXIT PARAMETERS (WS3)
//
// The engine ships hand-set exit geometry per stock profile:
//   • trailingStopATRMult — how much giveback a runner is allowed
//   • hardStopATRMult     — initial risk distance
//   • takeProfitPct       — the hard ceiling
//
// The nightly `tune-exit-params` job replays every closed trade's MFE/MAE
// envelope against candidate geometries and learns small, clamped deltas per
// (stock profile × market regime). This module is the read side: the live
// autotrader loads the active rows once per run and folds them into the
// profile params used for sizing and exits.
//
// Cold-start safe: no rows → empty map → engine defaults, unchanged behaviour.
// ============================================================================

export interface TunedExitParams {
  trailingStopATRMult?: number;
  hardStopATRMult?: number;
  takeProfitPct?: number;
}

export type ExitParamMap = Map<string, TunedExitParams>;

const KEY = (profile: string, regime: string) =>
  `${String(profile).toLowerCase()}|${String(regime || "neutral").toLowerCase()}`;

/** Layer 1: a tuned value may never drift further than this from the engine
 *  default, no matter what the data says. */
export const EXIT_CLAMPS: Record<keyof TunedExitParams, number> = {
  trailingStopATRMult: 0.8,
  hardStopATRMult: 0.6,
  takeProfitPct: 5,
};

/** Absolute survival bounds — never breached even by a clamped delta. */
export const EXIT_BOUNDS: Record<keyof TunedExitParams, [number, number]> = {
  trailingStopATRMult: [1.8, 4.5],
  hardStopATRMult: [1.6, 4.0],
  takeProfitPct: [5, 30],
};

export function clampExitParam(
  key: keyof TunedExitParams,
  base: number,
  candidate: number,
): number {
  const maxDelta = EXIT_CLAMPS[key];
  const [lo, hi] = EXIT_BOUNDS[key];
  const delta = Math.max(-maxDelta, Math.min(maxDelta, candidate - base));
  const v = Math.max(lo, Math.min(hi, base + delta));
  return Math.round(v * 100) / 100;
}

/** Load all active tuned rows. Never throws — a failure degrades to defaults. */
export async function loadAdaptiveExits(supabase: any): Promise<ExitParamMap> {
  const map: ExitParamMap = new Map();
  try {
    const { data, error } = await supabase
      .from("adaptive_exit_params")
      .select("profile, market_regime, params")
      .eq("status", "active");
    if (error) throw error;
    for (const row of data ?? []) {
      const p = (row.params ?? {}) as TunedExitParams;
      const clean: TunedExitParams = {};
      for (const k of Object.keys(EXIT_CLAMPS) as Array<keyof TunedExitParams>) {
        const v = p[k];
        if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
      }
      if (Object.keys(clean).length > 0) {
        map.set(KEY(row.profile, row.market_regime), clean);
      }
    }
  } catch (e) {
    console.warn("[adaptive-exits] load failed — using engine defaults", e);
  }
  return map;
}

/** Resolve overrides: exact (profile × regime) first, then regime-agnostic. */
export function resolveExitParams(
  map: ExitParamMap | null | undefined,
  profile: string | null | undefined,
  marketRegime: string | null | undefined,
): TunedExitParams | undefined {
  if (!map || map.size === 0 || !profile) return undefined;
  return (
    map.get(KEY(profile, marketRegime ?? "neutral")) ??
    map.get(KEY(profile, "all")) ??
    undefined
  );
}

/** Fold tuned geometry into a profile-params object (non-mutating).
 *  `trailAdjust` is the legacy per-strategy capture-ratio multiplier from
 *  `calibrate-weights`; it still applies on top of the tuned base. */
export function applyExitParams<T extends {
  trailingStopATRMult: number; hardStopATRMult: number; takeProfitPct: number;
}>(base: T, tuned: TunedExitParams | undefined, trailAdjust = 1.0): T {
  if (!tuned && trailAdjust === 1.0) return base;
  const out: T = { ...base };
  if (tuned?.trailingStopATRMult != null) out.trailingStopATRMult = tuned.trailingStopATRMult;
  if (tuned?.hardStopATRMult != null) out.hardStopATRMult = tuned.hardStopATRMult;
  if (tuned?.takeProfitPct != null) out.takeProfitPct = tuned.takeProfitPct;
  if (trailAdjust !== 1.0) {
    out.trailingStopATRMult = clampExitParam(
      "trailingStopATRMult",
      base.trailingStopATRMult,
      out.trailingStopATRMult * trailAdjust,
    );
  }
  return out;
}
