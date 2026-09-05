// ============================================================================
// QUANT CONTRACTS — shared language for research, live decisions, and audit.
//
// Central rule: no signal is actionable without provenance, availability time,
// expected economics, and an explicit risk decision. Every field here exists so
// a decision can be replayed months later from the ledger alone.
// ============================================================================

export type QuantSide = "long" | "short";
export type DecisionMode = "shadow" | "paper" | "live" | "backtest";
export type DataQuality = "verified" | "delayed" | "stale" | "partial" | "missing";

export interface DataProvenance {
  provider: string;
  dataset: string;
  symbol: string;
  /** When the observation refers to (e.g. the bar close). */
  observationAt: string;
  /** When the value first became knowable to us. Point-in-time guard. */
  availableAt: string;
  retrievedAt: string;
  revision?: string;
  quality: DataQuality;
  adjusted: boolean;
}

export interface FeatureValue {
  name: string;
  value: number | null;
  provenance: DataProvenance[];
  version: string;
}

export interface SignalEvidence {
  signalId: string;
  ticker: string;
  side: QuantSide;
  sleeve: string;
  generatedAt: string;
  decisionAt: string;
  modelVersion: string;
  rawScore: number;
  calibratedProbability: number | null;
  baseRate: number | null;
  effectiveSampleSize: number | null;
  modelDisagreement: number | null;
  regime: string;
  reboundRisk: number | null;
  dataQuality: DataQuality;
  featureSetVersion: string;
  features: FeatureValue[];
}

export interface TradeEconomicsContract {
  expectedWinPct: number;
  expectedLossPct: number;
  expectedCostPct: number;
  expectedNetEdgePct: number;
  expectedHoldingBars: number;
  decayHalfLifeBars: number;
  estimatedParticipationPct: number;
  capacityDollars: number;
}

export interface PortfolioCandidate {
  signal: SignalEvidence;
  economics: TradeEconomicsContract;
  proposedNotionalDollars: number;
  riskContributionPct: number;
  correlationLoad: number;
  liquidityScore: number;
  uncertaintyScore: number;
}

export interface RiskLimits {
  maxGrossExposurePct: number;
  maxNetExposurePct: number;
  maxSingleNamePct: number;
  maxSectorPct: number;
  maxPortfolioRiskPct: number;
  maxDailyLossPct: number;
  maxCVaRPct: number;
  maxParticipationPct: number;
  maxStaleDataMinutes: number;
  allowShorts: boolean;
}

export interface RiskDecision {
  allowed: boolean;
  approvedNotionalDollars: number;
  approvedRiskPct: number;
  reasons: string[];
  evaluatedAt: string;
  limitsVersion: string;
}

export interface OrderIntent {
  intentId: string;
  signalId: string;
  ticker: string;
  side: QuantSide;
  targetNotionalDollars: number;
  limitPrice: number | null;
  maxSlippageBps: number;
  timeInForce: "day" | "ioc" | "fok";
  mode: DecisionMode;
  risk: RiskDecision;
  createdAt: string;
  expiresAt: string;
}

export interface ExperimentManifest {
  experimentId: string;
  codeRevision: string;
  featureSetVersion: string;
  modelVersions: string[];
  datasetSnapshot: string;
  universeDefinition: string;
  decisionLagBars: number;
  costModelVersion: string;
  randomSeed: number;
  trainWindow: { start: string; end: string };
  validationWindow: { start: string; end: string };
  testWindow: { start: string; end: string };
  purgeBars: number;
  embargoBars: number;
  createdAt: string;
}

/** A feature may only be used if every source was published by decision time. */
export function isFeatureAvailableAt(feature: FeatureValue, decisionAt: string): boolean {
  return feature.provenance.length > 0 && feature.provenance.every((p) => p.availableAt <= decisionAt);
}

/** Structural + point-in-time validation. Empty array = usable evidence. */
export function validateSignalEvidence(signal: SignalEvidence): string[] {
  const errors: string[] = [];
  if (!signal.signalId || !signal.ticker || !signal.modelVersion) errors.push("identity_missing");
  if (!Number.isFinite(signal.rawScore)) errors.push("raw_score_invalid");
  if (
    signal.calibratedProbability != null &&
    (signal.calibratedProbability < 0 || signal.calibratedProbability > 1)
  ) errors.push("probability_out_of_range");
  if (signal.effectiveSampleSize != null && signal.effectiveSampleSize < 0) errors.push("sample_size_negative");
  if (signal.decisionAt < signal.generatedAt) errors.push("decision_before_generation");
  for (const feature of signal.features) {
    if (!isFeatureAvailableAt(feature, signal.decisionAt)) errors.push(`feature_not_available:${feature.name}`);
  }
  return errors;
}
