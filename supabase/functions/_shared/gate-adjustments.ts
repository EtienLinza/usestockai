// ============================================================================
// GATE ADJUSTMENTS — the only loop in the engine that can make filters LOOSER.
//
// Every other learning loop we run (threshold tuner, exit tuner, calibration)
// can only tighten: they learn from trades we actually took. Rejections are
// the blind spot — if a gate systematically blocks winners, nothing notices.
//
// `evaluate-rejections` prices the counterfactual outcome of every rejected
// candidate and writes a small, clamped delta per gate here. Live code reads
// those deltas through this resolver. Every delta is clamped in the DB row
// itself, so a runaway tuner cannot open the gates wide.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type GateKey =
  | "conviction_floor"       // points added to the min-conviction floor (negative = looser)
  | "earnings_blackout_days" // days of blackout before earnings
  | "correlation_threshold"; // |rho| above which a correlated entry is blocked

export type GateAdjustments = Record<string, number>;

export const GATE_CLAMPS: Record<GateKey, { min: number; max: number }> = {
  conviction_floor: { min: -5, max: 5 },
  earnings_blackout_days: { min: -1, max: 2 },
  correlation_threshold: { min: -0.10, max: 0.10 },
};

let cache: { at: number; value: GateAdjustments } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function loadGateAdjustments(supabase: SupabaseClient): Promise<GateAdjustments> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const out: GateAdjustments = {};
  try {
    const { data } = await supabase
      .from("gate_adjustments")
      .select("gate_key, delta, min_delta, max_delta");
    for (const row of data ?? []) {
      const key = String((row as any).gate_key);
      const lo = Number((row as any).min_delta ?? -5);
      const hi = Number((row as any).max_delta ?? 5);
      const d = Number((row as any).delta ?? 0);
      out[key] = Math.max(lo, Math.min(hi, Number.isFinite(d) ? d : 0));
    }
  } catch (_) { /* cold start / offline → neutral */ }
  cache = { at: Date.now(), value: out };
  return out;
}

/** Neutral (0) when the gate has never been tuned. */
export function gateDelta(adj: GateAdjustments | null | undefined, key: GateKey): number {
  const raw = adj?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const c = GATE_CLAMPS[key];
  return Math.max(c.min, Math.min(c.max, raw));
}

export function clearGateCache(): void { cache = null; }
