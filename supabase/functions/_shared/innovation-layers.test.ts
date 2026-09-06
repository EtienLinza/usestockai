import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allocateExpertSleeves, computeReboundRisk, reboundAwareMomentum, uncertaintyAdjustedScore } from "./innovation-layers.ts";

Deno.test("rebound risk rises in a stressed market", () => {
  const calm = computeReboundRisk(0.98, 0.02, 0.12, 0.01);
  const stressed = computeReboundRisk(0.55, -0.12, 0.42, 0.08);
  assert(stressed > calm);
  assert(calm >= 0 && stressed <= 1);
});

Deno.test("momentum exposure contracts but never flips sign", () => {
  const stock = Array.from({ length: 300 }, (_, i) => 100 + i * 0.4);
  const marketCalm = Array.from({ length: 300 }, (_, i) => 100 + i * 0.2);
  const marketCrash = Array.from({ length: 300 }, (_, i) => (i < 260 ? 100 + i * 0.2 : 152 - (i - 260) * 1.4));
  const calm = reboundAwareMomentum(stock, marketCalm);
  const crash = reboundAwareMomentum(stock, marketCrash);
  assert(crash.exposureMultiplier < calm.exposureMultiplier);
  assert(crash.score > 0 && crash.score <= calm.score);
});

Deno.test("uncertainty penalties are monotone", () => {
  const clean = uncertaintyAdjustedScore({ rawScore: 0.8 });
  const noisy = uncertaintyAdjustedScore({ rawScore: 0.8, modelDisagreement: 0.9, dataAgeHours: 48, atrPct: 0.12 });
  assert(noisy < clean && noisy >= 0);
});

Deno.test("sleeve allocation favours the better sleeve but keeps exploration", () => {
  const weights = allocateExpertSleeves([
    { name: "anchor", recentReturn: 0.04, recentVolatility: 0.10, drawdown: -0.02 },
    { name: "core", recentReturn: 0.01, recentVolatility: 0.12, drawdown: -0.05 },
    { name: "sprint", recentReturn: -0.03, recentVolatility: 0.20, drawdown: -0.15 },
  ]);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  assert(Math.abs(total - 1) < 1e-9);
  assert(weights.anchor > weights.core && weights.core > weights.sprint);
  assert(weights.sprint > 0);
});
