

# Why Nothing You Change Makes a Difference — 3 Structural Bugs

## The Smoking Gun

12 runs, same stocks, different parameters → always **932 trades, ~43% win rate, Sharpe -0.28**. The trade count is identical every time. This proves: **your parameter changes never reach the signal engine.**

## Bug 1: Thresholds Do Nothing (Root Cause of Identical Results)

The frontend sends `stopLoss`, `takeProfit`, `positionSize` — these only affect exits and sizing. It does NOT send `buyThreshold` or `shortThreshold`, so the edge function uses defaults (30 / -30).

But here's the real problem: even if it did, it wouldn't matter. The conviction formula **always** produces scores above 55:

- Trend: `55 + (adxVal-25)*0.8 + abs(macdH)*10 + score*5` → minimum ~70
- Breakout: `55 + volRatio*10 + ...` → minimum ~65

`consensusScore` equals `±cappedConviction`, so BUY signals always have consensus > 55, which is always > `buyThreshold` (30). SHORT signals always have consensus < -55, always < `shortThreshold` (-30).

**Every single signal that `computeStrategySignal` generates automatically passes the threshold check.** The thresholds are decorative.

Similarly, `signal.confidence < 55` filter on line 779 uses the `confidence` field (which is `50 + cappedConviction * 0.35` → always ≥ 75), so it never filters anything either.

## Bug 2: Per-Ticker Capital Is Wrong

Line 1645: each ticker runs `runWalkForwardBacktest` with `config.initialCapital = $100K`. With 4 tickers, each independently trades with $100K — that's $400K of effective capital. The equity curve is then scaled down by `capitalPerTicker`, but position sizing inside each run uses the full $100K. This means each ticker is sizing positions 4x too large relative to its actual capital allocation.

## Bug 3: The Signal Engine Is Entirely Hardcoded

All indicator periods (14-day RSI, 12/26 EMA, 20-day BB, etc.), strategy conditions (ADX > 25, RSI < 30, etc.), and regime thresholds are hardcoded constants. No user parameter affects signal generation. The only variable is price data. Same stocks → same signals → same 932 trades, every time.

---

## The Fix — `supabase/functions/backtest/index.ts`

### Fix 1: Make thresholds actually work
- Change `buyThreshold`/`shortThreshold` to work as **conviction** thresholds, not consensus thresholds
- Pass them into `computeStrategySignal` and filter: `if (cappedConviction < buyThreshold) return HOLD`
- Default `buyThreshold` to 60 (meaningful filter) instead of 30

### Fix 2: Fix per-ticker capital
- Pass `initialCapital / numTickers` to each ticker's `runWalkForwardBacktest` call instead of full `initialCapital`
- This fixes position sizing to match actual capital allocation

### Fix 3: Make key parameters configurable from frontend
Add these to `BacktestConfig` and the request body with sensible defaults:
- `adxThreshold` (default 25) — controls trend vs MR regime switch
- `rsiOversold` / `rsiOverbought` (default 30/70) — MR entry thresholds
- `trailingStopATRMult` (default 2.0) — trailing stop distance
- `maxHoldBars` (default 20) — trend holding period

### Fix 4: Fix the confidence filter
The `signal.confidence` field is calculated *after* conviction and uses a different formula that inflates everything to 75+. Change line 779 to filter on `cappedConviction` (the raw signal strength) instead of `signal.confidence`.

## Frontend Change — `src/pages/Backtest.tsx`

Add UI controls for the new configurable parameters (ADX threshold, RSI levels, trailing stop multiplier, max hold bars) and send them in the request body. This way when you change parameters, you'll actually see different results.

## Expected Impact

| Before | After |
|--------|-------|
| 932 trades every run | Trade count varies with parameters |
| Params have no effect | Each param directly affects signals |
| 4x overcapitalized | Correct per-ticker sizing |
| Win rate always ~43% | Varies with parameter tuning |

