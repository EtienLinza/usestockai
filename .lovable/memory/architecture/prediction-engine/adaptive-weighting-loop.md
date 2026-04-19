---
name: Adaptive Weighting Loop (Phase B)
description: Nightly calibrate-weights job re-fits conviction curve, tilts strategies, and auto-tunes regime floors from signal_outcomes
type: feature
---

The `calibrate-weights` edge function runs nightly at 03:30 UTC (pg_cron job `calibrate-weights-nightly`). It reads closed `signal_outcomes` from the last 90 days and writes a new active row to `strategy_weights` with three adjustments the `market-scanner` reads on every batch:

1. **calibration_curve** — per conviction bucket (lt60/60-69/70-79/80-89/90-100), shifts raw conviction toward observed win rate, capped at ±8 points. Requires ≥10 samples per bucket.
2. **strategy_tilts** — per-strategy multiplier (0.85–1.15×) from blended winRate-z + return-z vs universe baseline. Requires ≥15 samples.
3. **regime_floors** — per-regime conviction floor (clamped 55–80) chosen as the lowest conviction where the remaining cohort wins ≥55% of the time. Brutal regimes (<40% overall WR) auto-raise to ≥75. Requires ≥20 samples per regime.

Scanner applies them in this order: tilt × raw conviction → calibration adjust → regime floor gate. With no `strategy_weights` row, scanner falls back to neutral 1.0× / static floor 65 (60 for mean-reversion/divergence). Calibration page displays the live row plus a manual "Recalibrate" button.
