---
name: Audit fixes H-7 & M-9
description: Legacy positions get synthesized hard stops; HYG/LQD credit ratio aligns by timestamp
type: feature
---

## H-7 — Legacy positions without `hard_stop_price`
Added `inferInitRiskPerShare(pos)` and `inferHardStopPrice(pos)` helpers in `autotrader-scan/index.ts`. Both fall back from `hard_stop_price` → `entry_atr × {2.0 trend / 1.75 breakout / 1.5 MR}` → `entry × 5%`. Used by:
- `runWinExit` R-ladder (rungs +1R / +2R + breakeven trail)
- `runLossExit` T1 hard stop (synthesized stop fires with `[synthesized]` tag in reason)
- `runLossExit` T2.5 R-progress stall time-stop

Previously, any legacy/null-stop position silently skipped R-ladder partial exits and R-progress stall detection.

## M-9 — HYG/LQD timestamp alignment
Both `scan-pipeline.ts` and `market-scanner/index.ts` now intersect HYG and LQD by `timestamps[]` before computing the ratio series. Index-pair (`Math.min(len)`) silently paired different dates whenever one ETF had a missing/extra bar, distorting the 60-day credit-spread slope that feeds the macro `credit` sub-score.
