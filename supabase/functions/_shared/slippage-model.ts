// ============================================================================
// SLIPPAGE / IMPACT MODEL — simplified Almgren–Chriss.
//
// Replaces the legacy flat-bps haircut. Real fill cost scales sub-linearly
// with `participation = orderNotional / ADV`. Two components:
//   • permanent impact     γ · (Q/ADV)         — linear, ~10 bps base
//   • temporary impact     η · σ · √(Q/ADV)    — square-root vol scaling
// Sum returns the expected slippage in basis points.
//
// We do NOT model timing risk explicitly — autotrader fills are atomic
// market orders or one-shot limits, so reservation-price drift is captured
// by the next bar's signal rather than by an optimal-execution schedule.
// ============================================================================

const GAMMA_BPS = 10;        // permanent impact coefficient
const ETA_BPS_PER_VOL = 12;  // temporary impact per unit of daily vol

export interface SlippageEstimate {
  bps: number;
  participation: number; // Q / ADV ∈ [0, 1]
  permanentBps: number;
  temporaryBps: number;
}

/**
 * Estimate slippage for a market order against ADV.
 *
 * @param notional   Order $ size (always positive).
 * @param advDollars 20-day average daily $ volume of the name.
 * @param atrPct     Daily ATR as a fraction of price (e.g. 0.02 = 2%).
 */
export function estimateSlippage(
  notional: number,
  advDollars: number,
  atrPct: number,
): SlippageEstimate {
  const q = Math.max(0, notional);
  const adv = Math.max(1e-9, advDollars);
  const sigma = Math.max(0.001, Math.min(0.20, atrPct)); // clamp to sane band
  const participation = Math.min(1, q / adv);
  const permanent = GAMMA_BPS * participation;
  const temporary = ETA_BPS_PER_VOL * sigma * 100 * Math.sqrt(participation);
  return {
    bps: Math.round((permanent + temporary) * 100) / 100,
    participation,
    permanentBps: Math.round(permanent * 100) / 100,
    temporaryBps: Math.round(temporary * 100) / 100,
  };
}

/**
 * Approximate expected edge per trade in bps, derived from take-profit
 * distance (atrPct × tpMult × 100 bps). Defaults to a 2-ATR target if no
 * profile multiplier is supplied. Conservative — slippage shrink is
 * triggered when impact / edge > 30%, so under-stating edge errs on the
 * safe side.
 */
export function estimateExpectedEdgeBps(atrPct: number, tpMult: number = 2): number {
  const a = Math.max(0.001, Math.min(0.10, atrPct));
  return a * tpMult * 100 * 100; // atrPct (decimal) → bps requires ×10000; tpMult units of ATR
  // Note: atrPct × 100 = % move; × 100 = bps. So 2-ATR × 2% atr = 800 bps.
}

/**
 * Apply impact-aware sizing shrink. If estimated slippage would consume
 * more than `maxImpactRatio` of expected edge, shrink the order until the
 * ratio is satisfied.
 *
 * Returns the shrink factor in [0, 1]. Caller multiplies kellyFraction by it.
 */
export function slippageShrinkFactor(
  notional: number,
  advDollars: number,
  atrPct: number,
  tpMult: number = 2,
  maxImpactRatio: number = 0.30,
): { factor: number; bps: number; edgeBps: number } {
  const edgeBps = estimateExpectedEdgeBps(atrPct, tpMult);
  if (edgeBps <= 0) return { factor: 1, bps: 0, edgeBps: 0 };
  const est = estimateSlippage(notional, advDollars, atrPct);
  if (est.bps <= edgeBps * maxImpactRatio) {
    return { factor: 1, bps: est.bps, edgeBps };
  }
  // Solve for shrink factor s such that estimateSlippage(s*Q,...).bps ≤
  // edgeBps * maxImpactRatio. Approximate via the dominant √-term:
  //   η σ √(sQ/ADV) ≈ edge × ratio  →  s ≈ (edge ratio / (η σ √(Q/ADV)))²
  const ratio = (edgeBps * maxImpactRatio) / Math.max(1e-9, est.bps);
  const factor = Math.max(0, Math.min(1, ratio * ratio));
  // Re-check at shrunk size; fall back to factor unchanged if still over budget.
  const recheck = estimateSlippage(notional * factor, advDollars, atrPct);
  return { factor, bps: recheck.bps, edgeBps };
}
