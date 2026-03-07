

# Fix: Backtest CPU Timeout on Multi-Ticker Runs

## Root Cause

The edge function logs show **"CPU Time exceeded"** repeatedly. The backtest itself completes (185 trades logged) but crashes during **post-processing**. Here's the computation budget:

- **Main backtest**: 5 tickers x 25 years = 5 full walk-forward runs
- **Robustness tests**: noise injection (1 run) + delayed execution (1 run) + parameter sensitivity (5 threshold variations = 5 runs) = **7 additional full backtests**
- **Monte Carlo**: 1000 shuffled simulations
- **Signal decay**: linear scan with `indexOf` on every trade (O(n*m))

Total: ~12 full walk-forward executions + 1000 Monte Carlo sims. Edge functions have a ~2s CPU time limit.

## Changes — `supabase/functions/backtest/index.ts`

### 1. Scale robustness tests based on ticker count
When running 3+ tickers, skip noise injection and delayed execution entirely. Reduce parameter sensitivity to 3 variations (from 5). For 1-2 tickers, keep full robustness.

### 2. Reduce Monte Carlo simulations
Drop from 1000 to 200 simulations. Statistical percentiles stabilize well at 200 with 100+ trades.

### 3. Fix signal decay O(n*m) performance
`computeSignalDecay` uses `data.timestamps.indexOf(t.date)` which is O(n) per trade. Build a Map lookup instead — O(1) per trade.

### 4. Increase walk-forward STEP for robustness sub-runs
When `runWalkForwardBacktest` is called from robustness tests, use STEP=10 instead of 5 to halve computation. Add an optional `step` parameter.

### 5. Add CPU budget guard
Track elapsed time with `Date.now()`. Before starting robustness tests, check if >1.5s has elapsed. If so, skip robustness and return results without them. This prevents the crash and gives partial results.

### 6. Limit equity curve points
Cap `combinedEquity` to 500 sampled points before JSON serialization to reduce payload size and prevent serialization overhead from causing the timeout.

## Changes — `src/pages/Backtest.tsx`

### 7. Show partial results gracefully
If robustness data is null/empty, show "Skipped (computation budget exceeded)" instead of empty cards.

### 8. Better timeout error message
When the fetch returns a network error or 500 from CPU timeout, show a specific message: "Backtest timed out. Try fewer tickers or a shorter date range."

## What Stays the Same
- All strategy logic, signal engine, holding periods
- All metrics computation
- Trade log, charts, strategy attribution
- Walk-forward structure for the main backtest

## Expected Impact
- CPU time reduced by ~60-70% for 5-ticker, 25-year runs
- Graceful degradation: users always get core results even if robustness is skipped
- Single-ticker runs remain fully featured

