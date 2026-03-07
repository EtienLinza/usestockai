

# Fix: Beta Calculation Is Broken & Confidence Scores Are Inaccurate

## Problem 1: Beta Is Nonsense

**Location**: `computeMetrics()`, lines 1492-1507

The `returns` array contains **per-trade returns** (one entry per trade, occurring on irregular dates). The `benchmarkReturns` array contains **daily SPY returns** (one per trading day). The code zips them together sequentially:

```text
Trade #1 return (entered March 5) → paired with SPY Jan 2 daily return
Trade #2 return (entered March 20) → paired with SPY Jan 3 daily return
...completely wrong pairings
```

This produces a meaningless covariance and therefore garbage beta.

**Fix**: Compute beta from the **equity curve** instead of trade returns. Convert the equity curve to daily returns, align them with SPY daily returns by date, then compute covariance/variance on the aligned series. This gives proper time-synchronized beta.

- Build a `Map<string, number>` of equity curve daily returns (date → return)
- Build a `Map<string, number>` of SPY daily returns (date → return)  
- Find overlapping dates, extract paired return arrays
- Run the same covariance/variance regression on aligned data
- Alpha = annualized excess return over beta × benchmark

## Problem 2: Confidence Scores Are Compressed Into a Useless Range

**Location**: `computeStrategySignal()`, line 689

```
confidence = 50 + cappedConviction * 0.35
```

Since the conviction threshold gates entries at ~62, all trades enter with confidence between **71.7% and 85%**. This 13-point range makes confidence meaningless — every trade looks "pretty confident" and the calibration chart shows massive overconfidence (predicted 75% vs actual 45%).

**Fix**: Map confidence directly from conviction, using a wider range that reflects actual signal quality:

- `confidence = cappedConviction` — just use the conviction score directly as the confidence (it's already 0-100)
- Remove the artificial 50-point floor and 0.35 scaling
- Adjust the calibration buckets to match the actual distribution (most trades cluster 62-85 conviction)
- Update calibration buckets: `60-65`, `65-70`, `70-75`, `75-80`, `80-90`, `90-100`

## Changes: 1 file (`supabase/functions/backtest/index.ts`)

### In `computeStrategySignal` (~line 689):
Replace the confidence formula with direct conviction mapping

### In `computeMetrics` (~lines 1492-1507):
Replace the broken trade-vs-daily regression with equity-curve-vs-SPY aligned daily returns regression

### In `computeMetrics` (~lines 1567-1573):
Update confidence calibration buckets to `60-65`, `65-70`, `70-75`, `75-80`, `80-90`, `90-100` to match the actual conviction distribution

