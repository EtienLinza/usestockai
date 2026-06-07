---
name: realKelly Sizing Wiring
description: Closes H-6 audit gap — strategy-bucketed realized edges feed evaluateSignal → computePositionSize for true fractional Kelly when n≥30
type: feature
---
**Audit gap (H-6):** `realKelly()` existed in `signal-engine-v2.ts` but was never called from the autotrader because no realized edge was ever passed. Sizing always fell through to the cold-start conviction ramp.

**Wiring (autotrader-scan, once per scan):**
1. Pull last 180d of closed `signal_outcomes` grouped by strategy.
2. Compute `{ winRate, avgWin, avgLoss, sampleSize }` per strategy.
3. Pass via new optional 10th arg `realizedEdge` into `evaluateSignal`, which forwards to `computePositionSize`.
4. `computePositionSize` switches from `0.10 + (conv−60)/40 × 0.15` ramp to true fractional Kelly `f* = (p·b − (1−p)) / b` when `sampleSize ≥ 30 AND avgWin > 0 AND avgLoss > 0`. Quarter-Kelly, capped at 0.20.

**Stacking order (unchanged):** evaluateSignal → kellyFraction → ×volScalar → min(single_name_pct, headroom, heat_cap, sector_cap).

**Reasoning string** appends `| realKelly(n=<sample>)` when the path is active, so log audits can verify which sizing branch ran.
