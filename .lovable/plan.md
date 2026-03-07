

# Fix Risk Management: 5 Changes to Turn Positive Expectancy into Positive CAGR

## Diagnosis Summary
The signal quality is good (PF 1.37, positive expectancy). The system is bleeding money through oversized positions, uncapped tail losses, and shorting into bull markets. All fixes target risk management, not signal logic.

## Changes

### File: `supabase/functions/backtest/index.ts`

**Fix 1 — Hard 8% Loss Cap (lines ~737-743)**
Currently the hard stop is `max(stopLossPct/100, 3*ATR%)` which in 2008/2020 volatility = 15-20%. Add an absolute ceiling:
```
effectiveStopPct = Math.min(effectiveStopPct, 0.08); // Never risk more than 8%
```
After the bear-regime widening on line ~879, cap again at 8%. This prevents the -14%, -20% tail losses that destroy compounding.

**Fix 2 — Disable Shorts When SPY > 200 SMA**
The walk-forward engine currently has no access to SPY data. Changes:
- Pass `spyData` into `runWalkForwardBacktest` as an optional parameter
- Before opening a SHORT, check if SPY is above its 200 SMA on the current date. If yes, skip the short.
- This requires building a date→index map for SPY timestamps inside the walk-forward loop.
- This alone should eliminate most of the large short-side losses during 2010-2021.

**Fix 3 — Risk-Based Position Sizing (lines ~882-885)**
Replace the current `capital * positionSizePct%` with risk-based sizing:
```
riskPerTrade = 0.01  // 1% of capital at risk
stopDistance = effectiveStopPct (already computed)
positionSize = min(capital * riskPerTrade / stopDistance, capital * 0.25)
```
Cap at 25% of capital per position. This means:
- 5% stop → 20% position size
- 8% stop → 12.5% position size  
- Tight stops get bigger positions, wide stops get smaller — exactly what you want.
- Remove the volatility-based `positionSizeMultiplier` scaling since risk-based sizing already adapts.

**Fix 4 — Reduce Default Max Positions**
Backend default `maxPositions`: 5 → 3. This prevents overexposure when running multiple tickers.

**Fix 5 — Default Thresholds Already at 2 ATR**
`trailingStopATRMult` is already 2.0. The hard stop uses `3*ATR` for trend — change to `2*ATR`:
```
effectiveStopPct = Math.max(config.stopLossPct / 100, 2 * atrPct)  // was 3
```

### File: `src/pages/Backtest.tsx`
- Update `positionSize` default from 10 to show "Risk %" label (cosmetic, since backend now uses risk-based sizing)
- Add a `riskPerTrade` state (default 1%) and send it to backend
- Update `stopLoss` default label to clarify it's a max cap

### Summary of Expected Impact

| Fix | What Changes | Expected Effect |
|-----|-------------|-----------------|
| 8% loss cap | No trade loses > 8% | Cuts max DD from 53% to ~25% |
| No shorts in SPY bull | Eliminates 40%+ of losing shorts | Removes biggest PnL drag |
| Risk-based sizing | 1% risk per trade | Consistent risk, smaller drawdowns |
| Max 3 positions | Less concurrent exposure | Smoother equity curve |
| 2 ATR stops | Tighter trend stops | Faster loss cutting |

