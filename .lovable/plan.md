# What to Do Next

## Current State

- **Dashboard** (1122 lines) — Analyze, Signals, Portfolio, Market tabs. Core trading hub.
- **Watchlist** — Add tickers, set price alerts.
- **Backtest** — Historical strategy testing.
- **Landing** — Simple hero page.
- Market scanner now covers 150-200+ tickers dynamically.

## High-Impact Improvements (pick any)

### 1. Refactor Dashboard into smaller components

Dashboard.tsx is 1122 lines and growing. It should be split into focused components:

- `AnalyzeTab.tsx` — ticker input, prediction display, chart
- `SignalsTab.tsx` — scanner controls, signal table, buy dialog
- `PortfolioTab.tsx` — positions, P&L, equity curve, sell dialog, trade log

No behavior changes — just maintainability. Makes future features easier to add.

### 2. Add trading style filter to Signals tab

This was planned during the Guide merge but not yet implemented. Add a dropdown filter (Scalping / Day Trading / Swing / Position) that filters scanner signals by volatility, volume, and holding-period characteristics. Gives users the same value the old Guide "Opportunities" tab had, integrated right where signals live.

### 3. Improve the Landing page

The current landing is minimal — a logo, one headline, one button. Could add:

- 3 feature cards (Scanner, Portfolio Tracking, Backtesting)
- A live signal count or market status badge
- Social proof or a screenshot preview

### 4. Add a notification center

Price alerts and sell alerts currently show as toasts. A persistent notification bell in the Navbar with a dropdown showing recent alerts (triggered price alerts, sell signals, scan completions) would make them discoverable after the fact.

### 5. Dashboard performance metrics card

Add a summary card to the Portfolio tab: total realized P&L, win rate, average hold time, best/worst trade. All computable from existing `virtual_positions` data — no new backend needed.

## Recommendation

**Implement everything**