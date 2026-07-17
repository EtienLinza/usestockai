// ============================================================================
// USER MODELS — Milestone 3 of the self-improving loop.
//
// Per-user Bayesian shrinkage helpers, online Beta-Binomial updates, and
// archetype assignment for cold-start users. Pure JS, no deps.
//
// Consumed by:
//   - `train-user-models` (nightly per-user fit + archetype clustering)
//   - `autotrader-scan`   (online micro-update after every closed trade)
//   - future scanners     (apply per-user tilts + filter_threshold + sizing)
// ============================================================================

export interface BetaPrior { alpha: number; beta: number; }
export type StrategyPriors = Record<string, BetaPrior>;

export interface ClosedTrade {
  strategy: string | null;
  regime: string | null;
  profile: string | null;
  conviction: number | null;
  pnl_pct: number;   // realized P&L as a % of entry
  closed_at: string; // ISO
}

export interface ArchetypeRow {
  archetype_key: string;
  centroid: Record<string, number>;
  default_strategy_bias: Record<string, number>;
  default_regime_bias: Record<string, number>;
  default_sizing_scalar: number;
  default_filter_threshold: number;
}

export interface UserFitResult {
  archetype_key: string | null;
  sizing_scalar: number;
  filter_threshold: number;
  strategy_bias: Record<string, number>;
  regime_bias: Record<string, number>;
  beta_binomial_priors: StrategyPriors;
  shrinkage_k: number;
  sample_size: number;
  consistency_score: number;
}

// ── Beta-Binomial online update ─────────────────────────────────────────────
/** Update a Beta prior with a single win/loss outcome. */
export function updateBeta(prior: BetaPrior, win: boolean): BetaPrior {
  return {
    alpha: prior.alpha + (win ? 1 : 0),
    beta: prior.beta + (win ? 0 : 1),
  };
}

/** Posterior mean of a Beta(alpha, beta). */
export function betaMean(p: BetaPrior): number {
  const t = p.alpha + p.beta;
  return t > 0 ? p.alpha / t : 0.5;
}

/** 95% credible-interval half-width for a Beta posterior (normal approx). */
export function betaCiHalfWidth(p: BetaPrior): number {
  const n = p.alpha + p.beta;
  if (n < 4) return 0.5;
  const mu = p.alpha / n;
  return 1.96 * Math.sqrt((mu * (1 - mu)) / n);
}

// ── Bayesian shrinkage ──────────────────────────────────────────────────────
/**
 * Shrink a user's observed mean toward a global (or archetype) mean.
 *   posterior = (n * userMean + k * globalMean) / (n + k)
 */
export function shrink(userMean: number, n: number, globalMean: number, k: number): number {
  if (n <= 0) return globalMean;
  return (n * userMean + k * globalMean) / (n + k);
}

/**
 * Dynamic shrinkage constant: noisy users shrink harder, consistent users
 * unlock personalisation faster. `base` is the neutral setting (default 30).
 */
export function dynamicK(base: number, meanEdge: number, stdEdge: number): number {
  const denom = Math.max(1e-4, Math.abs(meanEdge));
  const noise = stdEdge / denom;
  return Math.max(8, Math.min(120, base * (1 + noise)));
}

// ── Feature vector for archetype assignment ─────────────────────────────────
export interface UserContextFeatures {
  starting_nav: number;
  risk_profile_ord: number;  // conservative=0, balanced=1, aggressive=2
  max_positions: number;
  max_single_name_pct: number;
  min_conviction: number;
  avg_hold_days: number;
  trade_frequency: number;   // trades per week
  win_rate: number;
  avg_return_pct: number;
}

const FEATURE_ORDER: (keyof UserContextFeatures)[] = [
  "starting_nav", "risk_profile_ord", "max_positions", "max_single_name_pct",
  "min_conviction", "avg_hold_days", "trade_frequency", "win_rate", "avg_return_pct",
];

/** Standardize a feature vector against a stored centroid (assumed already normalized). */
export function featureVector(f: UserContextFeatures): number[] {
  return FEATURE_ORDER.map((k) => Number(f[k]) || 0);
}

