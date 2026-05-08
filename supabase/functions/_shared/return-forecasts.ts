// Multi-horizon expected-return forecasts using GBM with institutional-grade refinements:
//   • Drift μ: blended short (60d) + long (252d) windows, then Bayesian-shrunk toward 0
//     (full sample → no shrinkage; tiny sample → strong shrinkage). Winsorized to ±60% ann.
//   • Volatility σ: EWMA (λ=0.94, RiskMetrics standard) — reacts to recent regime shifts
//     while staying smoother than rolling windows.
//   • Probability of positive return per horizon: Φ((μh + 0.5σ²h)/(σ√h)) using a closed-form
//     normal CDF approximation (Abramowitz & Stegun 7.1.26, error <1.5e-7).
//   • 1σ band reported for plain-English uncertainty.

export type Horizon = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export const HORIZON_DAYS: Record<Horizon, number> = {
  daily: 1,
  weekly: 5,
  monthly: 21,
  quarterly: 63,
  yearly: 252,
};

export interface ForecastEntry {
  expectedPct: number;        // expected % return over horizon (GBM mean)
  medianPct: number;          // median % return (lognormal median)
  lowPct: number;             // 1σ lower band
  highPct: number;            // 1σ upper band
  probUpPct: number;          // P(return > 0), 0–100
  annualizedVolPct: number;
}

export type ForecastBundle = Record<Horizon, ForecastEntry> & {
  asOfPrice: number;
  driftAnnualPct: number;
  driftMethod: "blended-shrunk";
  volMethod: "ewma-0.94";
  sampleSize: number;
};

/** Standard normal CDF — Abramowitz & Stegun 7.1.26 (max abs err ~7.5e-8). */
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
            * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Mean of an array slice, ignoring non-finite values. */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0, n = 0;
  for (const x of arr) if (Number.isFinite(x)) { s += x; n++; }
  return n ? s / n : 0;
}

/** Build daily log-return series from closes. */
function logReturns(close: number[], lookback: number): number[] {
  const n = close.length;
  const start = Math.max(1, n - lookback);
  const out: number[] = [];
  for (let i = start; i < n; i++) {
    const a = close[i - 1], b = close[i];
    if (a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b)) out.push(Math.log(b / a));
  }
  return out;
}

/** EWMA variance per RiskMetrics (λ=0.94 default). Returns daily variance. */
function ewmaVariance(rets: number[], lambda = 0.94): number {
  if (rets.length === 0) return 0;
  // Seed with sample variance of first ~30 obs (or whole series if shorter).
  const seedSlice = rets.slice(0, Math.min(30, rets.length));
  const m0 = mean(seedSlice);
  let v = seedSlice.reduce((s, x) => s + (x - m0) ** 2, 0) / Math.max(1, seedSlice.length - 1);
  for (let i = Math.min(30, rets.length); i < rets.length; i++) {
    v = lambda * v + (1 - lambda) * rets[i] * rets[i];
  }
  return v;
}

/**
 * Compute multi-horizon forecasts from a closing-price array.
 * Default: 252 trading days lookback (≈1y) is used internally; we don't truncate
 * the caller's input — pass the full series you have.
 */
export function computeReturnForecasts(close: number[]): ForecastBundle | null {
  if (!Array.isArray(close) || close.length < 30) return null;

  // ── Drift: blend 60d & 252d windows, then shrink toward 0 ───────────────
  const shortRets = logReturns(close, 60);
  const longRets = logReturns(close, 252);
  if (longRets.length < 30) return null;

  const muShort = shortRets.length >= 20 ? mean(shortRets) : mean(longRets);
  const muLong = mean(longRets);
  const muRaw = 0.4 * muShort + 0.6 * muLong; // tilt toward stable long-window estimate

  // Bayesian shrinkage toward 0: shrink = k / (k + n). With k=60, 252 obs → ~19% shrink.
  const shrink = 60 / (60 + longRets.length);
  const muDaily = muRaw * (1 - shrink);
  const driftAnnualRaw = muDaily * 252;
  const driftAnnual = Math.max(-0.6, Math.min(0.6, driftAnnualRaw));
  const muDailyClipped = driftAnnual / 252;

  // ── Volatility: EWMA(λ=0.94) on the longer (~252d) return stream ────────
  const variance = ewmaVariance(longRets, 0.94);
  const sd = Math.sqrt(variance);
  if (!Number.isFinite(sd) || sd <= 0) return null;
  const annVol = sd * Math.sqrt(252);

  const out: any = {
    asOfPrice: close[close.length - 1],
    driftAnnualPct: +(driftAnnual * 100).toFixed(2),
    driftMethod: "blended-shrunk",
    volMethod: "ewma-0.94",
    sampleSize: longRets.length,
  };

  for (const [h, days] of Object.entries(HORIZON_DAYS)) {
    const muH = muDailyClipped * days;
    const varH = variance * days;
    const sigmaH = Math.sqrt(varH);
    // Lognormal: E[P_T/P_0] = exp(μh + 0.5σ²h); median = exp(μh)
    const expectedPct = (Math.exp(muH + 0.5 * varH) - 1) * 100;
    const medianPct = (Math.exp(muH) - 1) * 100;
    const lowPct = (Math.exp(muH - sigmaH) - 1) * 100;
    const highPct = (Math.exp(muH + sigmaH) - 1) * 100;
    // P(return > 0) under GBM: Φ((μh + 0.5σ²h)/(σ√h))
    const probUp = normCdf((muH + 0.5 * varH) / sigmaH) * 100;

    out[h as Horizon] = {
      expectedPct: +expectedPct.toFixed(2),
      medianPct: +medianPct.toFixed(2),
      lowPct: +lowPct.toFixed(2),
      highPct: +highPct.toFixed(2),
      probUpPct: +probUp.toFixed(1),
      annualizedVolPct: +(annVol * 100).toFixed(2),
    };
  }

  return out as ForecastBundle;
}
