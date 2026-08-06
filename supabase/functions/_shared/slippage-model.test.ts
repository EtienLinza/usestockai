import {
  assert,
  assertAlmostEquals,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  estimateExpectedEdgeBps,
  estimateSlippage,
  slippageShrinkFactor,
} from "./slippage-model.ts";

Deno.test("slippage: permanent impact is linear and temporary impact square-root in participation", () => {
  const small = estimateSlippage(10_000, 1_000_000, 0.02); // 1% of ADV
  const big = estimateSlippage(40_000, 1_000_000, 0.02); // 4% of ADV

  assertAlmostEquals(small.participation, 0.01, 1e-12);
  assertAlmostEquals(big.permanentBps / small.permanentBps, 4, 1e-9);
  assertAlmostEquals(big.temporaryBps / small.temporaryBps, 2, 1e-9);
  assertAlmostEquals(big.bps, big.permanentBps + big.temporaryBps, 0.01);
});

Deno.test("slippage: a zero-size order costs nothing", () => {
  assertEquals(estimateSlippage(0, 1_000_000, 0.02), {
    bps: 0,
    participation: 0,
    permanentBps: 0,
    temporaryBps: 0,
  });
});

Deno.test("slippage: negative notional is treated as zero", () => {
  assertEquals(estimateSlippage(-5000, 1_000_000, 0.02).bps, 0);
});

Deno.test("slippage: participation is capped at 100% of ADV", () => {
  const huge = estimateSlippage(10_000_000, 100_000, 0.02);
  assertEquals(huge.participation, 1);
  assertEquals(huge.permanentBps, 10);
});

Deno.test("slippage: volatility is clamped to the 0.1%–20% band", () => {
  const belowBand = estimateSlippage(10_000, 1_000_000, 0);
  const atFloor = estimateSlippage(10_000, 1_000_000, 0.001);
  const aboveBand = estimateSlippage(10_000, 1_000_000, 5);
  const atCap = estimateSlippage(10_000, 1_000_000, 0.20);

  assertEquals(belowBand.bps, atFloor.bps);
  assertEquals(aboveBand.bps, atCap.bps);
});

Deno.test("slippage: a zero-ADV name degrades to the capped participation instead of dividing by zero", () => {
  const est = estimateSlippage(10_000, 0, 0.02);
  assert(Number.isFinite(est.bps));
  assertEquals(est.participation, 1);
});

Deno.test("edge: expected edge scales with the take-profit multiple and clamps ATR", () => {
  assertEquals(estimateExpectedEdgeBps(0.02), 400);
  assertEquals(estimateExpectedEdgeBps(0.02, 4), 800);
  assertEquals(estimateExpectedEdgeBps(0.5), estimateExpectedEdgeBps(0.10));
  assertEquals(estimateExpectedEdgeBps(0), estimateExpectedEdgeBps(0.001));
});

Deno.test("shrink: orders whose impact fits inside the edge budget are left untouched", () => {
  const { factor, bps, edgeBps } = slippageShrinkFactor(10_000, 50_000_000, 0.02);
  assertEquals(factor, 1);
  assertEquals(edgeBps, 400);
  assert(bps <= edgeBps * 0.30);
});

Deno.test("shrink: oversized orders are cut and the reported cost is the post-shrink estimate", () => {
  // Low-ATR name: the expected edge (20 bps) is small enough for impact to eat it.
  const notional = 10_000_000;
  const adv = 5_000_000;
  const atr = 0.001;
  const before = estimateSlippage(notional, adv, atr);
  const { factor, bps, edgeBps } = slippageShrinkFactor(notional, adv, atr);

  assertEquals(edgeBps, 20);
  assert(factor > 0 && factor < 1);
  assert(before.bps > edgeBps * 0.30);
  assert(bps < before.bps);
  assertEquals(bps, estimateSlippage(notional * factor, adv, atr).bps);
});

Deno.test("shrink: a tighter impact budget shrinks the order further", () => {
  const loose = slippageShrinkFactor(10_000_000, 5_000_000, 0.001, 2, 0.30);
  const tight = slippageShrinkFactor(10_000_000, 5_000_000, 0.001, 2, 0.10);
  assert(tight.factor < loose.factor);
});
