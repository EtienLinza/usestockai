

# Why Your Strategy Massively Underperforms SPY — and How to Fix It

## The Core Problem: 6% Market Exposure

Your logs show the system is in a trade only ~6% of the time. SPY is fully invested 100% of the time. This alone mathematically guarantees underperformance in a rising market.

Think of it this way: SPY compounds at ~10%/year on $100K fully invested. Your system invests $20K (position size) for ~6% of the time. Even with perfect trades, you're only deploying ~$1,200 of effective capital on average.

## The 5 Structural Causes

### 1. Trend requires ALL 4/4 conditions (line 304)
EMA alignment + price > SMA50 + MACD positive AND increasing + RSI 35-75. All four must be true simultaneously. This is extremely rare.

### 2. Mean Reversion requires `above200` to BUY (line 339)
MR is designed to buy oversold dips — but dips often push price below the 200 SMA. Requiring `above200` blocks the exact trades MR is supposed to catch. Same problem inverted for shorts.

### 3. Breakout has 4 conjunctive filters (line 363)
Squeeze + volume > 1.5x + ADX rising + range expansion must ALL be true. Each filter independently passes maybe 10-20% of the time. Together: ~0.1%.

### 4. STEP=5 with confirmation=2 means 10-bar signal delay for trends
By the time the trend signal confirms, the move is often half over.

### 5. Single position at a time
The system can only hold one trade. With 5-20 bar holding periods and 5-bar cooldown, most of the year is idle.

## The Fix: 6 Changes to `supabase/functions/backtest/index.ts`

### Change 1: Relax Trend entry to 3/4 conditions
Replace `trendBuyScore === 4` with `trendBuyScore >= 3`. Same for short. This alone could 3-4x the number of trend signals.

### Change 2: Remove 200 SMA guard from Mean Reversion
MR buys oversold conditions regardless of the long-term trend — that's the whole point. Remove the `&& above200` / `&& below200` requirement from MR signals. Keep the 200 SMA guard only for Trend entries where it makes sense.

### Change 3: Relax Breakout to 3/4 filters
Make range expansion OR volume confirmation required, not both. Keep squeeze + ADX rising as mandatory. This filters false breakouts while allowing more real ones through.

### Change 4: Remove trend confirmation requirement
Set `needsConfirmation = false` for all strategies. The individual strategy filters are already strict enough. Confirmation at STEP=5 adds a 10-bar delay that kills entry timing.

### Change 5: Allow concurrent positions
Track multiple open positions (up to `maxPositions` from config). Process signals even while existing trades are open. This dramatically increases market exposure — the single biggest lever for performance.

### Change 6: Reduce STEP from 5 to 2
Evaluate signals every 2 bars instead of 5. More frequent evaluation catches signals closer to their optimal entry point. Adjust cooldown proportionally.

## Expected Impact

| Metric | Current | Expected |
|--------|---------|----------|
| Market exposure | ~6% | ~25-40% |
| Trades (AAPL 25yr) | ~38 | ~150-300 |
| Signal diversity | Mostly trend | Balanced mix |

This won't guarantee beating SPY — that requires actual edge. But it removes the structural handicaps that make it impossible to compete even with good signals.

## What Stays the Same
- All indicator calculations
- ATR-based trailing stops and volatility-adaptive logic
- Walk-forward structure
- All metrics, Monte Carlo, robustness testing
- CPU budget guard and performance optimizations
- Frontend UI

## Frontend Change: `src/pages/Backtest.tsx`
No changes needed. The existing UI handles variable trade counts and all metrics already.

