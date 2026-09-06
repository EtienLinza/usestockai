import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createOrderIntent } from "./quant-decision-gateway.ts";
import type { PortfolioRiskState } from "./risk-kernel.ts";
import type { RiskLimits, SignalEvidence, TradeEconomicsContract } from "./quant-contracts.ts";

const signal: SignalEvidence = {
  signalId: "s-gateway-1", ticker: "ABC", side: "long", sleeve: "trend",
  generatedAt: "2026-01-02T10:00:00Z", decisionAt: "2026-01-02T10:00:00Z", modelVersion: "m1",
  rawScore: 0.8, calibratedProbability: 0.65, baseRate: 0.5, effectiveSampleSize: 100,
  modelDisagreement: 0.1, regime: "normal", reboundRisk: 0.1, dataQuality: "verified",
  featureSetVersion: "f1", features: [],
};
const economics: TradeEconomicsContract = {
  expectedWinPct: 2, expectedLossPct: 1, expectedCostPct: 0.1, expectedNetEdgePct: 0.5,
  expectedHoldingBars: 5, decayHalfLifeBars: 10, estimatedParticipationPct: 1, capacityDollars: 100000,
};
const state: PortfolioRiskState = {
  navDollars: 100000, grossExposurePct: 0, netExposurePct: 0, singleNameExposurePct: 0,
  sectorExposurePct: 0, portfolioRiskPct: 0, dailyPnlPct: 0, candidateSectorExposurePct: 0,
  staleDataMinutes: 0, currentShortExposurePct: 0, candidateShortExposurePct: 0,
};
const limits: RiskLimits = {
  maxGrossExposurePct: 100, maxNetExposurePct: 100, maxSingleNamePct: 20, maxSectorPct: 40,
  maxPortfolioRiskPct: 6, maxDailyLossPct: 3, maxCVaRPct: 2, maxParticipationPct: 10,
  maxStaleDataMinutes: 30, allowShorts: true,
};

Deno.test("gateway creates an auditable order intent", () => {
  const result = createOrderIntent({
    candidate: { signal, economics, proposedNotionalDollars: 1000, riskContributionPct: 0.1, correlationLoad: 0, liquidityScore: 1, uncertaintyScore: 0.1 },
    mode: "shadow", now: "2026-01-02T10:00:00Z",
  }, state, limits);
  assert(result.intent !== null);
  assertEquals(result.intent?.ticker, "ABC");
  assertEquals(result.intent?.mode, "shadow");
  assertEquals(result.intent?.risk.allowed, true);
});

Deno.test("gateway blocks negative net edge", () => {
  const result = createOrderIntent({
    candidate: { signal, economics: { ...economics, expectedNetEdgePct: -0.2 }, proposedNotionalDollars: 1000, riskContributionPct: 0.1, correlationLoad: 0, liquidityScore: 1, uncertaintyScore: 0.1 },
    mode: "paper", now: "2026-01-02T10:00:00Z",
  }, state, limits);
  assertEquals(result.intent, null);
  assert(result.blockedReasons.includes("negative_net_edge"));
});

Deno.test("gateway blocks a feature that was not published at decision time", () => {
  const leaking: SignalEvidence = {
    ...signal,
    features: [{
      name: "eps_revision", value: 1.2, version: "v1",
      provenance: [{
        provider: "vendor", dataset: "eps", symbol: "ABC",
        observationAt: "2026-01-02T09:00:00Z",
        availableAt: "2026-01-02T18:00:00Z", // published AFTER the decision
        retrievedAt: "2026-01-02T18:05:00Z", quality: "verified", adjusted: false,
      }],
    }],
  };
  const result = createOrderIntent({
    candidate: { signal: leaking, economics, proposedNotionalDollars: 1000, riskContributionPct: 0.1, correlationLoad: 0, liquidityScore: 1, uncertaintyScore: 0.1 },
    mode: "shadow", now: "2026-01-02T10:00:00Z",
  }, state, limits);
  assertEquals(result.intent, null);
  assert(result.blockedReasons.includes("feature_not_available:eps_revision"));
});

Deno.test("exposure limits veto with named reasons", () => {
  const result = createOrderIntent({
    candidate: { signal, economics, proposedNotionalDollars: 50000, riskContributionPct: 0.1, correlationLoad: 0, liquidityScore: 1, uncertaintyScore: 0.1 },
    mode: "shadow", now: "2026-01-02T10:00:00Z",
  }, state, limits);
  assertEquals(result.intent, null);
  assert(result.blockedReasons.includes("single_name_limit"));
});
