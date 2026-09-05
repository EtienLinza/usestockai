// ============================================================================
// QUANT CORE — probability-to-capital translation.
//
// Deliberately separate from signal generation. A prediction is not a trade
// until it has calibrated uncertainty, asymmetric payoff estimates,
// implementation costs, and competition for a finite portfolio risk budget.
//
// Dedup rule: the Bayesian shrinkage math lives in `user-models.ts` (`shrink`);
// this module wraps it for probability evidence rather than re-deriving it.
// ============================================================================
import { shrink } from "./user-models.ts";

export interface ProbabilityEvidence {
  predictedWinProbability: number;
  baseRate: number;
  effectiveSampleSize: number;
  priorStrength?: number;
}

export interface TradeEconomics {
  winProbability: number;
  winReturnPct: number;
  lossReturnPct: number;
  expectedCostPct: number;
  expectedNetReturnPct: number;
  edgeToRisk: number;
  evidenceConfidence: number;
}

export interface CapitalCandidate {
  id: string;
  expectedNetReturnPct: number;
  volatilityPct: number;
  riskBudgetPct: number;
  liquidityCapacityPct?: number;
  correlationLoad?: number;
}

export interface CapitalAllocationOptions {
  maxPortfolioRiskPct?: number;
  maxCandidateWeight?: number;
  explorationFloor?: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

/** Empirical-Bayes shrinkage prevents a tiny sample from creating certainty. */
export function shrinkProbability(e: ProbabilityEvidence): { probability: number; confidence: number } {
  const observed = clamp(finite(e.predictedWinProbability, 0.5), 0, 1);
  const base = clamp(finite(e.baseRate, 0.5), 0.01, 0.99);
  const n = Math.max(0, finite(e.effectiveSampleSize, 0));
  const prior = Math.max(1, finite(e.priorStrength ?? 50, 50));
  return {
    probability: shrink(observed, n, base, prior),
    confidence: clamp(n / (n + prior), 0, 1),
  };
}

/**
 * Convert a forecast into expected net economics. A high probability is not
 * enough if the payoff is asymmetric in the wrong direction or costs consume
 * the edge. `expectedCostPct` should come from the shared slippage model.
 */
export function computeTradeEconomics(
  evidence: ProbabilityEvidence,
  payoff: { winReturnPct: number; lossReturnPct: number; expectedCostPct: number },
): TradeEconomics {
  const shrunk = shrinkProbability(evidence);
  const win = Math.max(0, finite(payoff.winReturnPct, 0));
  const loss = Math.max(0, finite(payoff.lossReturnPct, 0));
  const cost = Math.max(0, finite(payoff.expectedCostPct, 0));
  const expectedNetReturnPct = shrunk.probability * win - (1 - shrunk.probability) * loss - cost;
  return {
    winProbability: shrunk.probability,
    winReturnPct: win,
    lossReturnPct: loss,
    expectedCostPct: cost,
    expectedNetReturnPct,
    edgeToRisk: loss > 0 ? expectedNetReturnPct / loss : 0,
    evidenceConfidence: shrunk.confidence,
  };
}

/**
 * Allocate a finite portfolio risk budget across economically positive
 * candidates. Discounts volatility, correlation crowding, weak evidence, and
 * liquidity capacity. Never allocates to a negative expected net edge.
 */
export function allocateCapital(
  candidates: CapitalCandidate[],
  options: CapitalAllocationOptions = {},
): Record<string, number> {
  if (!candidates.length) return {};
  const maxRisk = Math.max(0, finite(options.maxPortfolioRiskPct ?? 6, 6));
  const maxWeight = clamp(finite(options.maxCandidateWeight ?? 0.25, 0.25), 0.01, 1);
  const exploration = clamp(finite(options.explorationFloor ?? 0.02, 0.02), 0, 0.25);

  const raw = candidates.map((c) => {
    const edge = finite(c.expectedNetReturnPct, 0);
    const vol = Math.max(0.01, Math.abs(finite(c.volatilityPct, 1)));
    const risk = Math.max(0.01, finite(c.riskBudgetPct, vol));
    const crowding = 1 + clamp(finite(c.correlationLoad ?? 0, 0), 0, 1.5);
    const liquidity = clamp(finite(c.liquidityCapacityPct ?? 1, 1), 0, 1);
    return edge > 0 ? (edge / vol) * (1 / crowding) * liquidity * clamp(risk / vol, 0.25, 2) : 0;
  });
  const positive = raw.reduce((a, b) => a + b, 0);
  if (positive <= 0 || maxRisk <= 0) return Object.fromEntries(candidates.map((c) => [c.id, 0]));

  const weights = raw.map((x) => Math.min(maxWeight, maxRisk * (x / positive)));
  const floor = (exploration * maxRisk) / candidates.length;
  const result = weights.map((w) => (w > 0 ? w + floor : 0));
  const resultTotal = result.reduce((a, b) => a + b, 0);
  const scale = resultTotal > maxRisk ? maxRisk / resultTotal : 1;
  return Object.fromEntries(candidates.map((c, i) => [c.id, result[i] * scale]));
}

export interface EventImpulseInput {
  surpriseZ: number;
  revisionZ: number;
  priceConfirmationZ: number;
  hoursSinceAnnouncement: number;
  halfLifeHours?: number;
  dataQuality?: number;
}

/** A decaying, confirmation-aware event impulse for event/revision sleeves. */
export function eventImpulse(input: EventImpulseInput): number {
  const halfLife = Math.max(1, finite(input.halfLifeHours ?? 72, 72));
  const age = Math.max(0, finite(input.hoursSinceAnnouncement, 0));
  const decay = Math.pow(0.5, age / halfLife);
  const surprise = clamp(finite(input.surpriseZ, 0), -4, 4);
  const revision = clamp(finite(input.revisionZ, 0), -4, 4);
  const confirmation = clamp(finite(input.priceConfirmationZ, 0), -4, 4);
  const quality = clamp(finite(input.dataQuality ?? 1, 1), 0, 1);
  // Agreement is rewarded; disagreement is explicitly damped.
  const agreement =
    Math.sign(surprise || revision || confirmation) === Math.sign(confirmation || surprise || revision) ? 1 : 0.45;
  return clamp((0.45 * surprise + 0.35 * revision + 0.20 * confirmation) * decay * agreement * quality, -4, 4);
}
