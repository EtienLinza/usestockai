# Self-Improving Engine v2 — the engine learns, not just the gauge

## The problem
The nightly loop calibrates the *gauge* (conviction → win-rate, strategy tilts, regime floors, trail multiplier, per-ticker Bayesian shrink) but never improves the *engine* — the indicator thresholds that decide whether a setup fires at all. `PROFILE_PARAMS` (RSI oversold/overbought, ADX threshold, take-profit %, trailing-stop ATR mult, buy/short thresholds) are static hand-tuned constants. Separately, the 4-model ensemble champion is trained, shadow-scored, and promoted to champion — then never consulted at entry time. The live filter uses a single simple logistic regression instead.

Two verified facts make this cheap to build:
1. `evaluateSignal()` already accepts `paramOverrides?: Partial<ProfileParams>` (signal-engine-v2.ts:1203) and merges them (line 1226). The autotrader just passes `undefined` today.
2. The ensemble champion's coefficients are portable JSON in `model_versions.coefficients`.

## What we build (4 workstreams, sequenced by leverage)

### WS1 — Wire the ensemble champion live  *(quick win, uses an already-trained model)*
**Goal:** the entry meta-filter uses the best model, not the toy logistic.
- Add `predictEnsemble(model: EnsembleModel, features: Record<string, number>, regime?)` to `_shared/ensemble.ts` (standardize features → 4 base models → stacked meta → isotonic → Platt).
- Add `loadChampionEnsemble()` (reads latest `status='champion'` row from `model_versions`, parses `coefficients` into `EnsembleModel`). Falls back to null when no champion.
- In `autotrader-scan` entry: load champion ensemble, build the same `feature_snapshot` the trainer uses, score it, and **blend** with the existing `scoreMetaLabel` output: `metaScore = 0.7 * ensembleScore + 0.3 * simpleMeta` when both exist; ensemble-only when no simple model; simple-only when no champion (cold start).
- Keep the existing gate thresholds (skip <0.30, demote <0.45 + conv<80). The champion/challenger promotion already gates which model is "champion" — that *is* the safety layer.

### WS2 — Adaptive signal thresholds  *(the engine genuinely gets smarter)*
**Goal:** the nightly loop tunes the engine's own indicator thresholds per profile × regime, not just conviction.
- **Nightly `calibrate-weights` extension:** for each (profile × regime) cell with ≥ N samples, compute tuned values:
  - `rsiOversold` / `rsiOverbought` — from the RSI distribution of winning vs losing entries
  - `adxThreshold` — from ADX distribution at winning entries
  - `buyThreshold` / `shortThreshold` — from conviction-vs-outcome curve per profile
  - `takeProfitPct` / `trailingStopATRMult` / `hardStopATRMult` — from MFE/MAE excursion data (already collected)
- **Safety layer 1 (Bayesian shrinkage + decay):** every tuned value shrinks toward the current static `PROFILE_PARAMS` default with prior strength ~30 equivalent trades, and uses the existing time-decay weights (recent trades dominate). Never moves more than ±20% from the static default per cycle.
- **Safety layer 2 (walk-forward champion gate):** a candidate param set must beat the incumbent on a held-out forward window (last 20% of the 90-day sample, stratified by regime) on log-loss before going live — same champion/challenger discipline as WS1. Losers stay at the incumbent; ties go to the incumbent (regret minimization).
- **Storage:** add `signal_params JSONB` column to `strategy_weights` holding `{ profile: { regime: Partial<ProfileParams> } }`. Version the history so we can audit/rollback.
- **Live wiring:** autotrader loads `signal_params` alongside the existing `strategy_weights` fetch, picks the row for the current profile × regime, and passes it as the 6th arg (`paramOverrides`) to `evaluateSignal`. No engine change.
- **Exit params** (`takeProfitPct`/`trailingStopATRMult`/`hardStopATRMult`) flow into the `ProfileParams` object the exit functions already consume — pass the merged profile to `runProfitExit`/`runLossExit` instead of the static one.
- **Backtest parity:** `backtest-sim.ts` loads the same `signal_params` so live and backtest stay identical (the core invariant).

### WS3 — Smarter adaptive exits  *(lose less, make more)*
**Goal:** exit calibration tunes more than the one trail multiplier.
- Extend `exit_calibration` in `calibrate-weights`:
  - `takeProfitCeilingMult` — if winners consistently hit the 1.5× ceiling and keep running (MFE >> realized), raise the ceiling; if they peak-and-reverse, lower it. Clamped [1.0×, 2.0×].
  - `hardStopATRMultAdjust` — from adverse-excursion distribution: names where losers consistently exceed the stop get tighter stops; names that whipsaw get wider. Clamped [0.7×, 1.3×].
  - `peakThreshold` — adapt the 3-of-5 peak-detection rule per strategy (mean-reversion exits faster, trend rides longer).
- Wire into `runProfitExit` / `runLossExit` via the existing `exitCalibration` load path (autotrader-scan already fetches it).

### WS4 — News sentiment into live entry
**Goal:** the existing `news-sentiment` function feeds the gate.
- In autotrader entry, batch-fetch sentiment scores for the watchlist (same pattern as danelfin/eps).
- Apply as a conviction delta: long `+sentimentScore * k`, short `-sentimentScore * k`, capped ±5, neutral when missing (never blocks — supporting factor only).

## Tuning safety model ("both layers")
- **Continuous Bayesian + decay** governs the conviction/sizing/calibration layer (already live) and the new threshold tuning within a cycle — shrinkage toward defaults, recent-weighted.
- **Walk-forward champion gate** governs *promotion* of a new threshold/param set to live: candidate must beat incumbent on held-out forward window on log-loss. This is the overfit guard the user flagged earlier.

## Order
WS1 first (uses a model already trained — fastest, biggest immediate "smarter" win). WS2 next (the real "engine learns" lever). WS3 + WS4 follow. All four share the `strategy_weights` nightly-run + champion/challenger infrastructure already built, so no new cron jobs.

## Non-goals
- No deep learning (user explicitly rejected — overfits to one stock, too heavy).
- No per-stock indicator models (one stock each) — tuning is per-profile×regime, shared across the universe.
- No new infrastructure — reuse `strategy_weights`, `model_versions`, `signal_outcomes`, the nightly cron, and the existing `paramOverrides` plumbing.
