// ============================================================================
// ENSEMBLE — Milestone 2
// Four lightweight base models + stacked meta-learner + isotonic + Platt.
// Pure-JS, no deps. Trained nightly on `signal_outcomes` with
// non-null `feature_snapshot`. Produces a portable JSON coefficient
// blob stored on `strategy_weights.notes.ensemble` and mirrored into
// `model_versions` as a challenger row.
//
// Design constraints (see .lovable/plan.md M2):
//   - Cost ceiling: 4 models × ~10k rows should run in <2s
//   - Zero dependencies (Deno-friendly, no npm)
//   - Deterministic given seeded rows (backtests must reproduce)
//   - Fails soft: any base model that can't be fit is dropped
//     from the stack and the meta-learner reweights.
//   - Uncertainty-aware: every stored weight ships with sample size
//     so downstream shrinkage/CI logic works.
// ============================================================================

import { pav } from "./calibration.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type Row = { x: number[]; y: 0 | 1; w?: number };
export interface FitReport {
  n: number;
  logLoss: number;
  brier: number;
  accuracy: number;
}

export interface EnsembleModel {
  featureNames: string[];
  featureMeans: number[];
  featureStds: number[];
  logistic: LogisticModel | null;
  nb: NaiveBayesModel | null;
  ridge: RidgeModel | null;
  tree: TreeModel | null;
  meta: LogisticModel;                       // stacked meta over base outputs
  isotonic: { x: number; y: number }[];      // monotone calibration curve
  platt: { a: number; b: number };           // sigmoid post-cal
  regimeMetaWeights?: Record<string, number[]>; // optional per-regime override
  training: {
    trainedAt: string;
    sampleSize: number;
    holdoutReport: FitReport;
    perModel: Record<string, FitReport>;
    featureSampleSize: number[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-clamp(z, -50, 50)));

/** Deterministic PRNG (mulberry32) so retraining on same rows is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standardize columns; returns (Z, mean, std) with std floored to 1e-6. */
function standardize(rows: Row[]): { Z: Row[]; mean: number[]; std: number[] } {
  if (!rows.length) return { Z: [], mean: [], std: [] };
  const d = rows[0].x.length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r.x[j];
  for (let j = 0; j < d; j++) mean[j] /= rows.length;
  for (const r of rows) for (let j = 0; j < d; j++) std[j] += (r.x[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / Math.max(1, rows.length - 1)) || 1e-6;
  const Z = rows.map((r) => ({
    ...r,
    x: r.x.map((v, j) => (v - mean[j]) / std[j]),
  }));
  return { Z, mean, std };
}

function applyStandardize(x: number[], mean: number[], std: number[]) {
  return x.map((v, j) => (v - mean[j]) / (std[j] || 1e-6));
}

function evaluate(probs: number[], y: (0 | 1)[]): FitReport {
  const n = probs.length;
  let ll = 0, br = 0, correct = 0;
  for (let i = 0; i < n; i++) {
    const p = clamp(probs[i], 1e-6, 1 - 1e-6);
    ll += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
    br += (p - y[i]) ** 2;
    if ((p >= 0.5 ? 1 : 0) === y[i]) correct++;
  }
  return { n, logLoss: ll / Math.max(1, n), brier: br / Math.max(1, n), accuracy: correct / Math.max(1, n) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Model 1 — Logistic Regression (L2, batch GD)
// ─────────────────────────────────────────────────────────────────────────────
export interface LogisticModel { w: number[]; b: number; }

export function fitLogistic(rows: Row[], opts: { l2?: number; lr?: number; iters?: number } = {}): LogisticModel | null {
  if (rows.length < 20) return null;
  const d = rows[0].x.length;
  const l2 = opts.l2 ?? 0.5;
  const lr = opts.lr ?? 0.05;
  const iters = opts.iters ?? 200;
  const w = new Array(d).fill(0);
  let b = 0;
  const n = rows.length;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (const r of rows) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * r.x[j];
      const p = sigmoid(z);
      const err = p - r.y;
      for (let j = 0; j < d; j++) gw[j] += err * r.x[j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j] / n);
    b -= lr * (gb / n);
  }
  return { w, b };
}
export function predictLogistic(m: LogisticModel, x: number[]): number {
  let z = m.b;
  for (let j = 0; j < m.w.length; j++) z += m.w[j] * x[j];
  return sigmoid(z);
}

// ─────────────────────────────────────────────────────────────────────────────
// Model 2 — Gaussian Naive Bayes
// ─────────────────────────────────────────────────────────────────────────────
export interface NaiveBayesModel {
  prior: [number, number];
  mean: number[][];   // [class][feature]
  var: number[][];
}

export function fitNaiveBayes(rows: Row[]): NaiveBayesModel | null {
  if (rows.length < 20) return null;
  const d = rows[0].x.length;
  const counts = [0, 0];
  const mean = [new Array(d).fill(0), new Array(d).fill(0)];
  const M2 = [new Array(d).fill(0), new Array(d).fill(0)];
  for (const r of rows) {
    counts[r.y]++;
    const m = mean[r.y], m2 = M2[r.y];
    for (let j = 0; j < d; j++) {
      const delta = r.x[j] - m[j];
      m[j] += delta / counts[r.y];
      m2[j] += delta * (r.x[j] - m[j]);
    }
  }
  if (counts[0] < 5 || counts[1] < 5) return null;
  const varArr = [
    M2[0].map((v) => Math.max(1e-4, v / Math.max(1, counts[0] - 1))),
    M2[1].map((v) => Math.max(1e-4, v / Math.max(1, counts[1] - 1))),
  ];
  const total = counts[0] + counts[1];
  return { prior: [counts[0] / total, counts[1] / total], mean, var: varArr };
}
export function predictNaiveBayes(m: NaiveBayesModel, x: number[]): number {
  const ll = [Math.log(m.prior[0]), Math.log(m.prior[1])];
  for (let c = 0; c < 2; c++) {
    for (let j = 0; j < x.length; j++) {
      const v = m.var[c][j];
      ll[c] += -0.5 * Math.log(2 * Math.PI * v) - ((x[j] - m.mean[c][j]) ** 2) / (2 * v);
    }
  }
  const maxLL = Math.max(ll[0], ll[1]);
  const e0 = Math.exp(ll[0] - maxLL), e1 = Math.exp(ll[1] - maxLL);
  return e1 / (e0 + e1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Model 3 — Ridge classifier (closed-form ridge on ±1 targets → sigmoid)
// ─────────────────────────────────────────────────────────────────────────────
export interface RidgeModel { w: number[]; b: number; scale: number; }

function ridgeSolve(X: number[][], y: number[], lambda: number): number[] {
  // Solve (X^T X + λI) β = X^T y using Gauss–Jordan. Small d so O(d^3) is fine.
  const d = X[0].length;
  const A: number[][] = Array.from({ length: d }, () => new Array(d + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < d; j++) {
      for (let k = 0; k < d; k++) A[j][k] += X[i][j] * X[i][k];
      A[j][d] += X[i][j] * y[i];
    }
  }
  for (let j = 0; j < d; j++) A[j][j] += lambda;
  for (let j = 0; j < d; j++) {
    let piv = j;
    for (let i = j + 1; i < d; i++) if (Math.abs(A[i][j]) > Math.abs(A[piv][j])) piv = i;
    if (Math.abs(A[piv][j]) < 1e-10) continue;
    [A[j], A[piv]] = [A[piv], A[j]];
    const pv = A[j][j];
    for (let k = j; k <= d; k++) A[j][k] /= pv;
    for (let i = 0; i < d; i++) if (i !== j) {
      const f = A[i][j];
      for (let k = j; k <= d; k++) A[i][k] -= f * A[j][k];
    }
  }
  return A.map((r) => r[d]);
}

export function fitRidge(rows: Row[], lambda = 1.0): RidgeModel | null {
  if (rows.length < 20) return null;
  const d = rows[0].x.length;
  // Add bias column
  const X = rows.map((r) => [1, ...r.x]);
  const y = rows.map((r) => (r.y === 1 ? 1 : -1));
  const beta = ridgeSolve(X, y, lambda);
  // Fit a scaling constant so the linear score maps to a reasonable sigmoid.
  const scores = X.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const varS = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, scores.length - 1);
  const scale = 1 / Math.max(0.25, Math.sqrt(varS));
  return { w: beta.slice(1), b: beta[0], scale };
}
export function predictRidge(m: RidgeModel, x: number[]): number {
  let z = m.b;
  for (let j = 0; j < m.w.length; j++) z += m.w[j] * x[j];
  return sigmoid(z * m.scale);
}

// ─────────────────────────────────────────────────────────────────────────────
// Model 4 — Depth-3 CART (gini)
// ─────────────────────────────────────────────────────────────────────────────
export type TreeNode =
  | { leaf: true; p: number }
  | { leaf: false; feature: number; threshold: number; left: TreeNode; right: TreeNode };
export interface TreeModel { root: TreeNode; }

function gini(pos: number, total: number): number {
  if (total === 0) return 0;
  const p = pos / total;
  return 1 - p * p - (1 - p) * (1 - p);
}

function buildTree(rows: Row[], depth: number, maxDepth: number, minLeaf: number): TreeNode {
  const total = rows.length;
  const pos = rows.reduce((s, r) => s + r.y, 0);
  const p = total ? pos / total : 0.5;
  if (depth >= maxDepth || total < 2 * minLeaf || pos === 0 || pos === total) {
    return { leaf: true, p: clamp(p, 1e-3, 1 - 1e-3) };
  }
  const d = rows[0].x.length;
  let best: { feat: number; th: number; gain: number; left: Row[]; right: Row[] } | null = null;
  const baseImp = gini(pos, total);
  for (let j = 0; j < d; j++) {
    const vals = rows.map((r) => r.x[j]).sort((a, b) => a - b);
    // 5 candidate splits at quantiles
    const cands: number[] = [];
    for (const q of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      cands.push(vals[Math.floor((vals.length - 1) * q)]);
    }
    for (const th of cands) {
      const L: Row[] = [], R: Row[] = [];
      for (const r of rows) (r.x[j] <= th ? L : R).push(r);
      if (L.length < minLeaf || R.length < minLeaf) continue;
      const lp = L.reduce((s, r) => s + r.y, 0);
      const rp = R.reduce((s, r) => s + r.y, 0);
      const wImp = (L.length / total) * gini(lp, L.length) + (R.length / total) * gini(rp, R.length);
      const gain = baseImp - wImp;
      if (!best || gain > best.gain) best = { feat: j, th, gain, left: L, right: R };
    }
  }
  if (!best || best.gain <= 1e-4) return { leaf: true, p: clamp(p, 1e-3, 1 - 1e-3) };
  return {
    leaf: false, feature: best.feat, threshold: best.th,
    left: buildTree(best.left, depth + 1, maxDepth, minLeaf),
    right: buildTree(best.right, depth + 1, maxDepth, minLeaf),
  };
}

export function fitTree(rows: Row[], maxDepth = 3, minLeaf = 15): TreeModel | null {
  if (rows.length < 40) return null;
  return { root: buildTree(rows, 0, maxDepth, minLeaf) };
}
export function predictTree(m: TreeModel, x: number[]): number {
  let n: TreeNode = m.root;
  while (!n.leaf) n = x[n.feature] <= n.threshold ? n.left : n.right;
  return n.p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Isotonic + Platt
// ─────────────────────────────────────────────────────────────────────────────
export function fitIsotonic(scores: number[], y: (0 | 1)[]): { x: number; y: number }[] {
  const pts = scores.map((s, i) => ({ x: s, y: y[i], w: 1 })).sort((a, b) => a.x - b.x);
  const monotone = pav(pts as any);
  return monotone.map((p) => ({ x: p.x, y: clamp(p.y, 1e-4, 1 - 1e-4) }));
}
export function applyIso(iso: { x: number; y: number }[], s: number): number {
  if (!iso.length) return s;
  if (s <= iso[0].x) return iso[0].y;
  if (s >= iso[iso.length - 1].x) return iso[iso.length - 1].y;
  for (let i = 0; i < iso.length - 1; i++) {
    const a = iso[i], b = iso[i + 1];
    if (s >= a.x && s <= b.x) {
      const t = (s - a.x) / Math.max(1e-9, b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return iso[iso.length - 1].y;
}

/** Platt: fit sigmoid(a·s + b) on (score, y) via a few Newton iterations. */
export function fitPlatt(scores: number[], y: (0 | 1)[]): { a: number; b: number } {
  let a = 1, b = 0;
  for (let it = 0; it < 50; it++) {
    let gA = 0, gB = 0, hAA = 0, hAB = 0, hBB = 0;
    for (let i = 0; i < scores.length; i++) {
      const p = sigmoid(a * scores[i] + b);
      const err = p - y[i];
      gA += err * scores[i];
      gB += err;
      const wp = p * (1 - p);
      hAA += wp * scores[i] * scores[i];
      hAB += wp * scores[i];
      hBB += wp;
    }
    const det = hAA * hBB - hAB * hAB;
    if (Math.abs(det) < 1e-9) break;
    const dA = (hBB * gA - hAB * gB) / det;
    const dB = (-hAB * gA + hAA * gB) / det;
    a -= dA; b -= dB;
    if (Math.abs(dA) + Math.abs(dB) < 1e-6) break;
  }
  return { a, b };
}
export const applyPlatt = (p: { a: number; b: number }, s: number) => sigmoid(p.a * s + p.b);

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble training pipeline
// ─────────────────────────────────────────────────────────────────────────────
export interface EnsembleInputRow {
  features: Record<string, number>;
  y: 0 | 1;
  regime?: string | null;
}

/**
 * Build the union of feature keys observed across rows with count ≥ minSupport.
 * Missing values are imputed to the column median.
 */
function buildFeatureMatrix(input: EnsembleInputRow[], minSupport = 30) {
  const supportCount = new Map<string, number>();
  for (const r of input) for (const k of Object.keys(r.features)) {
    const v = r.features[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      supportCount.set(k, (supportCount.get(k) ?? 0) + 1);
    }
  }
  const featureNames = [...supportCount.entries()]
    .filter(([, c]) => c >= minSupport)
    .map(([k]) => k)
    .sort();
  if (!featureNames.length) return null;

  // Column medians for imputation
  const cols: number[][] = featureNames.map(() => []);
  for (const r of input) featureNames.forEach((k, j) => {
    const v = r.features[k];
    if (typeof v === "number" && Number.isFinite(v)) cols[j].push(v);
  });
  const medians = cols.map((c) => {
    if (!c.length) return 0;
    const s = [...c].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  });

  const rows: Row[] = input.map((r) => ({
    x: featureNames.map((k, j) => {
      const v = r.features[k];
      return typeof v === "number" && Number.isFinite(v) ? v : medians[j];
    }),
    y: r.y,
  }));
  const featureSampleSize = featureNames.map((k) => supportCount.get(k) ?? 0);
  return { rows, featureNames, featureSampleSize };
}

/**
 * Train the full ensemble on labelled rows. Returns null if data is too
 * sparse for even a logistic to fit (< 60 rows or < 3 usable features).
 */
export function trainEnsemble(
  input: EnsembleInputRow[],
  opts: { seed?: number; holdoutFrac?: number; regimeMinSamples?: number } = {},
): EnsembleModel | null {
  if (input.length < 60) return null;
  const built = buildFeatureMatrix(input);
  if (!built || built.featureNames.length < 3) return null;
  const { rows, featureNames, featureSampleSize } = built;
  const regimes = input.map((r) => (r.regime ?? "unknown"));

  // Deterministic shuffle + holdout split
  const rand = mulberry32(opts.seed ?? 1337);
  const idx = rows.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const holdoutFrac = opts.holdoutFrac ?? 0.2;
  const nHold = Math.max(20, Math.floor(rows.length * holdoutFrac));
  const holdIdx = new Set(idx.slice(0, nHold));
  const train = rows.filter((_, i) => !holdIdx.has(i));
  const hold = rows.filter((_, i) => holdIdx.has(i));

  const std = standardize(train);
  const Ztrain = std.Z;
  const Zhold = hold.map((r) => ({ ...r, x: applyStandardize(r.x, std.mean, std.std) }));

  // Base fits
  const logistic = fitLogistic(Ztrain, { l2: 0.5, iters: 250 });
  const nb = fitNaiveBayes(Ztrain);
  const ridge = fitRidge(Ztrain, 1.0);
  const tree = fitTree(Ztrain, 3, Math.max(15, Math.floor(train.length * 0.05)));

  // Out-of-fold base predictions on training set via 5-fold split (for meta-learner)
  const K = 5;
  const foldIdx = Ztrain.map((_, i) => i % K);
  const oof: Row[] = Ztrain.map((r) => ({ x: [0, 0, 0, 0], y: r.y }));
  for (let k = 0; k < K; k++) {
    const tr = Ztrain.filter((_, i) => foldIdx[i] !== k);
    const teIdx = Ztrain.map((_, i) => i).filter((i) => foldIdx[i] === k);
    const mL = logistic ? fitLogistic(tr, { l2: 0.5, iters: 200 }) : null;
    const mN = nb ? fitNaiveBayes(tr) : null;
    const mR = ridge ? fitRidge(tr, 1.0) : null;
    const mT = tree ? fitTree(tr, 3, Math.max(15, Math.floor(tr.length * 0.05))) : null;
    for (const i of teIdx) {
      const x = Ztrain[i].x;
      oof[i].x[0] = mL ? predictLogistic(mL, x) : 0.5;
      oof[i].x[1] = mN ? predictNaiveBayes(mN, x) : 0.5;
      oof[i].x[2] = mR ? predictRidge(mR, x) : 0.5;
      oof[i].x[3] = mT ? predictTree(mT, x) : 0.5;
    }
  }
  const meta = fitLogistic(oof, { l2: 0.2, iters: 300 }) ?? { w: [0.25, 0.25, 0.25, 0.25], b: 0 };

  // Per-regime meta refits: momentum regimes may lean on the tree, mean-reverting on NB.
  const regimeMinSamples = opts.regimeMinSamples ?? 60;
  const trainOrigIdx: number[] = [];
  for (let i = 0; i < idx.length; i++) if (!holdIdx.has(idx[i])) trainOrigIdx.push(idx[i]);
  const regimeMetaWeights: Record<string, number[]> = {};
  const regimeGroups: Record<string, Row[]> = {};
  for (let i = 0; i < oof.length; i++) {
    const reg = regimes[trainOrigIdx[i]] ?? "unknown";
    (regimeGroups[reg] ??= []).push(oof[i]);
  }
  for (const [reg, rs] of Object.entries(regimeGroups)) {
    if (rs.length < regimeMinSamples) continue;
    const rm = fitLogistic(rs, { l2: 0.3, iters: 250 });
    if (rm) regimeMetaWeights[reg] = [...rm.w, rm.b];
  }

  // Score holdout via base models + meta
  const holdScores: number[] = Zhold.map((r) => {
    const bx = [
      logistic ? predictLogistic(logistic, r.x) : 0.5,
      nb ? predictNaiveBayes(nb, r.x) : 0.5,
      ridge ? predictRidge(ridge, r.x) : 0.5,
      tree ? predictTree(tree, r.x) : 0.5,
    ];
    return predictLogistic(meta, bx);
  });
  const holdY = Zhold.map((r) => r.y);

  // Fit isotonic + Platt on holdout
  const isotonic = fitIsotonic(holdScores, holdY);
  const isoProbs = holdScores.map((s) => applyIso(isotonic, s));
  const platt = fitPlatt(isoProbs, holdY);
  const finalProbs = isoProbs.map((p) => applyPlatt(platt, p));

  const holdoutReport = evaluate(finalProbs, holdY);
  const perModel: Record<string, FitReport> = {};
  const evalBase = (fn: (x: number[]) => number, name: string) => {
    const p = Zhold.map((r) => fn(r.x));
    perModel[name] = evaluate(p, holdY);
  };
  if (logistic) evalBase((x) => predictLogistic(logistic, x), "logistic");
  if (nb) evalBase((x) => predictNaiveBayes(nb, x), "naive_bayes");
  if (ridge) evalBase((x) => predictRidge(ridge, x), "ridge");
  if (tree) evalBase((x) => predictTree(tree, x), "tree");
  perModel["meta_stacked_iso_platt"] = holdoutReport;

  return {
    featureNames,
    featureMeans: std.mean,
    featureStds: std.std,
    logistic, nb, ridge, tree, meta,
    isotonic, platt,
    training: {
      trainedAt: new Date().toISOString(),
      sampleSize: rows.length,
      holdoutReport,
      perModel,
      featureSampleSize,
    },
  };
}

/**
 * Consumer-side prediction. Returns the calibrated ensemble probability in [0,1].
 * Missing features fall back to the training mean (i.e. standardized 0).
 */
export function predictEnsemble(m: EnsembleModel, features: Record<string, number>): number {
  const x = m.featureNames.map((k, j) => {
    const v = features[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return (v - m.featureMeans[j]) / (m.featureStds[j] || 1e-6);
    }
    return 0;
  });
  const bx = [
    m.logistic ? predictLogistic(m.logistic, x) : 0.5,
    m.nb ? predictNaiveBayes(m.nb, x) : 0.5,
    m.ridge ? predictRidge(m.ridge, x) : 0.5,
    m.tree ? predictTree(m.tree, x) : 0.5,
  ];
  const raw = predictLogistic(m.meta, bx);
  const iso = applyIso(m.isotonic, raw);
  return applyPlatt(m.platt, iso);
}
