---
name: Rejected Signals Loop (M4)
description: Counterfactual labeling of filtered candidates + PSI/ADWIN drift detection nightly
type: feature
---
scan-worker returns `rejected[]` with feature_snapshot for every candidate filtered at
earnings-blackout, gap gates, and conviction-floor gates. scan-orchestrator inserts up to
400 sampled rows/scan into `rejected_signals` with scan_run_id.

Nightly crons (need to be registered when DB is reachable):
- `label-rejected-signals` 04:35 UTC → fills counterfactual_return_pct/hit_target/hit_stop
  from Yahoo bars using entry_price + ATR ladder.
- `detect-drift` 04:55 UTC → PSI on 6 numeric features (recent 30d vs baseline 180d) and
  ADWIN on daily win-rate series. Writes to `drift_detections`.
