

# Diagnosis: The Classification System Is Fundamentally Broken

## What the Logs Show

I ran an AAPL backtest (2020-2025, adaptive mode) and checked the classification logs. Here are the facts:

**AAPL classifications across walk-forward windows:**
- `volatile` — most frequent (atrPct > 0.025)
- `value` — second most frequent (meanRev > 0.45)
- `index` — fallback when neither triggers
- `momentum` — **NEVER triggered. Not once.**

**AAPL results**: 44 trades, 40.91% win rate, Sharpe -1.81, annualized return -1.58%, alpha -288. The algorithm lost money on a stock that roughly doubled.

**TSLA results**: Classified as `volatile` in every window (correct). Only 1 backtest in logs, no result metrics captured.

## Root Cause

The `trendPersistence` metric (daily return lag-1 to lag-5 autocorrelation) is **fundamentally wrong as a momentum detector**. Most liquid stocks have near-zero or negative daily autocorrelation — this is a well-known market microstructure effect. AAPL's trendP ranges from -0.04 to +0.01. The threshold of > 0.03 is almost never hit by any large-cap stock.

The alternative momentum path (`avgVolatility > 0.015 AND atrPctAvg < 0.025 AND meanReversionRate < 0.5`) also fails for AAPL because its atrPct hovers around 0.019-0.025 — right at the boundary — and its meanReversionRate is often above 0.5.

**Result**: AAPL flips between `volatile` and `value` profiles, getting mean-reversion parameters applied to a trending stock. The short hold times (6-8 bars for MR) and high conviction thresholds cause premature exits on good trend trades.

## The Fix

The classification system needs a different momentum detector. Instead of daily return autocorrelation, use **price trend strength** — whether the stock spends most of its time above its moving averages and makes higher highs.

### Changes to `supabase/functions/backtest/index.ts`

**1. Replace `trendPersistence` metric in `classifyStock()`:**

Replace the autocorrelation calculation with a composite trend score:
- **MA alignment**: % of bars where close > SMA(50) AND SMA(50) > SMA(200). High = trending.
- **Higher-highs ratio**: Count of 20-bar rolling highs that exceed previous 20-bar high, divided by total windows. High = trending.
- Combined into a `trendScore` from 0-1.

**2. Update classification thresholds:**

```
volatile:  atrPctAvg > 0.025 AND trendScore < 0.4
momentum:  trendScore > 0.5 (stock spends >50% of time in uptrend alignment)
value:     meanReversionRate > 0.45 AND trendScore < 0.4
index:     fallback
```

The key insight: a stock can have negative daily autocorrelation AND still be a momentum stock if it persistently trends upward. The new metric measures actual price behavior, not return statistics.

**3. Soften profile impact further:**

Since classification will still occasionally be wrong, reduce the gap between profiles:
- All profiles share the same `buyThreshold: 62` and `shortThreshold: 60` — the conviction threshold shouldn't change based on stock type
- Only vary trade management params (hold times, trailing stops, take profit) which are less destructive if wrong

**4. Add a "blend" approach for borderline stocks:**

If the classification metrics are near boundaries (e.g., trendScore between 0.35-0.55), blend the two closest profiles' parameters instead of picking one. This prevents parameter jumps when a stock oscillates between two categories.

## Expected Impact

- AAPL should classify as `momentum` since it spends >60% of 2020-2025 above its 50-SMA with the 50-SMA above the 200-SMA
- XOM should classify as `value` (lower trend score, high mean reversion)
- TSLA should remain `volatile` (high ATR dominates)
- SPY force-classified as `index`
- Borderline stocks get blended params instead of whiplashing between profiles

