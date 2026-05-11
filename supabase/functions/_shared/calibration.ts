// ============================================================================
// CALIBRATION — Phase 1 #5
// Isotonic / PAV calibration: maps raw conviction → empirically-realized
// win-rate-equivalent conviction using a monotonic non-decreasing curve
// fit by Pool Adjacent Violators.
//
// The shared helper is consumed by market-scanner, scan-worker and
// autotrader-scan so live + persisted scans use identical math. The
// nightly `calibrate-weights` job writes `calibration_curve.__isotonic`
// (an array of { conviction, calibrated, count } anchors). When that
// array is missing or has <3 anchors, callers should fall back to the
// legacy bucket `adjust` system.
// ============================================================================

export interface IsotonicAnchor {
  conviction: number; // bucket center (0..100)
  calibrated: number; // empirically-realized win-rate (0..100)
  count: number;      // raw sample count in that bucket
}

interface PAVPoint { x: number; y: number; w: number; }

/** Pool Adjacent Violators — produces a monotonic non-decreasing y vs x. */
export function pav(points: PAVPoint[]): PAVPoint[] {
  const out: PAVPoint[] = points.map((p) => ({ ...p }));
  let i = 0;
  while (i < out.length - 1) {
    if (out[i].y > out[i + 1].y) {
      const tw = out[i].w + out[i + 1].w;
      const ny = (out[i].y * out[i].w + out[i + 1].y * out[i + 1].w) / tw;
      out[i + 1] = { x: out[i + 1].x, y: ny, w: tw };
      out.splice(i, 1);
      if (i > 0) i--;
    } else i++;
  }
  return out;
}

/**
 * Linearly interpolate `conviction` against the isotonic curve.
 * Returns the calibrated conviction-equivalent, clamped so the
 * absolute adjustment never exceeds `maxDelta`.
 */
export function applyIsotonicCalibration(
  conviction: number,
  iso: IsotonicAnchor[] | undefined | null,
  maxDelta = 10,
): number {
  if (!iso || iso.length < 3) return conviction;
  const pts = [...iso].sort((a, b) => a.conviction - b.conviction);
  let cal: number;
  if (conviction <= pts[0].conviction) cal = pts[0].calibrated;
  else if (conviction >= pts[pts.length - 1].conviction) cal = pts[pts.length - 1].calibrated;
  else {
    cal = pts[pts.length - 1].calibrated;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (conviction >= a.conviction && conviction <= b.conviction) {
        const span = Math.max(1e-9, b.conviction - a.conviction);
        const t = (conviction - a.conviction) / span;
        cal = a.calibrated + t * (b.calibrated - a.calibrated);
        break;
      }
    }
  }
  const delta = Math.max(-maxDelta, Math.min(maxDelta, cal - conviction));
  return Math.max(0, Math.min(100, conviction + delta));
}
