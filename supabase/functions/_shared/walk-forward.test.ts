import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createWalkForwardFolds, validateFoldDisjointness } from "./walk-forward.ts";

Deno.test("walk-forward folds are chronological and disjoint", () => {
  const observations = Array.from({ length: 40 }, (_, i) => ({ start: i, end: i + 1 }));
  const folds = createWalkForwardFolds(observations, {
    validationSize: 8, testSize: 8, stepSize: 8, purgeBars: 2, embargoBars: 3, labelHorizonBars: 5,
  });
  assert(folds.length > 0);
  for (const fold of folds) {
    assert(fold.train.every((i) => i < fold.validation[0]));
    assert(fold.validation.every((i) => i < fold.test[0]));
    assertEquals(validateFoldDisjointness(fold), []);
    assert(fold.purged.every((i) => !fold.train.includes(i)));
    assert(fold.embargoed.every((i) => !fold.test.includes(i)));
  }
});

Deno.test("purge removes training rows whose labels reach validation", () => {
  const folds = createWalkForwardFolds(
    Array.from({ length: 20 }, (_, i) => ({ start: i, end: i + 1 })),
    { validationSize: 5, testSize: 5, purgeBars: 0, embargoBars: 0, labelHorizonBars: 5 },
  );
  assert(folds[0].purged.includes(4));
});
