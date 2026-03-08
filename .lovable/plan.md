

# Backtest Engine: Fixing Statistical Distortions and Structural Weaknesses

Your audit is accurate. Here are the concrete issues found in the code and the fixes needed.

---

## Issue 1: Sortino Ratio Is Statistically Wrong (CRITICAL)

**Root Cause** (lines 1616-1627): The Sharpe and Sortino are computed from **per-trade returns** but annualized with `Math.sqrt(252/5)` as if trades occur every 5 days. With only ~8 trades/year across 4 stocks, this inflates both ratios by ~5-7x.

```typescript
// CURRENT (broken): assumes trade every 5 bars
const sharpeRatio = stdReturn > 0 
  ? ((meanReturn - riskFreeDaily) / stdReturn) * Math.sqrt(252 / 5) : 0;
```

**Fix**: Compute Sharpe/Sortino from **daily equity curve returns** instead of per-trade returns. The equity curve already exists with enough data points. This produces industry-standard ratios (typically 0.5-2.5 for good strategies).

---

## Issue 2: Capital Deployment Is Too Low (15% Kelly = 85% Cash)

**Root Cause** (line 1454): Fixed `kellyFraction = 0.15` means 85% of capital earns nothing. Combined with 70% market exposure, effective deployment is ~10.5%.

**Fix**: 
- Increase base Kelly to 25% for high-conviction entries (W/L > 3.0)
- Add **risk-free rate accrual** on idle capital: `idleCapital *= (1 + 0.04/252)` each bar when not in a position
- This alone should add ~2-3% annualized to reported returns

---

## Issue 3: Asset Universe Too Small (4-5 tickers per run)

**Root Cause**: The system caps at 5 tickers per request (line 2302). With trend-following, more instruments = more opportunities to catch trends.

**Fix**: This is partly a UI/config issue, but the engine can support a **sector rotation mode** that auto-selects the top N tickers from a broader universe based on momentum ranking. Not a code bug per se, but the biggest lever for CAGR improvement.

---

## Issue 4: Strategy Capacity Estimate Is Wrong

**Root Cause** (likely in metrics): Capacity is derived from average volume but doesn't account for the fact that these are mega-cap stocks with billions in daily volume.

**Fix**: Adjust capacity calculation to use actual average daily dollar volume × 2% participation rate.

---

## Implementation Plan

### Step 1: Fix Sharpe/Sortino to use daily equity curve returns
- Replace per-trade ratio calculation with daily equity curve return series
- Proper annualization: `ratio * sqrt(252)` on daily returns
- Expected Sortino: drops from 13.79 to ~1.5-2.5 (realistic)

### Step 2: Increase capital deployment
- Raise Kelly from 15% to 25% for entries with conviction > threshold
- Add daily risk-free accrual (4% annualized) on idle cash
- Add optional "allow 2 concurrent positions per ticker" for scale-in on pullbacks

### Step 3: Fix strategy capacity calculation
- Use ticker-specific average daily dollar volume from the data
- Cap at 2% ADV participation rate

### Step 4: Re-run full 15-sector suite to validate
- Confirm Sortino/Sharpe are now in realistic ranges
- Confirm CAGR improvement from higher deployment + risk-free accrual
- Verify no regression in drawdown or win rate

All changes are in `supabase/functions/backtest/index.ts`. No database or UI changes needed.

