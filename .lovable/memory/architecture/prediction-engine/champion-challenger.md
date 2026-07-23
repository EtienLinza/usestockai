---
name: Champion/Challenger + Auto-Rollback (M5)
description: manage-models nightly runs shadow scoring, market_memory stress test, promotion, auto-rollback, and writes model_health_reports
type: feature
---

`manage-models` (05:15 UTC nightly) drives the Champion/Challenger lifecycle for `model_versions`:

1. **Shadow scoring** — every open challenger is replayed over the last 14d of closed `signal_outcomes` whose `exit_date` is strictly after the challenger's `training_window_end`. Metrics (logLoss, brier, accuracy, bucketed calibration error) are written to `model_versions.shadow_metrics`.
2. **Stress test** — challenger is replayed over `market_memory` bucketed by dominant regime. Fails if any regime bucket with n≥100 has `logLoss > champion_holdout_logLoss × 1.10`. Written to `stress_test_results`.
3. **Promotion** — a challenger promotes when: age ≥ 3 shadow days, shadow logLoss improves champion by ≥ 0.005, stress-test passes. On promote: old champion → `retired`, new gets `deployed_at`, sibling challengers of same kind retire.
4. **Auto-rollback** — current champion is re-scored on post-deploy closed outcomes; if live `calibError − holdout calibError > 0.20`, champion is retired and the most recent retired predecessor of the same `model_kind` is restored.
5. **Engine Health** — writes daily row to `model_health_reports` (logLoss/brier/calibration + drift snapshot + promotions/rollbacks + training time).

Champion uniqueness is enforced by partial unique index `model_versions_one_champion_per_kind`. `calibrate-weights` was writing the wrong training-window column (silently dropping every challenger); it now writes `training_window_start/end` correctly. Scanner integration (reading champion coefficients live) is a downstream hook — coefficients live entirely in `model_versions.coefficients`.
