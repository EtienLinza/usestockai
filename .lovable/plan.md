

# Add Missing Institutional Features to Backtester

## What's Being Added

### Backend — New Metrics in `computeMetrics` (supabase/functions/backtest/index.ts)

Add these computed fields to the `BacktestReport` interface and `computeMetrics`:

1. **Drawdown Duration** — `maxDrawdownDuration`, `avgDrawdownDuration`, `recoveryTime` (bars). Walk the equity curve tracking when drawdowns start/end/recover.
2. **Time in Drawdown** — `timeInDrawdownPct` = percentage of equity curve points that are below their prior peak.
3. **Skewness & Kurtosis** — Standard formulas on trade returns distribution.
4. **Kelly Criterion** — `kelly = winRate - ((1 - winRate) / winLossRatio)`.
5. **Expectancy** — `expectancy = (winRate * avgWin) - (lossRate * avgLoss)` per trade.
6. **Trade Clustering** — `maxConsecutiveWins`, `maxConsecutiveLosses`. Walk trades tracking streaks.
7. **Capacity Estimation** — `strategyCapacity = median(volumeAtEntry * entryPrice * 0.02)` across trades.
8. **Signal Decay** — Run accuracy check at day 1, 3, 5, 7 offsets from signal. Output `signalDecay: {day, accuracy}[]`.

### Backend — New Robustness Test

9. **Trade Dependency Test** — Remove 10% random trades, recompute total return. Repeat 5 times, average. If result collapses vs base → fragile. Add to `robustness` object as `tradeDependency: { baseReturn, reducedReturn, impact, passed }`.

### Backend — Benchmark Equity Curve

10. **Benchmark Equity Curve** — Compute SPY equity curve (normalized to same initial capital) and return as `benchmarkEquity: {date, value}[]` for overlay chart.

### Backend — Bull/Bear Regime via SPY 200MA

11. **Market Regime Classification** — Classify each trade date as bull (SPY > 200MA), bear (SPY < 200MA), or sideways (within 2%). Return `marketRegimePerformance: {regime, accuracy, avgReturn, trades}[]` separate from indicator-based regime.

### Frontend — New UI Sections (src/pages/Backtest.tsx)

12. **New metric cards**: Expectancy, Kelly, Skewness, Kurtosis, Max Consecutive Losses, Time in Drawdown, Capacity, Recovery Time.
13. **Equity vs Benchmark overlay** — Plot both `equityCurve` and `benchmarkEquity` on the same AreaChart with two Area components.
14. **Trade Dependency card** — Show base vs reduced return and pass/fail badge (same style as noise injection card).
15. **Signal Decay mini-chart** — Small LineChart showing accuracy % vs day offset.
16. **Market Regime table** — Same format as existing regime table but for bull/bear/sideways.
17. **Drawdown duration stat** in existing metrics cards row.

### Interface Changes

Add to `BacktestReport`:
```typescript
maxDrawdownDuration: number;
avgDrawdownDuration: number;
recoveryTime: number;
timeInDrawdownPct: number;
skewness: number;
kurtosis: number;
kelly: number;
expectancy: number;
maxConsecutiveWins: number;
maxConsecutiveLosses: number;
strategyCapacity: number;
signalDecay: { day: number; accuracy: number }[];
benchmarkEquity: { date: string; value: number }[];
marketRegimePerformance: { regime: string; accuracy: number; avgReturn: number; trades: number }[];
robustness.tradeDependency: { baseReturn: number; reducedReturn: number; impact: number; passed: boolean } | null;
```

### Scope
- Backend: ~200 lines of new metric logic + ~40 lines for trade dependency + ~30 lines for benchmark equity + ~40 lines for signal decay + ~30 lines for market regime = ~340 lines added
- Frontend: ~150 lines for new cards, charts, tables
- Both files modified, no new files

