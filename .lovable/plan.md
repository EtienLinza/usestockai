

# Backtester Quality Improvements: ATR-Based Risk Management and Signal Filtering

## Summary
Address the key weaknesses identified in the quant review by replacing fixed-percentage thresholds with volatility-adaptive (ATR-based) logic. 6 changes in `supabase/functions/backtest/index.ts`, no new files, no database changes.

## Problem
The current engine uses fixed percentages (3% trailing stop, 2% SMA deviation, 5% stop-loss) that behave inconsistently across different volatility regimes. A 3% stop on a low-vol stock is huge; on a high-vol stock it's noise. This causes premature exits on volatile assets and late exits on calm ones.

## Changes — `supabase/functions/backtest/index.ts`

### 1. Add ATR Calculation Function
Add a new `calculateATR(high, low, close, period)` function that computes Average True Range. The ADX function already computes True Range internally but doesn't expose ATR as a usable value. This becomes the foundation for all volatility-adaptive logic.

### 2. Pass ATR into Signal Engine
Update `computeStrategySignal` to calculate and return the current ATR value alongside the existing signal output. This ATR value will be consumed by the holding/exit logic in the walk-forward loop.

### 3. ATR-Based Trailing Stops
Replace the fixed 3% trailing stop with `2 × ATR` from entry price. This automatically adjusts to each asset's volatility:
- Low-vol stock (ATR ~0.5%): trail = 1% from peak
- High-vol stock (ATR ~3%): trail = 6% from peak

The breakeven activation threshold also becomes ATR-based: activate after `1 × ATR` gain instead of fixed 2%.

### 4. Volatility-Adjusted Mean Reversion Thresholds
Replace the fixed `smaDeviation > 2%` condition with `smaDeviation > 1.5 × ATR / price`. This means MR signals fire when the price-to-SMA distance is extreme *relative to recent volatility*, not just in absolute percentage terms.

### 5. Breakout Range Expansion Filter
Add a range expansion check to the breakout strategy: `currentRange > 1.5 × ATR` where `currentRange = high[last] - low[last]`. True breakouts show large candles. This filters out many false breakouts where price barely pokes above the Bollinger Band.

### 6. Wider Stops for Trend Strategy
For trend trades only, widen the hard stop-loss to `3 × ATR` instead of the user-configured fixed percentage. Trend strategies need room to breathe through normal volatility. Mean reversion and breakout keep the user-configured stop.

## What Stays the Same
- All indicator calculations (EMA, SMA, RSI, MACD, BB, ADX, Stochastic)
- All metrics computation, Monte Carlo, stress testing, robustness
- Walk-forward structure, cooldown, confirmation logic
- User-configurable parameters (stop-loss still applies as a hard floor for MR/breakout)
- Frontend — no UI changes needed
- CPU budget guard and performance optimizations

## Expected Impact
- More consistent behavior across assets with different volatility profiles
- Fewer false breakout entries (range expansion filter)
- Fewer premature trend exits (ATR-based trailing + wider stops)
- Better mean reversion timing in volatile markets
- Win/loss asymmetry should improve as trend winners have room to develop

