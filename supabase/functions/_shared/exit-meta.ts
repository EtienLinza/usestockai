// ============================================================================
// EXIT META-LABELER — "should I still be in this?"
//
// Our exits are geometric: hard stop, trail, target, time. None of them ask
// the question a discretionary trader asks every morning — given how this
// trade has actually behaved so far, is it still likely to end green?
//
// This module answers that from history. The nightly `train-exit-meta` job
// builds an empirical grid over
//     (peak favourable excursion reached, fraction of that peak given back)
// and stores, per cell, the share of historical trades that still finished
// profitable. Live exits look up the cell for the open position and bail out
// early when the recovery odds have collapsed.
//
// Known bias, deliberately accepted: the grid is built from *terminal*
// give-back, which is a subset of trades that ever touched that give-back.
// The subset skews toward losers, so the grid under-states recovery odds.
// We compensate by only acting on a low threshold (default 0.35) and by
// requiring a real sample per cell — the module returns null otherwise, and
// null is a pure pass-through.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** Peak-excursion buckets, in percent. */
export const MFE_EDGES = [0.5, 1.5, 3, 6];
/** Give-back buckets, as a fraction of peak excursion. */
export const GIVEBACK_EDGES = [0.4, 0.6, 0.8, 1.0];

export interface ExitMetaCell { n: number; winRate: number; }
export type ExitMetaGrid = Record<string, ExitMetaCell>;

export interface ExitMetaModel {
  grid: ExitMetaGrid;
  sample_size: number;
  trained_at: string | null;
}

export function bucketIndex(value: number, edges: number[]): number {
  for (let i = 0; i < edges.length; i++) if (value < edges[i]) return i;
  return edges.length;
}

export function cellKey(mfePct: number, givebackFrac: number): string {
  return `${bucketIndex(mfePct, MFE_EDGES)}:${bucketIndex(givebackFrac, GIVEBACK_EDGES)}`;
}

/** Load the champion exit-meta grid. Null when never trained. */
export async function loadExitMetaModel(supabase: SupabaseClient): Promise<ExitMetaModel | null> {
  try {
    const { data } = await supabase
      .from("model_versions")
      .select("coefficients, validation_metrics, created_at")
      .eq("model_kind", "exit_meta")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const grid = ((data as any).coefficients?.grid ?? {}) as ExitMetaGrid;
    if (!grid || Object.keys(grid).length === 0) return null;
    return {
      grid,
      sample_size: Number((data as any).validation_metrics?.sample_size ?? 0),
      trained_at: (data as any).created_at ?? null,
    };
  } catch (_) { return null; }
}

export interface ExitMetaScore {
  pWin: number;
  n: number;
  key: string;
}

/**
 * Probability this trade still finishes green.
 *
 * @param mfePct       Peak favourable excursion so far, in percent (>= 0).
 * @param givebackFrac Fraction of that peak already surrendered, 0..1+.
 * @param minSample    Minimum cell population before we trust the estimate.
 */
export function scoreExitMeta(
  model: ExitMetaModel | null,
  mfePct: number,
  givebackFrac: number,
  minSample = 20,
): ExitMetaScore | null {
  if (!model) return null;
  if (!Number.isFinite(mfePct) || !Number.isFinite(givebackFrac)) return null;
  const key = cellKey(Math.max(0, mfePct), Math.max(0, givebackFrac));
  const cell = model.grid[key];
  if (!cell || cell.n < minSample) return null;
  return { pWin: cell.winRate, n: cell.n, key };
}

/** Current give-back fraction for an open position. */
export function computeGiveback(
  entry: number, peak: number, current: number, isLong: boolean,
): { mfePct: number; givebackFrac: number } {
  if (!(entry > 0)) return { mfePct: 0, givebackFrac: 0 };
  const mfePct = isLong
    ? Math.max(0, ((peak - entry) / entry) * 100)
    : Math.max(0, ((entry - peak) / entry) * 100);
  const curPct = isLong
    ? ((current - entry) / entry) * 100
    : ((entry - current) / entry) * 100;
  if (mfePct <= 0) return { mfePct: 0, givebackFrac: 0 };
  return { mfePct, givebackFrac: Math.max(0, (mfePct - curPct) / mfePct) };
}
