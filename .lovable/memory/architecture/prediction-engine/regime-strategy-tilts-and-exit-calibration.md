---
name: Regime×Strategy Tilts + Exit Calibration
description: Phase B+ — calibrate-weights now writes 2D strategy×regime tilts and per-strategy trailing-stop multipliers learned from MFE-vs-realized capture
type: feature
---

`calibrate-weights` (nightly) now produces two extra adaptive outputs on top of the original `calibration_curve` / `strategy_tilts` / `regime_floors`:

1. **`notes.strategy_regime_tilts`** — `{ "<strategy>|<regime>": { multiplier, count, ... } }`. Multiplier band 0.80–1.20 (slightly wider than 1-D tilts since cells are narrower). Requires ≥10 closed trades per cell. Scanners (`scan-worker`, `market-scanner`) prefer the cell tilt; if missing or <10 samples, fall back to the 1-D `strategy_tilts[strategy]`.

2. **`exit_calibration`** column on `strategy_weights` — per-strategy `{ trailMultAdjust, captureRatio }`. Compares realized PnL to MFE for winning trades; capture ratio <0.45 → loosen trail (×1.0–1.4), 0.65–0.80 → keep, >0.80 → tighten (down to ×0.85). Requires ≥12 winning trades per strategy. Used by `autotrader-scan` to multiply `profile.trailingStopATRMult` for the position's `entry_strategy` before running `runWinExit` / `runLossExit`.

Both adjustments compound the existing adaptive loop without any new cron job — same nightly 03:30 UTC run.
