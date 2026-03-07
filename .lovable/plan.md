

# Diagnosis: The 2 Latest Runs Expose 3 Critical Bugs

## What the logs show

| Run | Tickers | Trades | Win Rate | Sharpe |
|-----|---------|--------|----------|--------|
| Latest | SPY,MSFT,XOM,JPM | 2,632 | 42.48% | **-0.39** |
| Previous | SPY,MSFT,XOM,JPM,GE | 3,276 | 43.1% | **-0.26** |

The pendulum swung from 12 trades (undertading) to 3,000+ trades (overtrading) with **zero improvement in edge**. Here's exactly why.

---

## Bug 1: Capital Double-Counting (Critical)

The equity curve is **inflated** because of a bookkeeping error in multi-position tracking.

When opening a position, `capitalInPositions` increases but `capital` is **never reduced**. So `capital` already implicitly contains the deployed amount. But at exit (line 750), the code pushes:

```
equity = capital + capitalInPositions
```

This double-counts every open position. With multiple positions open simultaneously, equity is inflated by the entire deployed capital of remaining positions.

**Fix**: Track capital properly — subtract positionSize from `capital` on entry, add back `(positionSize + pnl)` on exit. Equity curve = `capital + mark-to-market of open positions`.

## Bug 2: Cooldown Is Per-Ticker but SignalState Is Shared

`signalState` is a single object shared across the entire walk-forward loop. With multi-position support, cooldown only prevents entering 2 trades on the *same evaluation step*. But with STEP=2 and COOLDOWN=3, you can still enter a new trade just 2 bars after the last one — on the same ticker. This creates trade stacking where positions overlap heavily.

**Fix**: Track cooldown per-ticker when running multi-ticker backtests. For single-ticker, enforce that no new position opens if an identical-direction position is already open.

## Bug 3: No Minimum Conviction Filter

The `buyThreshold` and `shortThreshold` from config are used (line 768-769), but the default thresholds are very low. Combined with relaxed 3/4 conditions and no confirmation, the system enters on marginal signals with conviction barely above zero.

**Fix**: Add a hard floor: skip any signal with `cappedConviction < 55`. This filters out the weakest ~30% of signals that drag down expectancy.

---

## Additional Tuning Changes

### STEP=2 is too aggressive
Every 2 bars = ~130 evaluations/year/ticker. With relaxed filters, this produces ~650 trades/year across 5 tickers. Increase STEP to 3 — still faster than the original 5 but reduces noise trades by ~33%.

### Duplicate-direction blocking
Don't open a second BUY on the same ticker if a BUY is already open. This prevents stacking identical bets.

### Cooldown increase
Increase COOLDOWN_BARS from 3 to 5 to space out entries.

---

## Summary of Changes

**File: `supabase/functions/backtest/index.ts`**

1. **Fix capital accounting** — subtract positionSize from capital on entry, add (positionSize + pnl) on exit. Equity = capital + sum of mark-to-market open positions.
2. **Block duplicate-direction trades** — check if a same-ticker, same-direction position is already open before entering.
3. **Add minimum conviction floor** — skip signals with conviction < 55 in `computeStrategySignal`.
4. **STEP = 3** (from 2), **COOLDOWN = 5** (from 3) — reduce overtrading while maintaining responsiveness.

**No frontend changes needed.**

## Expected Impact

| Metric | Current | Expected |
|--------|---------|----------|
| Trades (5 tickers, 25yr) | ~3,000 | ~800-1,200 |
| Capital accuracy | Inflated | Correct |
| Duplicate trades | Allowed | Blocked |
| Signal quality floor | None | Conviction ≥ 55 |

This won't make the strategy profitable — that requires a real edge. But it will make the backtest **honest** so you can actually trust the numbers.

