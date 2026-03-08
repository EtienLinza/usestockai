

# Unified Architecture: Dual-Timeframe + Allocation-Based Engine

## Core Design

Combine all three approaches into one system. No compromises.

**Weekly bars** set the macro trend bias and target allocation (0-100%). **Daily bars** find optimal entry/exit timing within the weekly trend. **Signal-weighted allocation** replaces binary buy/sell — conviction controls position size continuously, not discretely.

## Architecture Overview

```text
WEEKLY LAYER (trend direction + allocation target)
┌─────────────────────────────────────────────┐
│ Weekly 10/40 MA alignment → trend bias      │
│ Weekly RSI → overbought/oversold guard      │
│ Weekly ADX → trend strength                 │
│ → Target Allocation: 0% / 25% / 50% / 100% │
└─────────────────────────────────────────────┘
                    ↓
DAILY LAYER (entry timing + position scaling)
┌─────────────────────────────────────────────┐
│ Daily EMA12/26 crossover → entry trigger    │
│ Daily RSI pullback to 40-50 → buy dip      │
│ Daily MACD histogram → momentum confirm    │
│ → Scale INTO target over 1-4 daily signals  │
└─────────────────────────────────────────────┘
                    ↓
ALLOCATION ENGINE (replaces binary trades)
┌─────────────────────────────────────────────┐
│ Current allocation vs target allocation     │
│ If target > current → scale up (buy more)   │
│ If target < current → scale down (sell)     │
│ If target = 0 → full exit                   │
│ Rebalance check: weekly (not daily)         │
└─────────────────────────────────────────────┘
```

## Changes — All in `supabase/functions/backtest/index.ts`

### 1. Add Weekly Bar Aggregation (~30 lines, new function after line 176)
- `aggregateToWeekly(data: DataSet): DataSet` — groups daily OHLCV into weekly bars
- Weekly close = Friday close, weekly high/low = max/min of week, volume = sum

### 2. Add Weekly Signal Function (~60 lines, new function after weekly aggregation)
- `computeWeeklyBias(weeklyData, idx)` → returns `{ bias: "long" | "flat" | "short", targetAllocation: 0 | 0.25 | 0.50 | 1.0 }`
- Logic:
  - Weekly close > 10-week EMA AND 10-week > 40-week EMA → long bias
  - Weekly RSI 40-70 + ADX > 20 → full allocation (1.0)
  - Weekly RSI 30-40 or ADX < 20 → half allocation (0.5)
  - Weekly close < 40-week EMA → flat (0.0) — no longs
  - Weekly close < 10-week < 40-week + RSI < 40 → short bias (only in confirmed bear)

### 3. Rewrite `runWalkForwardBacktest` Core Loop (lines 1090-1445)
Replace the binary signal → open position → exit position loop with:

**New state model:**
```
currentAllocation: number (0.0 - 1.0)
targetAllocation: number (0.0 - 1.0)  
currentShares: number
currentDirection: "long" | "short" | "flat"
```

**New loop logic (weekly rebalance cycle):**
- Every 5 bars (weekly): compute weekly bias → set `targetAllocation`
- Every 1 bar (daily): if `targetAllocation > currentAllocation`, look for daily entry signal to scale up by 25% increments
- If `targetAllocation < currentAllocation`, scale down immediately (don't wait for daily signal)
- If `targetAllocation = 0` and `currentAllocation > 0`, exit fully
- Hard stop: if position drawdown exceeds `2.5 * weeklyATR%` from average entry, exit fully regardless of target

**Scaling mechanics:**
- Each scale-up is a "sub-trade" recorded in the trade log
- Average entry price updates with each scale
- Position size per scale = `(capitalPerTicker * targetAllocationDelta) / entryPrice`

**Exit triggers (replace current 5 exit types with 3):**
1. Weekly trend reversal (10-week crosses below 40-week) → full exit
2. Hard stop at 2.5× weekly ATR from avg entry → full exit  
3. Scale-down: weekly allocation drops from 1.0 to 0.5 → sell 50%

**Shorts:**
- Only allowed when weekly bias = "short" (both weekly MAs declining, RSI < 40)
- Scale in same way but inverted
- Much rarer — maybe 2-5 short periods in 25 years

### 4. Eliminate Daily Noise Filters (simplification)
Remove from the signal engine:
- OBV confirmation (was adding complexity without improving results)
- Breakout strategy (squeeze detection unreliable on daily)
- Cooldown bars (allocation-based system doesn't need cooldowns)
- Layer 3 adaptive conviction bonus (replaced by weekly allocation target)

Keep:
- Stock classification (momentum/value/index/volatile) — used to set weekly MA parameters
- SPY regime filter — integrated into weekly bias
- ATR-based risk management — used for hard stop calculation
- All metrics computation, reporting, and robustness infrastructure unchanged

### 5. Profile-Specific Weekly Parameters (modify `PROFILE_PARAMS`, lines 214-243)
Replace daily-centric params with weekly-centric ones:

```typescript
momentum: { weeklyFastMA: 10, weeklySlowMA: 40, weeklyRSILong: 45, hardStopATRMult: 3.0 }
value:    { weeklyFastMA: 13, weeklySlowMA: 50, weeklyRSILong: 35, hardStopATRMult: 2.5 }
index:    { weeklyFastMA: 10, weeklySlowMA: 40, weeklyRSILong: 40, hardStopATRMult: 2.8 }
volatile: { weeklyFastMA: 8,  weeklySlowMA: 30, weeklyRSILong: 50, hardStopATRMult: 3.5 }
```

### 6. Trade Recording (adapt, lines 786-804)
Add new fields to `Trade` interface:
- `scaleLevel: number` (1-4, which scale-up this was)
- `allocationAtEntry: number` (0.25, 0.5, 0.75, 1.0)
- Keep all existing fields for backward compatibility with the UI

### 7. Cost Reduction Math
- Weekly rebalance = ~52 checks/year vs 252 daily = **5× fewer trades**
- Scaling in 25% increments = 4 entries max vs constant in/out
- Expected: ~8-15 round-trip trades per stock per year (vs 40-80 currently)
- Cost impact: 0.50% × 12 trades = 6%/year vs 0.50% × 60 trades = 30%/year

## What Stays Unchanged
- All indicator functions (lines 1-176) — reused for both weekly and daily
- `classifyStock` function (lines 267-370) — still classifies using daily data
- `fetchYahooData` (lines 728-770) — still fetches daily data; weekly aggregated in-engine
- All metrics computation (lines 1479-1867) — works on trades regardless of how generated
- Monte Carlo, robustness tests, stress tests, signal decay — all unchanged
- Main handler (lines 2233-2500) — unchanged API contract
- Equity curve, drawdown curve, benchmark comparison — all unchanged

## Expected Impact
- **Trade count**: ~10-15 per stock per 25 years (vs 40-100 currently)
- **Win rate**: 55-65% (weekly trends are more reliable than daily signals)
- **Cost drag**: ~6% total over 25 years (vs ~750% currently at 30%/year)
- **Alignment**: Long-only in bull markets, flat in bears = aligned with structural market direction

