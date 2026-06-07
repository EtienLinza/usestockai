---
name: Uniqueness-Deflated Sharpe (idea #2)
description: Backtester reports a López-de-Prado §4.5 uniqueness-deflated Sharpe alongside raw Sharpe, fixing overlap-driven inflation
type: feature
---

The `backtest` edge function now computes **uniqueness-weighted ("deflated") Sharpe** in addition to the raw daily-equity-curve Sharpe. Surfaced in `BacktestReport` as `deflatedSharpe` and `avgSampleUniqueness`, and shown on the Backtest page as a `MetricCard` labelled `Deflated Sharpe (u=NN%)`.

Algorithm:
1. Build a per-bar concurrency array over the sorted equity curve — concurrency[t] = number of open trades on bar t.
2. For each trade, uniqueness = mean(1/concurrency[t]) across its holding bars (entry…exit, inclusive).
3. avg_uniqueness = mean of per-trade uniqueness, clamped to [0.05, 1].
4. `deflatedSharpe = sharpeRatio × √avg_uniqueness`.

Why: overlapping holding periods produce dependent return observations, which inflates the raw Sharpe. avg_uniqueness ∈ (0,1]: 1 → fully non-overlapping (raw = deflated); 0.5 → on average half each trade's bars overlap with a sibling → effective sample halved → Sharpe deflated by √2.

Zero-trades early-return defaults: `deflatedSharpe = 0`, `avgSampleUniqueness = 1`. The UI shows the deflated value next to raw Sharpe so users can spot the gap at a glance.
