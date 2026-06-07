// ============================================================================
// ADWIN — Adaptive Windowing for concept-drift detection (Bifet & Gavaldà).
//
// Streams a window of binary outcomes (e.g. signal hit-rate over time) and
// flags drift when the mean of any "old" sub-window differs from a "new"
// sub-window by more than the Hoeffding-bound at confidence δ.
//
// Simplified, list-backed implementation (sufficient for 100-500 obs windows):
//   • For each split point k in [1, n-1]
//     compute |mean(0..k) - mean(k..n)| vs ε = √( (1/2m) · ln(2n/δ) )
//     where m = harmonic mean of |left|, |right|.
//   • On drift, drop the older half of the window and emit an event.
// Returns the SEVERITY ("none" | "soft" | "hard") so callers can scale
// downstream gating.
// ============================================================================

export interface AdwinResult {
  drift: boolean;
  severity: "none" | "soft" | "hard";
  windowSize: number;
  preMean: number;
  postMean: number;
  splitIndex: number;
}

const DELTA = 0.05;          // detection confidence (lower → fewer false positives)
const MIN_BUCKET = 20;       // require ≥20 obs on each side of split

/**
 * Detect drift in a series of 0/1 outcomes (or any bounded [0,1] series).
 * No-state version — caller passes the full window each call.
 */
export function detectAdwinDrift(series: number[]): AdwinResult {
  const n = series.length;
  if (n < MIN_BUCKET * 2) {
    return { drift: false, severity: "none", windowSize: n, preMean: 0, postMean: 0, splitIndex: -1 };
  }
  // Running prefix sums for O(1) split evaluation.
  const prefix = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + series[i];
  let worst = { diff: 0, k: -1, mLeft: 0, mRight: 0 };
  for (let k = MIN_BUCKET; k <= n - MIN_BUCKET; k++) {
    const leftN = k;
    const rightN = n - k;
    const meanL = prefix[k] / leftN;
    const meanR = (prefix[n] - prefix[k]) / rightN;
    const diff = Math.abs(meanL - meanR);
    const m = 1 / (1 / leftN + 1 / rightN); // harmonic-ish denominator
    const eps = Math.sqrt((1 / (2 * m)) * Math.log(2 * n / DELTA));
    if (diff > eps && diff > worst.diff) {
      worst = { diff, k, mLeft: meanL, mRight: meanR };
    }
  }
  if (worst.k < 0) {
    return { drift: false, severity: "none", windowSize: n, preMean: 0, postMean: 0, splitIndex: -1 };
  }
  const gap = worst.mLeft - worst.mRight;
  const severity: "soft" | "hard" = Math.abs(gap) >= 0.15 ? "hard" : "soft";
  return {
    drift: true,
    severity,
    windowSize: n,
    preMean: Math.round(worst.mLeft * 10000) / 10000,
    postMean: Math.round(worst.mRight * 10000) / 10000,
    splitIndex: worst.k,
  };
}

/**
 * Map ADWIN severity → meta-label gate tightening multipliers.
 *   none → PASS thresholds untouched
 *   soft → PASS lifts from 0.45 → 0.55, SKIP from 0.30 → 0.40
 *   hard → PASS lifts from 0.45 → 0.60, SKIP from 0.30 → 0.45
 */
export function adwinGateAdjust(severity: "none" | "soft" | "hard"): { pass: number; skip: number } {
  switch (severity) {
    case "hard": return { pass: 0.60, skip: 0.45 };
    case "soft": return { pass: 0.55, skip: 0.40 };
    default:     return { pass: 0.45, skip: 0.30 };
  }
}
