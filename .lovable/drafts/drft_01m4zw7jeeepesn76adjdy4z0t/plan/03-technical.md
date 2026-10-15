## Technical details

**Page**
- New `src/pages/Portfolio.tsx`, lazy route `/portfolio` in `App.tsx`, entries in `Navbar.tsx` and `MobileBottomNav.tsx`.
- Reads (owner RLS): open/closed `virtual_positions` (grouped by `campaign_id`), `virtual_portfolio_log`, `portfolio_cvar_snapshots`, `autotrader_state`, `portfolio_caps`, `adaptive_risk_params`, `bars_freshness` RPC for closes.
- New edge function `portfolio-analytics` (JWT-validated, user-scoped): sectors via `_shared/finnhub.ts getSector`, 60d return correlation matrix, beta vs SPY, effective number of bets (1/Σw² and correlation-adjusted), per-position risk contribution, plus a deterministic recommendation list (no AI calls). Uses `MetricCard`, Recharts, card-vs-table on mobile.

**Engine (autotrader-scan + shared modules)**
- `_shared/adaptive-risk.ts`: lower `RISK_DEFAULTS` entry fractions (~0.035 / 0.05), walls adjusted so they can't exceed current maxima; add `target_positions` key (default 22, wall 10–30) and `diversity_weight`. All numbers live only here.
- `_shared/adaptive-context.ts`: aggressive baseline `maxPos` reads `target_positions`.
- Candidate ranking: marginal-diversification score = penalty for avg |ρ| to book and sector weight; multiplies size (floor via `haircut_floor`), never blocks below existing hard gates.
- Inverse-volatility risk-parity scaling of the entry fraction, clamped by walls.
- Tuner (`tune-risk-params`) learns the two new keys with the same slow nightly step.

**Order**: shared params → engine wiring + Deno checks → analytics function → page → verify signed-in in preview, then watch the next market-hours scan.

No new tables needed; edge function deploy and engine changes go live on the shared backend when built.
