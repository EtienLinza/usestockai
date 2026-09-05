// ============================================================================
// WALK-FORWARD RESEARCH SPLITTER — purged, embargoed, chronological folds.
//
// Standard "last N days = test" splits leak: a training row whose label window
// reaches into validation already knows the answer. Purge removes those rows;
// embargo removes rows immediately after the test window.
// ============================================================================

export interface TimeSpan {
  start: number;
  end: number;
}

export interface WalkForwardFold {
  train: number[];
  validation: number[];
  test: number[];
  purged: number[];
  embargoed: number[];
}

export interface WalkForwardOptions {
  validationSize: number;
  testSize: number;
  stepSize?: number;
  purgeBars: number;
  embargoBars: number;
  labelHorizonBars: number;
}

/**
 * Generate expanding-window folds. Indices represent decision bars in
 * chronological order — never shuffled observations.
 */
export function createWalkForwardFolds(
  observations: TimeSpan[],
  options: WalkForwardOptions,
): WalkForwardFold[] {
  const n = observations.length;
  const validationSize = Math.max(1, Math.floor(options.validationSize));
  const testSize = Math.max(1, Math.floor(options.testSize));
  const step = Math.max(1, Math.floor(options.stepSize ?? testSize));
  const purge = Math.max(0, Math.floor(options.purgeBars));
  const embargo = Math.max(0, Math.floor(options.embargoBars));
  const horizon = Math.max(0, Math.floor(options.labelHorizonBars));
  const folds: WalkForwardFold[] = [];

  for (
    let validationStart = validationSize;
    validationStart + validationSize + testSize <= n;
    validationStart += step
  ) {
    const validationEnd = validationStart + validationSize;
    const testEnd = Math.min(n, validationEnd + testSize);
    const validation = observations.slice(validationStart, validationEnd).map((_, i) => validationStart + i);
    const test = observations.slice(validationEnd, testEnd).map((_, i) => validationEnd + i);
    const train: number[] = [];
    const purged: number[] = [];
    const embargoed: number[] = [];
    const embargoEnd = Math.min(n, testEnd + embargo);

    for (let i = 0; i < validationStart; i++) {
      const labelEnd = i + horizon;
      if (labelEnd >= validationStart - purge) purged.push(i);
      else train.push(i);
    }
    for (let i = testEnd; i < embargoEnd; i++) embargoed.push(i);
    folds.push({ train, validation, test, purged, embargoed });
  }
  return folds;
}

/** Guard: a fold with any overlap between its groups is a leaking fold. */
export function validateFoldDisjointness(fold: WalkForwardFold): string[] {
  const errors: string[] = [];
  const groups: Array<[string, number[]]> = [
    ["train", fold.train],
    ["validation", fold.validation],
    ["test", fold.test],
    ["purged", fold.purged],
    ["embargoed", fold.embargoed],
  ];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const right = new Set(groups[j][1]);
      for (const value of groups[i][1]) if (right.has(value)) errors.push(`${groups[i][0]}_overlaps_${groups[j][0]}:${value}`);
    }
  }
  return errors;
}
