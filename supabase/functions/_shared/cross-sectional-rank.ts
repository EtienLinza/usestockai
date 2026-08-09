// ============================================================================
// CROSS-SECTIONAL RANK GATE
//
// Absolute conviction floors misbehave at both tails of the tape:
//   • euphoric market → everything clears the floor, the book fills with the
//     merely-adequate and the good names get no room;
//   • quiet market    → nothing clears, the engine goes dark and capital idles.
//
// The fix is a *relative* gate. Score every candidate produced by a scan and
// keep only the top slice of that day's own distribution, subject to a small
// hard floor and a sane count band. "Good relative to today" always exists, so
// the engine never goes fully dark, and in a hot tape the marginal names are
// crowded out by better ones instead of sneaking through a static threshold.
//
// Pure function, zero IO — imported by both the live orchestrator and the
// backtest simulator so ranked behaviour is identical in sim and in prod.
// ============================================================================

export interface RankableSignal {
  ticker: string;
  confidence: number;
  /** Meta-label P(win) in [0,1]; null when the model is cold. */
  meta_score?: number | null;
  [k: string]: unknown;
}

export interface CrossSectionalConfig {
  /** Fraction of the day's candidates to keep. */
  topPct: number;
  /** Never keep fewer than this (when that many candidates exist). */
  minKeep: number;
  /** Never keep more than this regardless of universe size. */
  maxKeep: number;
  /** Absolute conviction below which a name is dropped even if top-ranked. */
  hardFloor: number;
  /** Weight of the meta-label probability in the blended rank score. */
  metaWeight: number;
}

export const DEFAULT_CROSS_SECTIONAL: CrossSectionalConfig = {
  topPct: 0.15,
  minKeep: 5,
  maxKeep: 40,
  hardFloor: 55,
  metaWeight: 0.35,
};

/**
 * Blended rank score. Conviction is the base; the meta-label probability
 * modulates it multiplicatively around 1.0 so a cold model (null) is a
 * perfect pass-through rather than a penalty.
 */
export function rankScore(s: RankableSignal, metaWeight = DEFAULT_CROSS_SECTIONAL.metaWeight): number {
  const conv = Number.isFinite(s.confidence) ? s.confidence : 0;
  const meta = typeof s.meta_score === "number" && Number.isFinite(s.meta_score)
    ? Math.max(0, Math.min(1, s.meta_score))
    : null;
  if (meta === null) return conv;
  // meta 0.5 → neutral, 1.0 → +metaWeight, 0.0 → −metaWeight
  return conv * (1 + metaWeight * (meta - 0.5) * 2);
}

export interface CrossSectionalResult<T extends RankableSignal> {
  kept: T[];
  dropped: Array<{ signal: T; score: number; rank: number }>;
  /** Score of the weakest kept name — the effective bar for the day. */
  cutoffScore: number | null;
  total: number;
}

/**
 * Keep the top slice of the day's candidate distribution.
 * Candidates are returned sorted best-first; dropped names carry their rank so
 * the caller can persist them as counterfactual training rows.
 */
export function applyCrossSectionalGate<T extends RankableSignal>(
  signals: T[],
  cfg: Partial<CrossSectionalConfig> = {},
): CrossSectionalResult<T> {
  const c = { ...DEFAULT_CROSS_SECTIONAL, ...cfg };
  const total = signals.length;
  if (total === 0) return { kept: [], dropped: [], cutoffScore: null, total: 0 };

  const scored = signals
    .map(s => ({ signal: s, score: rankScore(s, c.metaWeight) }))
    .sort((a, b) => b.score - a.score);

  const target = Math.ceil(total * Math.max(0, Math.min(1, c.topPct)));
  const keepN = Math.max(0, Math.min(total, Math.max(Math.min(c.minKeep, total), Math.min(target, c.maxKeep))));

  const kept: T[] = [];
  const dropped: Array<{ signal: T; score: number; rank: number }> = [];
  scored.forEach((row, i) => {
    const withinSlice = i < keepN;
    const clearsFloor = (row.signal.confidence ?? 0) >= c.hardFloor;
    if (withinSlice && clearsFloor) kept.push(row.signal);
    else dropped.push({ signal: row.signal, score: row.score, rank: i + 1 });
  });

  const cutoffScore = kept.length > 0 ? rankScore(kept[kept.length - 1], c.metaWeight) : null;
  return { kept, dropped, cutoffScore, total };
}
