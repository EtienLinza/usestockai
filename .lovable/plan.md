

# Elevate Dashboard to Backtester-Grade Quality

## What Changes

### 1. Remove History Tab
Delete the History tab entirely. Fold closed positions into the Portfolio tab as a collapsible trade log (same pattern as the backtester's expandable trade log).

### 2. Reuse MetricCard Component
Extract `MetricCard` from `Backtest.tsx` into a shared component (`src/components/MetricCard.tsx`) and use it across both pages. Replace the current basic stat cards in the Dashboard header with these.

### 3. Upgrade Stats Row
Replace the 5 simple stat cards with backtester-style `MetricCard`s showing:
- Buy Signals (count)
- Open Positions (count)
- Portfolio Value ($)
- Unrealized P&L ($ + %)
- Realized P&L ($ + %)
- Win Rate (% from closed trades)

### 4. Enhance Portfolio Tab
Transform from a basic table into a rich analytics view:
- **Performance Metrics Row**: Win Rate, Avg Win, Avg Loss, Profit Factor — computed from `closedPositions`, displayed as MetricCards (same grid style as backtester)
- **Equity Curve**: Keep existing but add drawdown shading and proper tooltip styling matching backtester
- **Open Positions Table**: Keep as-is (already good)
- **Closed Trades**: Collapsible trade log below open positions (same `Show/Hide Trade Log` pattern as backtester), showing entry, exit, P&L, exit reason, duration

### 5. Enhance Signal Cards
- Add a horizontal conviction bar (colored fill based on confidence %)
- Show allocation % as a subtle progress indicator
- Better mobile layout with signal metadata visible

### 6. Consistent Styling
- Use `glass-card` class consistently (matching backtester)
- Same chart tooltip styling (card bg, border, rounded-lg)
- Same table styling (border-border/10 rows, muted-foreground headers)

## Files Changed

1. **Create `src/components/MetricCard.tsx`** — extracted shared component
2. **Rewrite `src/pages/Dashboard.tsx`** — remove History tab, upgrade stats, enhance Portfolio/Signals tabs, use MetricCard
3. **Update `src/pages/Backtest.tsx`** — import MetricCard from shared component instead of inline

