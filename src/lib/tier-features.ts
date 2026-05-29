export type Tier = "free" | "pro" | "elite";

export const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, elite: 2 };

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  elite: "Elite",
};

// Annual = monthly × 10 (i.e. 2 months free), divided by 12 for the displayed /mo rate.
export const TIER_PRICES = {
  free: { monthly: 0, annual: 0, monthlyPriceId: null, annualPriceId: null },
  pro: { monthly: 29, annual: 24, monthlyPriceId: "pro_monthly", annualPriceId: "pro_yearly" },
  elite: { monthly: 59, annual: 49, monthlyPriceId: "elite_monthly", annualPriceId: "elite_yearly" },
} as const;

export type FeatureKey =
  | "signals"
  | "watchlist"
  | "price_alerts"
  | "portfolio_analytics"
  | "backtest_basic"
  | "backtest_multi_ticker"
  | "backtest_monte_carlo"
  | "backtest_walk_forward"
  | "backtest_robustness"
  | "calibration_stats"
  | "autotrader"
  | "weekly_digest"
  | "email_alerts";

export const FEATURE_REQUIRES: Record<FeatureKey, Tier> = {
  signals: "free",
  watchlist: "free",
  backtest_basic: "free",
  price_alerts: "pro",
  portfolio_analytics: "pro",
  backtest_multi_ticker: "pro",
  backtest_monte_carlo: "pro",
  backtest_walk_forward: "pro",
  email_alerts: "pro",
  weekly_digest: "pro",
  backtest_robustness: "elite",
  calibration_stats: "elite",
  autotrader: "elite",
};

export const TIER_LIMITS = {
  free: { backtests_per_month: 3, max_tickers_per_backtest: 1, max_backtest_years: 1 },
  pro: { backtests_per_month: 20, max_tickers_per_backtest: 3, max_backtest_years: 10 },
  elite: { backtests_per_month: Infinity, max_tickers_per_backtest: 10, max_backtest_years: 25 },
} as const;

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  signals: "Live AI signal feed",
  watchlist: "Watchlist & notes",
  backtest_basic: "Strategy backtester (single ticker, 1y)",
  price_alerts: "Price alerts",
  portfolio_analytics: "Portfolio & P&L analytics",
  backtest_multi_ticker: "Multi-ticker backtests (up to 3)",
  backtest_monte_carlo: "Monte Carlo simulation",
  backtest_walk_forward: "Walk-forward analysis",
  email_alerts: "Email alerts",
  weekly_digest: "Weekly performance digest",
  backtest_robustness: "Robustness & stress tests",
  calibration_stats: "Calibration analytics",
  autotrader: "AutoTrader automated execution",
};

export function tierMeets(userTier: Tier, required: Tier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[required];
}

export function canUseFeature(userTier: Tier, feature: FeatureKey): boolean {
  return tierMeets(userTier, FEATURE_REQUIRES[feature]);
}

export const TIER_FEATURE_LIST: Record<Tier, string[]> = {
  free: [
    "Live AI signal feed (read-only)",
    "Watchlist with notes",
    "Single-ticker backtests (3/month, 1y window)",
    "Community paper-trading",
  ],
  pro: [
    "Everything in Free",
    "Portfolio & P&L analytics",
    "Price alerts + email notifications",
    "20 backtests/month, up to 3 tickers",
    "Monte Carlo & walk-forward analysis",
    "Weekly performance digest",
  ],
  elite: [
    "Everything in Pro",
    "AutoTrader automated execution",
    "Unlimited backtests",
    "Robustness & stress testing",
    "Calibration analytics",
    "Priority support",
  ],
};
