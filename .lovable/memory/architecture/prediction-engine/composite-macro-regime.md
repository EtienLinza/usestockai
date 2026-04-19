---
name: composite-macro-regime
description: Phase D macro regime score replacing binary SPY-200SMA with SPY trend + VIX + breadth (RSP/SPY) + HYG/LQD credit; scales conviction floor dynamically
type: feature
---
Phase D of the adaptive trading architecture: composite macro regime layer.

## What changed
The market scanner previously gated shorts on a single binary check (`SPY < 200-SMA = bearish`). It now computes a **0–100 composite regime score** from four equally-weighted sub-components, each fetched in parallel:

1. **Trend (0–100)** — SPY price vs 50/200 SMA + 20-bar slope of the 200-SMA
2. **Volatility (0–100)** — VIX level (12 → 100, 40+ → 0, linear in between)
3. **Breadth (0–100)** — RSP (equal-weight S&P) 60d return minus SPY 60d return; positive diff = healthy breadth
4. **Credit (0–100)** — 60d slope of HYG/LQD ratio; rising = risk-on

Score → label: `risk_off` (≤40), `neutral` (41–64), `risk_on` (≥65). The label is also returned in the `/market-scanner` response and stored in `spyContext` for cross-batch reuse.

## How conviction floors use it
For each candidate signal:
```
adaptiveFloor = regime_floors[regime].floor (Phase B) ?? baselineFloor
macroAdj      = macroFloorAdjust(macro.score)  // -5 to +12
minConviction = clamp(adaptiveFloor + macroAdj, 50, 90)
```
- `risk_off` adds **+8 to +12** points to the floor (require stronger setups).
- `neutral` is roughly flat.
- `risk_on` subtracts **−3 to −5** points (allow more signals).

## Short-gate change
`spyBearish` (which gates the `weeklyBias.bias === "short"` path) is now `macro.score <= 40` instead of `SPY < 200-SMA`. This avoids whip-sawing in/out of bear mode just because price tags the 200-SMA on a single bar.

## Implementation notes
- All five tickers (SPY, ^VIX, HYG, LQD, RSP) are fetched in `Promise.all`, so the macro layer adds ~1 round-trip of latency only on batch 0.
- Macro context is computed once on batch 0 and propagated through `body.spyContext.macro`. Both `spyContext.spyClose` and `spyContext.macro.spyClose` are sliced to the last 30 bars before being returned to keep the cross-batch payload small.
- If any data source fails, the relevant sub-score defaults to 50 (neutral) and a note is appended explaining the fallback.