/** Nearest-archetype by squared distance in the normalized feature space. */
export function assignArchetype(
  f: UserContextFeatures,
  archetypes: ArchetypeRow[],
): ArchetypeRow | null {
  if (!archetypes.length) return null;
  const v = normalizeFeatures(f);
  let best: ArchetypeRow | null = null;
  let bestDist = Infinity;
  for (const a of archetypes) {
    // Centroids are stored as raw UserContextFeatures; normalize to the
    // same [0,1]-ish space before computing distance so the metric is
    // consistent with the input vector.
    const c = a.centroid as Record<string, unknown>;
    const asCtx: UserContextFeatures = {
      starting_nav: Number(c.starting_nav) || 0,
      risk_profile_ord: Number(c.risk_profile_ord) || 0,
      max_positions: Number(c.max_positions) || 0,
      max_single_name_pct: Number(c.max_single_name_pct) || 0,
      min_conviction: Number(c.min_conviction) || 0,
      avg_hold_days: Number(c.avg_hold_days) || 0,
      trade_frequency: Number(c.trade_frequency) || 0,
      win_rate: Number(c.win_rate) || 0,
      avg_return_pct: Number(c.avg_return_pct) || 0,
    };
    const cn = normalizeFeatures(asCtx);
    let d = 0;
    for (let i = 0; i < v.length; i++) {
      const diff = v[i] - cn[i];
      d += diff * diff;
    }
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return best;
}

/** Log-scale sizes and clip probabilities so distance metric is well-behaved. */
export function normalizeFeatures(f: UserContextFeatures): number[] {
  return [
    Math.log10(Math.max(100, f.starting_nav)) / 6,     // 100 → 0.33, 1M → 1.0
    f.risk_profile_ord / 2,                             // 0..1
    Math.min(1, f.max_positions / 20),
    Math.min(1, f.max_single_name_pct / 50),
    Math.max(0, Math.min(1, (f.min_conviction - 50) / 50)),
    Math.min(1, f.avg_hold_days / 30),
    Math.min(1, f.trade_frequency / 10),
    Math.max(0, Math.min(1, f.win_rate)),
    Math.max(-1, Math.min(1, f.avg_return_pct / 20)),
  ];
}

// ── Per-user fit from closed trades ─────────────────────────────────────────
/**
 * Fit a user's personalisation layer from their closed trades, shrinking
 * every per-strategy win-rate toward the global mean using dynamic k.
 */
export function fitUserModel(
  trades: ClosedTrade[],
  ctx: UserContextFeatures,
  globals: {
    globalWinRate: number;
    globalStrategyWR: Record<string, number>;
    globalRegimeWR: Record<string, number>;
  },
  archetype: ArchetypeRow | null,
): UserFitResult {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl_pct > 0).length;
  const wr = n > 0 ? wins / n : globals.globalWinRate;
  const meanReturn = n > 0 ? trades.reduce((s, t) => s + t.pnl_pct, 0) / n : 0;
  const varReturn = n > 1
    ? trades.reduce((s, t) => s + (t.pnl_pct - meanReturn) ** 2, 0) / (n - 1)
    : 0;
  const stdReturn = Math.sqrt(varReturn);
  const k = dynamicK(30, meanReturn, stdReturn);

  // Per-strategy Beta priors + shrunk WR bias
  const byStrategy: Record<string, ClosedTrade[]> = {};
  for (const t of trades) {
    const s = t.strategy || "none";
    (byStrategy[s] ??= []).push(t);
  }
  const strategyBias: Record<string, number> = {};
  const priors: StrategyPriors = {};
  for (const [s, rows] of Object.entries(byStrategy)) {
    const w = rows.filter((r) => r.pnl_pct > 0).length;
    const globalWR = globals.globalStrategyWR[s] ?? globals.globalWinRate;
    const shrunk = shrink(w / rows.length, rows.length, globalWR, k);
    // Bias in [-0.20, +0.20]: >0 → prefer strategy, <0 → discount
    strategyBias[s] = Math.max(-0.20, Math.min(0.20, shrunk - globalWR));
    priors[s] = { alpha: 1 + w, beta: 1 + (rows.length - w) };
  }

  // Per-regime shrunk bias
  const byRegime: Record<string, ClosedTrade[]> = {};
  for (const t of trades) {
    if (!t.regime) continue;
    (byRegime[t.regime] ??= []).push(t);
  }
  const regimeBias: Record<string, number> = {};
  for (const [r, rows] of Object.entries(byRegime)) {
    const w = rows.filter((x) => x.pnl_pct > 0).length;
    const globalWR = globals.globalRegimeWR[r] ?? globals.globalWinRate;
    const shrunk = shrink(w / rows.length, rows.length, globalWR, k);
    regimeBias[r] = Math.max(-0.15, Math.min(0.15, shrunk - globalWR));
  }

  // Sizing scalar: shrink toward 1.0, floor at 0.5x and cap at 1.5x
  const edge = meanReturn / Math.max(0.5, stdReturn); // sharpe-ish
  const rawScalar = 1 + 0.15 * Math.tanh(edge);       // ±15%
  const shrunkScalar = shrink(
    rawScalar, n,
    archetype?.default_sizing_scalar ?? 1.0,
    Math.max(20, k),
  );
  const sizing_scalar = Math.max(0.5, Math.min(1.5, shrunkScalar));

  // Filter threshold: users who win low-conviction trades get a lower floor,
  // users who consistently lose above 80 get pushed higher. Shrunk toward
  // archetype default so cold-start users don't swing wildly.
  const winConvs = trades.filter((t) => t.pnl_pct > 0 && t.conviction != null).map((t) => t.conviction!);
  const winMedianConv = winConvs.length ? median(winConvs) : 68;
  const shrunkFloor = shrink(
    winMedianConv - 4, // 4-pt buffer below median winning conviction
    winConvs.length,
    archetype?.default_filter_threshold ?? 68,
    Math.max(20, k),
  );
  const filter_threshold = Math.max(55, Math.min(85, shrunkFloor));

  // Consistency: 1 - normalized std of trade returns (0 = chaotic, 1 = tight)
  const consistency_score = n > 3
    ? Math.max(0, Math.min(1, 1 - stdReturn / (Math.abs(meanReturn) + 3)))
    : 0;

  return {
    archetype_key: archetype?.archetype_key ?? null,
    sizing_scalar,
    filter_threshold,
    strategy_bias: strategyBias,
    regime_bias: regimeBias,
    beta_binomial_priors: priors,
    shrinkage_k: k,
    sample_size: n,
    consistency_score,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Default archetype seeds ─────────────────────────────────────────────────
export const DEFAULT_ARCHETYPES: Array<Omit<ArchetypeRow, "centroid"> & {
  centroid: UserContextFeatures;
  display_name: string;
  description: string;
}> = [
  {
    archetype_key: "conservative_income",
    display_name: "Conservative Income",
    description: "Small book, low position count, only high-conviction swings.",
    default_strategy_bias: { mean_reversion: 0.05, trend: 0.02, breakout: -0.05 },
    default_regime_bias: { bull_quiet: 0.05, bear_volatile: -0.10 },
    default_sizing_scalar: 0.85,
    default_filter_threshold: 74,
    centroid: {
      starting_nav: 10000, risk_profile_ord: 0, max_positions: 4,
      max_single_name_pct: 15, min_conviction: 74, avg_hold_days: 12,
      trade_frequency: 1.5, win_rate: 0.58, avg_return_pct: 2.5,
    },
  },
  {
    archetype_key: "balanced_growth",
    display_name: "Balanced Growth",
    description: "Middle-of-the-road swing trader, mixed strategies.",
    default_strategy_bias: { trend: 0.03, mean_reversion: 0.02 },
    default_regime_bias: { bull_volatile: 0.03 },
    default_sizing_scalar: 1.0,
    default_filter_threshold: 68,
    centroid: {
      starting_nav: 50000, risk_profile_ord: 1, max_positions: 8,
      max_single_name_pct: 20, min_conviction: 68, avg_hold_days: 7,
      trade_frequency: 3.0, win_rate: 0.55, avg_return_pct: 3.5,
    },
  },
  {
    archetype_key: "aggressive_momentum",
    display_name: "Aggressive Momentum",
    description: "Larger book, high position count, breakout-heavy.",
    default_strategy_bias: { breakout: 0.06, trend: 0.04, mean_reversion: -0.03 },
    default_regime_bias: { bull_volatile: 0.06, bear_quiet: -0.05 },
    default_sizing_scalar: 1.15,
    default_filter_threshold: 64,
    centroid: {
      starting_nav: 250000, risk_profile_ord: 2, max_positions: 14,
      max_single_name_pct: 30, min_conviction: 64, avg_hold_days: 4,
      trade_frequency: 6.0, win_rate: 0.52, avg_return_pct: 5.0,
    },
  },
  {
    archetype_key: "scalper_active",
    display_name: "Active Scalper",
    description: "Very high turnover, short holds, tight thresholds.",
    default_strategy_bias: { mean_reversion: 0.05, breakout: 0.03 },
    default_regime_bias: { bull_volatile: 0.04 },
    default_sizing_scalar: 0.95,
    default_filter_threshold: 66,
    centroid: {
      starting_nav: 100000, risk_profile_ord: 2, max_positions: 12,
      max_single_name_pct: 20, min_conviction: 66, avg_hold_days: 1.5,
      trade_frequency: 15, win_rate: 0.54, avg_return_pct: 1.5,
    },
  },
];
