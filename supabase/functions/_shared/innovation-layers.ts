// ============================================================================
// INNOVATION LAYERS
//
// Pure, deterministic research primitives for opt-in strategy experiments.
// No IO, no model loading, no hidden defaults — the live scanner and the
// backtester consume identical calculations.
// ============================================================================

export interface ReboundMomentumFeatures {
  momentum12m: number;
  near52WeekHigh: number;
  momentumVolatility: number;
  marketReturn20d: number;
  marketVolatility20d: number;
  reboundRisk: number;
  score: number;
  exposureMultiplier: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function simpleReturns(close: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const a = close[i - 1], b = close[i];
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) out.push((b - a) / a);
  }
  return out;
}

export function annualizedVolatility(returns: number[], lookback = 20): number {
  const window = returns.slice(-Math.max(2, lookback)).filter(Number.isFinite);
  if (window.length < 2) return 0;
  const mean = window.reduce((sum, x) => sum + x, 0) / window.length;
  const variance = window.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (window.length - 1);
  return Math.sqrt(Math.max(0, variance) * 252);
}

export function nearHigh(close: number[], lookback = 252): number {
  if (!close.length) return 0;
  const px = close[close.length - 1];
  const window = close.slice(-Math.max(2, lookback)).filter((x) => x > 0 && Number.isFinite(x));
  if (!window.length) return 0;
  const high = Math.max(...window);
  return high > 0 ? clamp(px / high, 0, 1) : 0;
}

export function cumulativeReturn(close: number[], lookback: number): number {
  if (close.length <= lookback) return 0;
  const start = close[close.length - 1 - lookback];
  const end = close[close.length - 1];
  return start > 0 && end > 0 ? end / start - 1 : 0;
}

/**
 * Conservative rebound-risk score. Rises when the market has recently fallen,
 * market volatility is elevated, and the stock is far from its high — the
 * combination associated with momentum-crash conditions.
 */
export function computeReboundRisk(
  stockNearHigh: number,
  marketReturn20d: number,
  marketVolatility20d: number,
  crossSectionalDispersion = 0,
): number {
  const drawdownComponent = clamp((0.90 - stockNearHigh) / 0.45, 0, 1);
  const marketStress = clamp(-marketReturn20d / 0.15, 0, 1);
  const volStress = clamp((marketVolatility20d - 0.18) / 0.35, 0, 1);
  const dispersionStress = clamp((crossSectionalDispersion - 0.02) / 0.08, 0, 1);
  return clamp(
    0.35 * drawdownComponent + 0.35 * marketStress + 0.20 * volStress + 0.10 * dispersionStress,
    0,
    1,
  );
}

export function reboundAwareMomentum(
  stockClose: number[],
  marketClose: number[],
  crossSectionalDispersion = 0,
): ReboundMomentumFeatures {
  const stockReturns = simpleReturns(stockClose);
  const marketReturns = simpleReturns(marketClose);
  const momentum12m = cumulativeReturn(stockClose, 252);
  const stockNearHigh = nearHigh(stockClose, 252);
  const marketReturn20d = cumulativeReturn(marketClose, 20);
  const marketVolatility20d = annualizedVolatility(marketReturns, 20);
  const reboundRisk = computeReboundRisk(stockNearHigh, marketReturn20d, marketVolatility20d, crossSectionalDispersion);
  return {
    momentum12m,
    near52WeekHigh: stockNearHigh,
    momentumVolatility: annualizedVolatility(stockReturns, 60),
    marketReturn20d,
    marketVolatility20d,
    reboundRisk,
    // Penalize crash-vulnerable momentum, but never reverse the underlying alpha.
    score: momentum12m * (1 - 0.55 * reboundRisk),
    // Exposure contracts gradually in stress rather than switching discontinuously.
    exposureMultiplier: 1 - 0.65 * reboundRisk,
  };
}

export interface UncertaintyScoreInput {
  rawScore: number;
  modelDisagreement?: number;
  dataAgeHours?: number;
  notionalDollars?: number;
  advDollars?: number;
  atrPct?: number;
}

/**
 * Raw conviction → tradable conviction. Penalties are monotone: disagreement,
 * stale data, illiquidity, and high volatility can never improve a signal.
 */
export function uncertaintyAdjustedScore(input: UncertaintyScoreInput): number {
  const raw = clamp(finiteOr(input.rawScore, 0), 0, 1);
  const disagreementPenalty = 1 - 0.45 * clamp(finiteOr(input.modelDisagreement ?? 0, 0), 0, 1);
  const agePenalty = 1 - 0.35 * clamp(finiteOr(input.dataAgeHours ?? 0, 0) / 24, 0, 1);
  const participation = input.advDollars && input.notionalDollars && input.advDollars > 0
    ? clamp(input.notionalDollars / input.advDollars, 0, 1)
    : 0;
  const liquidityPenalty = 1 - 0.50 * Math.sqrt(participation);
  const volatilityPenalty = 1 - 0.25 * clamp(finiteOr(input.atrPct ?? 0, 0) / 0.10, 0, 1);
  return clamp(raw * disagreementPenalty * agePenalty * liquidityPenalty * volatilityPenalty, 0, 1);
}

export interface ExpertSleeve {
  name: string;
  recentReturn: number;
  recentVolatility: number;
  drawdown: number;
  previousWeight?: number;
}

export interface ExpertAllocationOptions {
  riskFreeRate?: number;
  exploration?: number;
  turnoverPenalty?: number;
  minWeight?: number;
  maxWeight?: number;
}

/**
 * Online expert allocation across sleeves (Anchor / Core / Sprint). Softmax
 * over risk-adjusted recent performance with an exploration floor, so a sleeve
 * is never permanently abandoned after one bad window.
 */
export function allocateExpertSleeves(
  experts: ExpertSleeve[],
  options: ExpertAllocationOptions = {},
): Record<string, number> {
  if (!experts.length) return {};
  const rf = options.riskFreeRate ?? 0;
  const exploration = clamp(options.exploration ?? 0.10, 0, 0.50);
  const turnoverPenalty = Math.max(0, options.turnoverPenalty ?? 0.20);
  const minWeight = clamp(options.minWeight ?? 0, 0, 0.25);
  const maxWeight = clamp(options.maxWeight ?? 1, Math.max(minWeight, 0.01), 1);
  const scores = experts.map((e) => {
    const vol = Math.max(0.01, Math.abs(finiteOr(e.recentVolatility, 0.01)));
    const sharpeLike = (finiteOr(e.recentReturn, 0) - rf) / vol;
    const drawdownPenalty = clamp(Math.abs(finiteOr(e.drawdown, 0)) / 0.20, 0, 1);
    const turnover = Math.abs(finiteOr(e.previousWeight ?? 0, 0));
    return clamp(sharpeLike - 1.25 * drawdownPenalty - turnoverPenalty * turnover, -8, 8);
  });
  const maxScore = Math.max(...scores);
  const expScores = scores.map((s) => Math.exp(s - maxScore));
  const total = expScores.reduce((a, b) => a + b, 0) || 1;
  const uniform = 1 / experts.length;
  const weights = expScores.map((x) => (1 - exploration) * (x / total) + exploration * uniform);
  const bounded = weights.map((w) => clamp(w, minWeight, maxWeight));
  const boundedTotal = bounded.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(experts.map((e, i) => [e.name, bounded[i] / boundedTotal]));
}
