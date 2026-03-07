

# Fix Backtester: From 12 Trades to Statistically Valid Output

## Summary
10 targeted changes to `supabase/functions/backtest/index.ts` to fix filter stacking, plus exit reason tracking and a frontend display update. No new files, no database changes.

## Backend Changes (`supabase/functions/backtest/index.ts`)

### 1. Close ADX Dead Zone (line 293)
Change MR activation from `adxVal < 20` to `adxVal < 25`. Trend stays at `adxVal > 25`. No gap.

### 2. Relax Mean Reversion Thresholds (lines 295-321)
- RSI: `< 30` / `> 70` (was 25/75)
- Stochastic: `< 20` / `> 80` (was 15/85)
- SMA deviation: `> 2%` (was 3%)
- Volume: `> 1.2x` (was 1.5x)
- Require **3 of 5** conditions (was 4/5)

### 3. Relax Breakout Detection (lines 327-343)
- Squeeze threshold: `bbBW < bwAvg50 * 0.7` (was 0.5)
- Volume: `> 1.5x` (was 2x)
- Remove `above200`/`below200` guard from breakout signals

### 4. Strategy-Specific Confirmation (lines 375-378)
- Trend: keep `CONFIRMATION_REQUIRED = 2`
- Mean reversion and breakout: skip confirmation (execute immediately)
Add strategy type check before the confirmation gate.

### 5. Widen Trend RSI Range (lines 264-268, 273-278)
- BUY RSI: `35-75` (was 40-70)
- SHORT RSI: `25-60` (was 30-60)

### 6. Reduce Cooldown (line 599)
Change `COOLDOWN_BARS = 15` to `COOLDOWN_BARS = 5`.

### 7. Strategy-Specific Holding Periods (lines 624-656)
Replace the fixed `testEnd = entryIdx + STEP` with strategy-aware max hold:
- **Trend**: up to 20 bars, with trailing stop (breakeven after +2%, trail 3% from peak)
- **Mean Reversion**: up to 10 bars
- **Breakout**: up to 15 bars, with trailing stop (trail 3% from peak)

Keep existing stop-loss/take-profit as hard limits within the extended loop.

### 8. Add Exit Reason Tracking
Add `exitReason: "stop_loss" | "take_profit" | "trailing_stop" | "time_exit"` to `Trade` interface.
Track which condition triggered the exit in the holding loop and store it on each trade.

### 9. Pass Strategy to Walk-Forward Loop
The signal's `strategy` field is already returned. Pass it into the holding period logic so the loop knows which max-hold and trailing-stop rules to apply.

### 10. Document TRAIN_WINDOW
Add comment explaining why TRAIN_WINDOW = 250 (SMA200 needs 200 bars + 50 buffer).

## Frontend Changes (`src/pages/Backtest.tsx`)

### 11. Add `exitReason` to Trade Log
Add `exitReason` column to the trade log table and update the `BacktestReport.tradeLog` interface to include it.

### 12. Exit Reason Distribution Card
New card with a horizontal bar chart showing count/percentage by exit reason (stop loss, take profit, trailing stop, time exit). Uses existing recharts BarChart.

## What Stays the Same
- All indicator calculations
- All metrics computation (Sharpe, Sortino, drawdown, etc.)
- All robustness tests, Monte Carlo, stress testing
- Volatility-adjusted position sizing logic
- 200 SMA trend guard (kept for trend and MR, removed only for breakout)
- Walk-forward structure and transaction cost model

## Expected Impact
- Trade count: 12 → ~80-200 over 25 years
- Mean reversion: 0 → ~20-40 trades
- Breakout: 1 → ~10-20 trades
- Market exposure: ~1% → ~8-15%
- All statistical metrics become meaningful with 100+ trades

