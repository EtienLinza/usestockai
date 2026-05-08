---
name: Adaptive Calibration Suite (Phase B+)
description: Nightly calibrate-weights now produces walk-forward weighted aggregates plus per-ticker, per-strategy×regime, and exit-trail calibration in addition to the original strategy_tilts/regime_floors
type: feature
---

`calibrate-weights` (nightly 03:30 UTC) now produces five adaptive outputs in a single run, all computed from the same 90-day `signal_outcomes` window with **walk-forward time decay** (recent 30d ×2.0, 30–60d ×1.5, 60–90d ×1.0):

1. **`calibration_curve`** — global per-conviction-bucket adjust (±8 pts)
2. **`strategy_tilts`** — 1-D per-strategy multiplier (0.85–1.15×)
3. **`notes.strategy_regime_tilts`** — 2-D `"<strategy>|<regime>"` multiplier (0.80–1.20×, ≥10 samples per cell). Scanners (`scan-worker`, `market-scanner`) prefer the cell tilt and fall back to the 1-D tilt when undersampled.
4. **`exit_calibration`** column — per-strategy `{ trailMultAdjust, captureRatio }`. Compares realized PnL to MFE for winners; capture <0.45 → loosen trail (×1.0–1.4), 0.65–0.80 → keep, >0.80 → tighten (down to ×0.85). Used by `autotrader-scan` to scale `profile.trailingStopATRMult`.
5. **`ticker_calibration`** column — per-ticker conviction adjust (±6 pts) with **Bayesian shrinkage** toward the global curve: `adjust = (n / (n + 30)) × (actualWR − expectedWR) × 0.6`. Requires ≥8 trades per ticker. Applied **after** the global bucket adjust in both `scan-worker` and `market-scanner`.

All aggregates use weighted counts; `MIN_SAMPLES_*` gates still use raw counts so we don't act on cells of <10 actual trades. Walk-forward weighting means a regime shift is reflected in tilts within ~30 days instead of being averaged away over the full 90-day window.
