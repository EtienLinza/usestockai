import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allocateCapital, computeTradeEconomics, eventImpulse, shrinkProbability } from "./quant-core.ts";

Deno.test("small samples shrink toward the base rate", () => {
  const small = shrinkProbability({ predictedWinProbability: 0.95, baseRate: 0.50, effectiveSampleSize: 2, priorStrength: 50 });
  const large = shrinkProbability({ predictedWinProbability: 0.95, baseRate: 0.50, effectiveSampleSize: 500, priorStrength: 50 });
  assert(Math.abs(small.probability - 0.50) < Math.abs(large.probability - 0.50));
  assert(small.confidence < large.confidence);
});

Deno.test("costs can turn an apparent edge negative", () => {
  const economics = computeTradeEconomics(
    { predictedWinProbability: 0.60, baseRate: 0.50, effectiveSampleSize: 500 },
    { winReturnPct: 1, lossReturnPct: 1, expectedCostPct: 0.50 },
  );
  assert(economics.expectedNetReturnPct < 0);
});

Deno.test("capital allocation respects the portfolio risk budget", () => {
  const weights = allocateCapital([
    { id: "a", expectedNetReturnPct: 2, volatilityPct: 10, riskBudgetPct: 2, liquidityCapacityPct: 1 },
    { id: "b", expectedNetReturnPct: 1, volatilityPct: 8, riskBudgetPct: 2, liquidityCapacityPct: 1 },
    { id: "bad", expectedNetReturnPct: -2, volatilityPct: 10, riskBudgetPct: 2, liquidityCapacityPct: 1 },
  ], { maxPortfolioRiskPct: 6, maxCandidateWeight: 0.25 });
  assertEquals(weights.bad, 0);
  assert(Object.values(weights).reduce((a, b) => a + b, 0) <= 6 + 1e-9);
  assert(weights.a > 0 && weights.b > 0);
});

Deno.test("event impulse decays with time", () => {
  const fresh = eventImpulse({ surpriseZ: 2, revisionZ: 2, priceConfirmationZ: 2, hoursSinceAnnouncement: 0 });
  const old = eventImpulse({ surpriseZ: 2, revisionZ: 2, priceConfirmationZ: 2, hoursSinceAnnouncement: 72 });
  assert(Math.abs(fresh) > Math.abs(old));
});
