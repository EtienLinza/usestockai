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
//
// PERF (engine-speed bundle): for autotrader scans that test the same open
// book against many candidates, use the base/marginal pair below. The base
// sim is computed once per scan; each candidate is then O(B·H) instead of
// O(B·N·H). On a typical 10-position book × 50 candidates that's ~10× faster.
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

function summarize(pathPnls: Float64Array): CvarResult {
  const B = pathPnls.length;
  // Sort ascending (in-place on a copy to keep ordering stable for callers).
  const sorted = pathPnls.slice().sort();
  const tailEnd = Math.max(1, Math.floor(B * (1 - ALPHA)));
  let tailSum = 0;
  for (let i = 0; i < tailEnd; i++) tailSum += sorted[i];
  const esPct = -(tailSum / tailEnd);
  return {
    cvarPct: Math.round(esPct * 100) / 100,
    paths: B,
    worstPathPct: Math.round(sorted[0] * 100) / 100,
    medianPathPct: Math.round(sorted[Math.floor(B / 2)] * 100) / 100,
  };
}

/**
 * One-shot CVaR — kept for callers that score a single book in isolation
 * (backtests, ad-hoc tools). For per-scan candidate loops use the base/marginal
 * pair below.
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

  const pathPnls = new Float64Array(B);
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
      pnlDollars += pos.dollars * cum;
    }
    pathPnls[b] = (pnlDollars / nav) * 100; // % NAV
  }
  return summarize(pathPnls);
}

// ────────────────────────────────────────────────────────────────────────────
// BASE + MARGINAL form — engine-speed bundle.
// ────────────────────────────────────────────────────────────────────────────

export interface CvarBase {
  /** Per-path P&L (in dollars) of the existing open book. */
  basePnlDollars: Float64Array;
  /** Random draws shared across base + every marginal candidate. */
  uniformDraws: Float64Array; // length B*H, values in [0,1)
  B: number;
  H: number;
}

/**
 * Build a reusable base sim from the open book. The same uniform draws are
 * later applied to each candidate so comparisons across candidates are
 * coherent (same shock path, different exposure).
 *
 * Returns `null` when the book is empty or any position has <20 return
 * observations (cold-start safe).
 */
export function computePortfolioCvarBase(
  positions: CvarPosition[],
  opts: { paths?: number; horizonDays?: number; seed?: number } = {},
): CvarBase | null {
  if (!Array.isArray(positions)) return null;
  for (const p of positions) {
    if (!Array.isArray(p.returns) || p.returns.length < 20) return null;
  }
  const B = Math.max(100, Math.min(5000, opts.paths ?? DEFAULT_PATHS));
  const H = Math.max(1, Math.min(20, opts.horizonDays ?? DEFAULT_HORIZON_DAYS));
  const rand = rng(opts.seed ?? 0xC0FFEE);

  // Pre-draw uniforms. Each path consumes H uniforms which every position
  // (and every later candidate) maps into its own returns[] via floor(u*n).
  const uniformDraws = new Float64Array(B * H);
  for (let i = 0; i < B * H; i++) uniformDraws[i] = rand();

  const basePnlDollars = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let pnl = 0;
    for (const pos of positions) {
      const rets = pos.returns;
      const n = rets.length;
      let cum = 0;
      for (let h = 0; h < H; h++) {
        const r = rets[Math.floor(uniformDraws[b * H + h] * n)];
        if (Number.isFinite(r)) cum += r;
      }
      pnl += pos.dollars * cum;
    }
    basePnlDollars[b] = pnl;
  }
  return { basePnlDollars, uniformDraws, B, H };
}

/**
 * Score a single candidate against the cached base book. Cost: O(B·H).
 *
 * Returns `null` when nav is invalid or the candidate has <20 returns
 * (matches the conservative behavior of the one-shot form).
 */
export function computePortfolioCvarMarginal(
  base: CvarBase,
  candidate: CvarPosition,
  nav: number,
): CvarResult | null {
  if (!Number.isFinite(nav) || nav <= 0) return null;
  if (!Array.isArray(candidate.returns) || candidate.returns.length < 20) return null;
  const { basePnlDollars, uniformDraws, B, H } = base;
  const rets = candidate.returns;
  const n = rets.length;
  const pathPnls = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let cum = 0;
    const off = b * H;
    for (let h = 0; h < H; h++) {
      const r = rets[Math.floor(uniformDraws[off + h] * n)];
      if (Number.isFinite(r)) cum += r;
    }
    pathPnls[b] = ((basePnlDollars[b] + candidate.dollars * cum) / nav) * 100;
  }
  return summarize(pathPnls);
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
