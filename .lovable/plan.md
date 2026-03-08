

# Fix Remaining Issues + Run 2000–2025 Backtests

## Problems Still Present

1. **Layer 3 Adaptive Bonus (+15) overrides conviction caps** — A stock in its own uptrend gets +15 conviction on every BUY, pushing weak signals past the threshold. This is why confidence still clusters at 90-100.

2. **MR is gated by ADX < threshold (binary)** — MR only fires when `adxVal < ADX_THRESH`. Most of the time ADX is 25-40, so MR never activates even for value/cyclical stocks. RSI extremes should be able to trigger MR regardless of ADX.

## Fixes (`supabase/functions/backtest/index.ts`)

### Fix 1: Cap Layer 3 Adaptive Conviction Bonus (lines ~659-665)
- Reduce the adaptive bonus from `+15` to `+8` for both BUY and SHORT
- This keeps the "own trend" signal useful without letting it dominate

### Fix 2: Allow MR to Fire on RSI Extremes Regardless of ADX (lines ~539-577)
- Change the MR gate from `if (adxVal < ADX_THRESH)` to:
  - `if (adxVal < ADX_THRESH || rsiVal < RSI_OS || rsiVal > RSI_OB)`
- When ADX is above threshold but RSI is extreme, MR can still activate — but with a conviction penalty (×0.8) since the trend environment is less favorable for mean reversion
- This ensures cyclical stocks get MR trades during strong moves that overshoot

### Fix 3: Run Backtests
- After deploying, run backtests for **XOM**, **MSFT**, and **JPM** from **2000 to 2025**
- Check classification stability, MR trade count, conviction distribution, and overall returns

## Expected Impact
- Conviction scores should max out around 80-85 instead of 95-100
- MR trades should increase from 1-2 to 10-20+ per stock over 25 years
- Cyclical stocks (XOM, JPM) should show improved returns from better strategy mix

