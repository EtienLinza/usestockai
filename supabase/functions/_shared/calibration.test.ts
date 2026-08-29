import {
  assertAlmostEquals,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyIsotonicCalibration, pav, type IsotonicAnchor } from "./calibration.ts";

const anchors: IsotonicAnchor[] = [
  { conviction: 50, calibrated: 45, count: 40 },
  { conviction: 60, calibrated: 58, count: 40 },
  { conviction: 70, calibrated: 72, count: 40 },
  { conviction: 80, calibrated: 90, count: 40 },
];

Deno.test("pav: an already monotonic sequence is returned unchanged", () => {
  const points = [{ x: 1, y: 1, w: 1 }, { x: 2, y: 2, w: 1 }, { x: 3, y: 3, w: 1 }];
  assertEquals(pav(points), points);
});

Deno.test("pav: adjacent violators are pooled into their weighted mean", () => {
  const out = pav([{ x: 1, y: 5, w: 1 }, { x: 2, y: 1, w: 3 }]);
  assertEquals(out.length, 1);
  assertEquals(out[0].x, 2);
  assertEquals(out[0].w, 4);
  assertAlmostEquals(out[0].y, (5 * 1 + 1 * 3) / 4, 1e-12);
});

Deno.test("pav: cascading violations keep pooling until the curve is non-decreasing", () => {
  const out = pav([
    { x: 1, y: 3, w: 1 },
    { x: 2, y: 2, w: 1 },
    { x: 3, y: 1, w: 1 },
    { x: 4, y: 10, w: 1 },
  ]);
  for (let i = 1; i < out.length; i++) assertEquals(out[i].y >= out[i - 1].y, true);
  assertAlmostEquals(out[0].y, 2, 1e-12);
  assertEquals(out[0].w, 3);
  assertEquals(out.at(-1)!.y, 10);
});

Deno.test("pav: does not mutate its input", () => {
  const points = [{ x: 1, y: 5, w: 1 }, { x: 2, y: 1, w: 1 }];
  pav(points);
  assertEquals(points, [{ x: 1, y: 5, w: 1 }, { x: 2, y: 1, w: 1 }]);
});

Deno.test("calibration: falls back to the raw conviction without a usable curve", () => {
  assertEquals(applyIsotonicCalibration(65, undefined), 65);
  assertEquals(applyIsotonicCalibration(65, null), 65);
  assertEquals(applyIsotonicCalibration(65, anchors.slice(0, 2)), 65);
});

Deno.test("calibration: interpolates linearly between anchors", () => {
  assertAlmostEquals(applyIsotonicCalibration(65, anchors), 65, 1e-9); // midpoint of 58 and 72
  assertAlmostEquals(applyIsotonicCalibration(70, anchors), 72, 1e-9);
});

Deno.test("calibration: clamps to the first and last anchor outside the fitted range", () => {
  assertEquals(applyIsotonicCalibration(10, anchors), 20); // 45 target, capped by maxDelta
  assertEquals(applyIsotonicCalibration(95, anchors), 90);
});

Deno.test("calibration: never moves conviction by more than maxDelta", () => {
  assertEquals(applyIsotonicCalibration(80, anchors), 90);
  assertEquals(applyIsotonicCalibration(80, anchors, 3), 83);
  assertEquals(applyIsotonicCalibration(50, anchors, 1), 49);
});

Deno.test("calibration: sorts unordered anchors before interpolating", () => {
  const shuffled = [anchors[3], anchors[0], anchors[2], anchors[1]];
  assertAlmostEquals(applyIsotonicCalibration(65, shuffled), 65, 1e-9);
});

Deno.test("calibration: output stays inside [0, 100]", () => {
  const extreme: IsotonicAnchor[] = [
    { conviction: 0, calibrated: -50, count: 10 },
    { conviction: 50, calibrated: 50, count: 10 },
    { conviction: 100, calibrated: 500, count: 10 },
  ];
  assertEquals(applyIsotonicCalibration(0, extreme, 100), 0);
  assertEquals(applyIsotonicCalibration(100, extreme, 100), 100);
});
