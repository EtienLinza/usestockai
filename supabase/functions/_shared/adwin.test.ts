import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adwinGateAdjust, detectAdwinDrift } from "./adwin.ts";

const repeat = (value: number, n: number) => Array.from({ length: n }, () => value);

/** Deterministic (seeded LCG) 0/1 series drawn at the requested hit rate. */
function rate(p: number, n: number, seed = 42): number[] {
  let state = seed;
  return Array.from({ length: n }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648 < p ? 1 : 0;
  });
}

Deno.test("adwin: no drift verdict below the 40-observation minimum window", () => {
  const result = detectAdwinDrift([...repeat(1, 20), ...repeat(0, 19)]);
  assertEquals(result, {
    drift: false,
    severity: "none",
    windowSize: 39,
    preMean: 0,
    postMean: 0,
    splitIndex: -1,
  });
});

Deno.test("adwin: a stationary series does not trigger drift", () => {
  const result = detectAdwinDrift(rate(0.5, 200));
  assertEquals(result.drift, false);
  assertEquals(result.severity, "none");
  assertEquals(result.splitIndex, -1);
});

Deno.test("adwin: a collapse in hit rate is flagged as hard drift at the change point", () => {
  const result = detectAdwinDrift([...repeat(1, 100), ...repeat(0, 100)]);
  assert(result.drift);
  assertEquals(result.severity, "hard");
  assertEquals(result.splitIndex, 100);
  assertEquals(result.preMean, 1);
  assertEquals(result.postMean, 0);
  assertEquals(result.windowSize, 200);
});

Deno.test("adwin: improvement is drift too — direction is reported via the means", () => {
  const result = detectAdwinDrift([...repeat(0, 100), ...repeat(1, 100)]);
  assert(result.drift);
  assert(result.postMean > result.preMean);
});

Deno.test("adwin: a shift smaller than the Hoeffding bound stays undetected", () => {
  const result = detectAdwinDrift([...rate(0.5, 100), ...rate(0.52, 100)]);
  assertEquals(result.drift, false);
});

Deno.test("adwin: gate thresholds tighten monotonically with severity", () => {
  assertEquals(adwinGateAdjust("none"), { pass: 0.45, skip: 0.30 });
  assertEquals(adwinGateAdjust("soft"), { pass: 0.55, skip: 0.40 });
  assertEquals(adwinGateAdjust("hard"), { pass: 0.60, skip: 0.45 });
});
