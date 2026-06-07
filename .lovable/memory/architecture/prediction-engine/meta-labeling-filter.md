---
name: Meta-Labeling Filter
description: Lopez-de-Prado secondary classifier — logistic regression over persisted features predicts P(this signal is profitable); retrained nightly
type: feature
---
**Architecture:**
- `train-meta-labeler` cron edge function (02:30 UTC nightly) pulls last 180d of closed `signal_outcomes`, fits logistic regression via plain-JS gradient descent (no deps), writes coefficients + standardization params to `meta_label_model`.
- `_shared/meta-labeler.ts` exposes `loadLatestMetaModel()` + `scoreMetaLabel()` + `metaLabelDecision()`.
- `autotrader-scan` loads model once per scan, scores each candidate, applies a 3-tier gate:
  - `score < 0.30` → HARD SKIP
  - `score < 0.45 AND conviction < 80` → DEMOTE (consensus-only, no autotrade)
  - otherwise → PASS

**Features (11):** conviction, atr_pct, rel_strength, sector_momentum, eps_revision_score, regime_one_hot ×4, hour_of_day, day_of_week.

**Cold-start safety:**
- Trainer exits early when n < 40 or labels degenerate (pos < 5 or pos > n−5).
- Loader returns null when no row exists → runtime decision is always PASS.
- Persisted to `live_signals.meta_score` + `signal_outcomes.meta_score` + `contributing_rules.meta_score` for closed-loop calibration.

**Why NOT in the signal engine:** filtering lives in autotrader-scan (risk layer) so the backtest stays deterministic. Pure signal math is unchanged.
