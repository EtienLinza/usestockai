

# Adaptive Stock Intelligence: Dual-Regime + Relative Strength + Conviction Bonus

## Problem
All stocks are filtered through SPY's regime. A stock like AAPL in a strong personal uptrend gets blocked from buying when SPY briefly dips below its 200 SMA. The system treats market leaders and market laggards identically.

## Solution: Three-Layer Adaptive System

### File: `supabase/functions/backtest/index.ts`

### Layer 1 — Dual-Regime System
Inside `computeStrategySignal`, calculate the stock's OWN regime independently:
- `stockAbove200`: stock price > stock's 200 SMA
- `stockSMASlope`: stock's own 200 SMA slope (20-bar ROC)
- `stockRegimeBullish`: stockAbove200 AND stockSMASlope > 0

Change all existing trend guard checks to require BOTH SPY AND stock to be bearish before blocking:
- Current: `above200` (stock vs its own 200 SMA) blocks MR buys when false
- New: Only block when `below200 AND spyBearish` (passed as a parameter)
- Current: `sma200Declining` blocks trend buys
- New: Only block when `sma200Declining AND spySMADeclining`

This means: if AAPL is above its 200 SMA with a rising slope, it trades freely regardless of SPY.

**Implementation**: Add `spyBearish` and `spySMADeclining` as optional params to `computeStrategySignal`. Compute these from SPY data in the walk-forward loop and pass them in. Modify the 4 guard conditions (lines ~321, 329, 364, 370) to AND with the SPY flags.

### Layer 2 — Relative Strength Filter  
In the walk-forward loop (before calling `computeStrategySignal`), calculate rolling 50-bar relative strength:
```
stockReturn50 = (close[i] - close[i-50]) / close[i-50]
spyReturn50 = (spyClose[date] - spyClose[date-50]) / spyClose[date-50]  
relativeStrength = stockReturn50 - spyReturn50
isLeader = relativeStrength > 0.10  // outperforming SPY by 10%+
```

When `isLeader === true`:
- Skip the SPY > 200 SMA short-blocking filter (line ~864-869) — if AAPL is crushing SPY, let it short on its own merits
- Skip the regime conviction penalty (already handled by dual-regime, but RS provides a second override)

### Layer 3 — Adaptive Conviction Bonus
Inside `computeStrategySignal`, after the regime conviction penalty (lines ~434-441), add a conviction bonus for stocks in their own strong trend:

```
// If stock is in its own strong uptrend, boost BUY conviction
if (stockAbove200 && stockSMASlope > 0.02 && rsiVal > 40 && rsiVal < 70) {
  if (bestSignal === "BUY") adjustedConviction += 15;
}
// If stock is in its own strong downtrend, boost SHORT conviction  
if (!stockAbove200 && stockSMASlope < -0.02 && rsiVal > 30 && rsiVal < 60) {
  if (bestSignal === "SHORT") adjustedConviction += 15;
}
```

This offsets the 0.7× regime penalty when the stock itself is trending strongly, allowing high-quality setups through even when SPY is weak.

### How the Three Layers Interact

```text
Signal Generated
       │
       ▼
  Layer 1: Dual Regime
  ├─ Both SPY + Stock bearish? → Apply full guard (block)
  ├─ Only SPY bearish, stock bullish? → Relax guard (allow)
  └─ Both bullish? → No guard needed
       │
       ▼
  Layer 2: Relative Strength
  ├─ Stock outperforming SPY by >10%? → Override SPY short filter
  └─ Otherwise → Keep SPY short filter
       │
       ▼
  Layer 3: Conviction Bonus
  ├─ Stock in own strong trend? → +15 conviction (offsets regime penalty)
  └─ Otherwise → Standard conviction
       │
       ▼
  Threshold Check → Trade or Skip
```

### Expected Impact

| Scenario | Before | After |
|----------|--------|-------|
| AAPL buy when SPY < 200 SMA but AAPL > 200 SMA | Blocked | Allowed (dual regime) |
| AAPL buy in SPY bear, AAPL outperforming by 15% | Penalized 0.7× | Penalty offset by +15 bonus |
| JPM buy when both JPM and SPY bearish | Blocked | Still blocked (correct) |
| Short AAPL when AAPL is a leader | Blocked by SPY filter | Allowed (RS override) |

The system now treats each stock as an individual entity while still respecting broad market risk when the stock itself confirms the weakness.

