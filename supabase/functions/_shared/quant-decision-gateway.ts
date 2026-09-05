// ============================================================================
// QUANT DECISION GATEWAY — one auditable path from signal to order intent.
//
// Validate evidence (including point-in-time availability) → run the risk
// kernel → emit an OrderIntent or a list of named block reasons. Nothing else
// in the system may create an order intent.
// ============================================================================
import {
  validateSignalEvidence,
  type DecisionMode,
  type OrderIntent,
  type PortfolioCandidate,
  type RiskLimits,
} from "./quant-contracts.ts";
import { evaluateCandidateRisk, type PortfolioRiskState } from "./risk-kernel.ts";

export interface DecisionRequest {
  candidate: PortfolioCandidate;
  mode: DecisionMode;
  limitPrice?: number | null;
  maxSlippageBps?: number;
  timeInForce?: OrderIntent["timeInForce"];
  now?: string;
  expiresAt?: string;
}

export interface DecisionResult {
  intent: OrderIntent | null;
  blockedReasons: string[];
}

function idPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

export function createOrderIntent(
  request: DecisionRequest,
  state: PortfolioRiskState,
  limits: RiskLimits,
): DecisionResult {
  const now = request.now ?? new Date().toISOString();
  const validationErrors = validateSignalEvidence(request.candidate.signal);
  if (validationErrors.length) return { intent: null, blockedReasons: validationErrors };

  const risk = evaluateCandidateRisk(request.candidate, state, limits, now);
  if (!risk.allowed) return { intent: null, blockedReasons: risk.reasons };

  const signal = request.candidate.signal;
  const id = `qi-${idPart(signal.signalId)}-${idPart(signal.ticker)}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`;
  const limitPrice = Number.isFinite(request.limitPrice as number) ? (request.limitPrice as number) : null;

  return {
    intent: {
      intentId: id,
      signalId: signal.signalId,
      ticker: signal.ticker,
      side: signal.side,
      targetNotionalDollars: risk.approvedNotionalDollars,
      limitPrice,
      maxSlippageBps: Math.max(0, request.maxSlippageBps ?? 50),
      timeInForce: request.timeInForce ?? "day",
      mode: request.mode,
      risk,
      createdAt: now,
      expiresAt: request.expiresAt ?? new Date(Date.parse(now) + 15 * 60_000).toISOString(),
    },
    blockedReasons: [],
  };
}
