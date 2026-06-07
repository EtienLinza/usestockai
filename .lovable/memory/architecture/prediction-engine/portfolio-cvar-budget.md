---
name: Portfolio CVaR Budget
description: 2% NAV expected-shortfall cap via historical-bootstrap simulator — closes the gap between per-trade R-risk (heat cap) and realized drawdown (CDaR breaker)
type: feature
---
**What:** Bound EXPECTED tail loss on the live book to ≤2% NAV at 95% confidence over a 5-day horizon.

**Module:** `_shared/portfolio-cvar.ts` exports `computePortfolioCvar`, `closeToReturns`, `DEFAULT_CVAR_CAP_PCT`.

**Math:** historical-bootstrap with 1,000 paths, mulberry32 deterministic RNG (seed `0xC0FFEE`), 5-day horizon. Per-position daily returns sampled with replacement; sum to portfolio path P&L; tail mean of worst 5% paths = ES.

**Wiring:** `autotrader-scan` pre-entry, after sector/beta/heat-cap gates. If `{book ∪ candidate} CVaR > 2.0%`, hard-block the entry. Treated like the 6% heat cap — non-negotiable regardless of `enforcement_mode='warn'`.

**Persistence:** Each scan that has open positions writes one row to `portfolio_cvar_snapshots(user_id, taken_at, cvar_pct, n_positions, nav)`. User-scoped RLS (`auth.uid() = user_id`).

**Cold-start safety:** Returns `null` when fewer than 20 return observations exist for any position; gate degrades to PASS.

**Why 2%:** Pairs with 6% heat cap and 8% CDaR_0.95 hard block. ES is tighter because it is expected loss, not absolute stop-loss sum.
