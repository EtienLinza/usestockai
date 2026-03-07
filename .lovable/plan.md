

# Stock-Adaptive Strategy Profiles

## Problem
The backtester uses identical parameters for every stock — same ADX threshold, same hold periods, same take-profit, same conviction thresholds. AAPL (high-momentum growth) needs different treatment than XOM (mean-reverting value) or SPY (broad index). The system works well on one stock type but underperforms on others because one-size-fits-all parameters can't capture different stock behaviors.

## Solution: Auto-Classify Stocks and Apply Adaptive Profiles

### File: `supabase/functions/backtest/index.ts`

### Step 1 — Stock Classifier Function

Add a `classifyStock()` function that runs once at the start of a backtest, using the first ~250 bars of data to determine the stock's behavioral profile. Classification based on observable price characteristics (no external data needed):

```text
Inputs: close[], high[], low[], volume[]
Metrics computed:
  - Beta to SPY (correlation × vol ratio)
  - Average daily volatility (20-day)
  - Trend persistence: autocorrelation of returns (lag-1 to lag-5)
  - Mean reversion tendency: how often RSI extremes snap back within 5 bars
  - Average ATR as % of price

Output → one of 4 profiles:
  "momentum"    — high trend persistence, high vol (AAPL, TSLA, NVDA)
  "value"       — low trend persistence, high mean-reversion (XOM, JPM, KO)
  "index"       — moderate everything, high correlation to SPY (SPY, QQQ, DIA)
  "volatile"    — very high ATR%, low autocorrelation (MEME stocks, small caps)
```

The classifier re-evaluates every 250 bars (rolling) so a stock can shift profiles over time (e.g., AAPL 2000-2005 was "volatile", 2015-2025 is "momentum").

### Step 2 — Profile-Specific Parameters

Each profile overrides key strategy parameters passed into `computeStrategySignal` and trade sizing:

```text
                    momentum    value       index       volatile
─────────────────────────────────────────────────────────────────
ADX threshold       20          30          25          20
RSI oversold        35          25          30          20
RSI overbought      65          75          70          80
Max hold (trend)    30 bars     15 bars     20 bars     12 bars
Max hold (MR)       8 bars      12 bars     10 bars     6 bars
Take profit         15%         8%          10%         12%
Trailing stop mult  2.5 ATR     1.5 ATR     2.0 ATR     3.0 ATR
Buy threshold       60          65          65          70
Short threshold     70          60          65          60
Conviction bonus    +10 trend   +10 MR      0           +5 breakout
```

Key differences:
- **Momentum stocks** get longer holds, wider trailing stops, higher take-profit (let winners run), lower ADX threshold (catch trends earlier), and a trend conviction bonus
- **Value stocks** get tighter holds, lower trailing stops, and a mean-reversion conviction bonus (MR works better on these)
- **Index** uses balanced defaults (current behavior)
- **Volatile** gets very short holds, wide trailing stops (avoid whipsaws), high buy threshold (only enter on strong signals)

### Step 3 — Apply Profiles in Walk-Forward Loop

In `runWalkForwardBacktest`, before the main loop:
1. Call `classifyStock()` on the initial 250-bar window
2. Merge the profile overrides with user-provided config (user config takes priority if explicitly set)
3. Every 250 bars, re-classify to allow profile shifts

When computing signal and trade parameters (lines ~900-985), use profile-adjusted values instead of raw config values:
- `maxHoldBars` → profile-specific per strategy
- `takeProfitPct` → from profile
- `trailingStopATRMult` → from profile
- `buyThreshold` / `shortThreshold` → from profile
- Add strategy-specific conviction bonus from profile inside `computeStrategySignal`

### Step 4 — Report the Classification

Add a `stockProfile` field to the backtest report so the UI can display which profile was detected:

```typescript
stockProfile: {
  classification: "momentum" | "value" | "index" | "volatile";
  beta: number;
  trendPersistence: number;
  meanReversionRate: number;
  avgVolatility: number;
}
```

No UI changes needed initially — the profile data will be in the response for future visualization.

### How It Prevents Overfitting

- The classifier uses only basic statistical properties (autocorrelation, vol, mean-reversion rate) — not curve-fitted thresholds
- Profiles are broad categories (4 types), not per-stock parameter tuning
- Parameters within profiles are based on known market microstructure differences (momentum stocks trend longer, value stocks revert faster)
- Rolling re-classification prevents static assumptions
- User can still override any parameter, profiles just provide better defaults

### Expected Impact

| Stock | Current Profile | Adaptive Profile | Key Change |
|-------|----------------|-----------------|------------|
| AAPL | Generic (20-bar hold, 10% TP) | Momentum (30-bar hold, 15% TP) | Captures larger moves |
| XOM | Generic (same MR rules) | Value (MR conviction bonus, tighter exits) | More MR trades, faster exits |
| SPY | Generic | Index (balanced, unchanged) | No regression |
| TSLA | Generic (stopped out often) | Momentum/Volatile (wider stops) | Fewer whipsaws |
| JPM | Generic | Value (lower short threshold) | Better short entries |

