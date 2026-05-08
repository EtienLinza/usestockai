// Multi-horizon expected-return forecasts using drift + volatility (GBM).
// Drift μ and vol σ estimated from daily log returns, then scaled by horizon.
// Returns expected % move and a 1σ band for each horizon.

export type Horizon = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export const HORIZON_DAYS: Record<Horizon, number> = {
  daily: 1,
  weekly: 5,
  monthly: 21,
  quarterly: 63,
  yearly: 252,
};

export interface ForecastEntry {
  expectedPct: number;   // expected % return over horizon
  lowPct: number;        // 1σ lower band
  highPct: number;       // 1σ upper band
  annualizedVolPct: number;
}

export type ForecastBundle = Record<Horizon, ForecastEntry> & {
  asOfPrice: number;
  driftAnnualPct: number;
  sampleSize: number;
};

/**
 * Compute multi-horizon forecasts from a closing-price array.
 * Uses last `lookback` daily log returns (default 120) for μ and σ.
 * Drift is winsorized to ±60% annualized to avoid runaway extrapolation.
 */
export function computeReturnForecasts(
  close: number[],
  lookback = 120,
): ForecastBundle | null {
  if (!Array.isArray(close) || close.length < 30) return null;
  const n = close.length;
  const start = Math.max(1, n - lookback);
  const rets: number[] = [];
  for (let i = start; i < n; i++) {
    const a = close[i - 1], b = close[i];
    if (a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b)) {
      rets.push(Math.log(b / a));
    }
  }
  if (rets.length < 20) return null;

  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const sd = Math.sqrt(variance);

  // Winsorize annualized drift to ±60%
  const driftAnnual = Math.max(-0.6, Math.min(0.6, mean * 252));
  const muDaily = driftAnnual / 252;

  const out: any = {
    asOfPrice: close[n - 1],
    driftAnnualPct: +(driftAnnual * 100).toFixed(2),
    sampleSize: rets.length,
  };

  for (const [h, days] of Object.entries(HORIZON_DAYS)) {
    // GBM expected price ratio: exp(μ*h + 0.5*σ²*h)
    const expLogRet = muDaily * days;
    const expPriceRatio = Math.exp(expLogRet + 0.5 * variance * days);
    const expectedPct = (expPriceRatio - 1) * 100;
    const sigmaH = sd * Math.sqrt(days);
    const lowRatio = Math.exp(expLogRet - sigmaH);
    const highRatio = Math.exp(expLogRet + sigmaH);
    out[h as Horizon] = {
      expectedPct: +expectedPct.toFixed(2),
      lowPct: +((lowRatio - 1) * 100).toFixed(2),
      highPct: +((highRatio - 1) * 100).toFixed(2),
      annualizedVolPct: +(sd * Math.sqrt(252) * 100).toFixed(2),
    };
  }

  return out as ForecastBundle;
}
