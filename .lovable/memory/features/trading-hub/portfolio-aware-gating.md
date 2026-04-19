---
name: portfolio-aware-gating
description: Phase C portfolio gate enforcing per-user sector concentration, beta, and correlation caps before opening positions
type: feature
---
Phase C of the adaptive trading architecture: portfolio-level risk gating.

## Components
- **Table `portfolio_caps`** (per-user, RLS-protected): `sector_max_pct` (default 35), `portfolio_beta_max` (default 1.5), `max_correlated_positions` (default 3), `enforcement_mode` ('warn' | 'block'), `enabled`. Auto-seeded for new users via trigger on `profiles` insert.
- **Edge function `portfolio-gate`** (JWT-required): receives `{ ticker, shares, entry_price }`, loads caps + open `virtual_positions`, fetches 3-month closes from Yahoo for all holdings + SPY in parallel, computes weighted portfolio beta (60d regression), sector concentration % (SPDR sector ETF mapping), and correlated position count. Returns `{ decision: 'allow' | 'warn' | 'block', violations[], metrics }`.
- **`/settings` page** (`src/pages/Settings.tsx`): sliders for all three caps + enforcement mode toggle. Linked from Navbar as "Risk Caps" with Shield icon.
- **Enforcement** in `Dashboard.handleBuy`: invokes gate before inserting into `virtual_positions`. Block decision halts insert with destructive toast. Warn decision shows warning toast but proceeds. Gate failure (network/timeout) is logged and ignored — never blocks on infra error.

## Sector mapping
Mirrors `market-scanner`'s `TICKER_TO_SECTOR_ETF`. Tickers not in the map fall into `OTHER` bucket (still counted toward concentration).

## Why warn-default
Per-user-configurable caps: most users want a heads-up, not a hard wall. Switching to `block` is one click in `/settings`.
