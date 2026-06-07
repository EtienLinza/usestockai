// ============================================================================
// PORTFOLIO CVaR (Expected Shortfall) — historical-bootstrap simulator.
//
// Given open positions (ticker, signed dollars, last 60 daily returns) and a
// candidate addition, draws B bootstrap paths over an H-day horizon and
// reports the 95% Expected Shortfall as a % of NAV.
//
// Pairs with the existing 6% portfolio heat cap (per-trade R-risk bound) and
// the CDaR_0.95 breaker (realized drawdown). CVaR closes the gap: bounded
// EXPECTED tail loss on the live book RIGHT NOW.
// ============================================================================

export interface CvarPosition {
  ticker: string;
  /** Signed dollars: +long, -short. */
  dollars: number;
  /** Most recent ~60 daily simple returns (decimal). */
  returns: number[];
}

export interface CvarResult {
  /** 95% Expected Shortfall as a percentage of NAV (positive number). */
  cvarPct: number;
  /** Number of bootstrap paths actually drawn. */
  paths: number;
  /** Worst single path P&L as % of NAV (negative number). */
  worstPathPct: number;
  /** Median path P&L as % of NAV. */
  medianPathPct: number;
}

const DEFAULT_PATHS = 1000;
const DEFAULT_HORIZON_DAYS = 5;
const ALPHA = 0.95;

function rng(seed: number) {
  // Mulberry32 — deterministic, fast, no deps.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute portfolio 95% CVaR over an H-day horizon via historical bootstrap.
 * Returns null when input is insufficient (no positions or any position has
 * <20 return observations).
 */
export function computePortfolioCvar(
  positions: CvarPosition[],
  nav: number,
  opts: { paths?: number; horizonDays?: number; seed?: number } = {},
): CvarResult | null {
  if (!Array.isArray(positions) || positions.length === 0) return null;
  if (!Number.isFinite(nav) || nav <= 0) return null;
  for (const p of positions) {
    if (!Array.isArray(p.returns) || p.returns.length < 20) return null;
  }
  const B = Math.max(100, Math.min(5000, opts.paths ?? DEFAULT_PATHS));
  const H = Math.max(1, Math.min(20, opts.horizonDays ?? DEFAULT_HORIZON_DAYS));
  const rand = rng(opts.seed ?? 0xC0FFEE);

  const pathPnls: number[] = new Array(B);
  for (let b = 0; b < B; b++) {
    let pnlDollars = 0;
    for (const pos of positions) {
      const rets = pos.returns;
      const n = rets.length;
      let cum = 0;
      for (let h = 0; h < H; h++) {
        const r = rets[Math.floor(rand() * n)];
        if (Number.isFinite(r)) cum += r; // log-additive approximation, fine for 5d
      }
      // Long: gain when cum>0. Short: gain when cum<0 → invert via sign of dollars.
      pnlDollars += pos.dollars * cum;
    }
    pathPnls[b] = (pnlDollars / nav) * 100; // % NAV
  }
  pathPnls.sort((a, b) => a - b);
  const tailEnd = Math.max(1, Math.floor(B * (1 - ALPHA)));
  let tailSum = 0;
  for (let i = 0; i < tailEnd; i++) tailSum += pathPnls[i];
  const esPct = -(tailSum / tailEnd); // positive number = expected loss in worst 5%
  return {
    cvarPct: Math.round(esPct * 100) / 100,
    paths: B,
    worstPathPct: Math.round(pathPnls[0] * 100) / 100,
    medianPathPct: Math.round(pathPnls[Math.floor(B / 2)] * 100) / 100,
  };
}

/** Convert a close-price series to simple daily returns. */
export function closeToReturns(close: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const a = close[i - 1];
    const b = close[i];
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) {
      out.push((b - a) / a);
    }
  }
  return out;
}

/**
 * Default CVaR cap as % of NAV. Pairs with the 6% portfolio heat cap and the
 * 8% CDaR_0.95 hard block. CVaR is tighter because it measures EXPECTED tail
 * loss, not absolute stop-loss sum.
 */
export const DEFAULT_CVAR_CAP_PCT = 2.0;
