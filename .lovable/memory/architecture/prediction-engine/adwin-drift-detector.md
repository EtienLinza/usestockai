---
name: ADWIN Drift Detector
description: Bifet-Gavaldà adaptive windowing flags concept drift in live hit-rate; auto-tightens the meta-label gate when the model is stale before its next nightly retrain
type: feature
---
**Module:** `_shared/adwin.ts` exports `detectAdwinDrift`, `adwinGateAdjust`.

**Algorithm:** stateless O(n) scan of binary-outcome series. For each candidate split `k ∈ [20, n-20]`, compare `|mean(0..k) - mean(k..n)|` to the Hoeffding bound `ε = √((1/2m) · ln(2n/δ))` at `δ = 0.05`. Drift fires when any split exceeds ε; severity is "hard" when the mean gap is ≥ 15 pp, else "soft".

**Wiring (autotrader-scan):**
1. At scan start, fetch last ~200 closed `signal_outcomes` (binary hit = `realized_pnl_pct > 0`).
2. Run ADWIN; on drift, INSERT into `drift_events(detected_at, window_size, pre_mean, post_mean, severity)`.
3. Map severity → meta-label thresholds via `adwinGateAdjust`:
   - none → PASS≥0.45, SKIP<0.30 (defaults)
   - soft → PASS≥0.55, SKIP<0.40
   - hard → PASS≥0.60, SKIP<0.45
4. Use the adjusted thresholds inside the existing meta-label gate in `runEntryDecision`.

**UI:** A small chip on `TradingTab` near the regime badge surfaces the most-recent unack'd drift event (severity + pre/post hit-rate).

**Trainer integration:** `train-meta-labeler` reads recent `drift_events` and tilts the time-decay weights to ×3 (vs default ×2) on the most-recent 30-day window when drift was flagged inside that window — speeds adaptation post-shock.

**Cold-start safety:** Returns `severity='none'` when window < 40 obs.
