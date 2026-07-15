# Self-Improving Scanner / Autotrader — "Quant-Grade" Loop

Goal: build a nightly system that keeps getting statistically stronger, safer, and more adaptive — without GPUs, without overfitting, and with zero per-user cost until that user actually trades. Every layer follows one rule: **learn, quantify uncertainty about what you learned, and refuse to act on unreliable knowledge.**

## Big picture

```text
                     nightly (03:30 UTC)
  signal_outcomes ─► calibrate-weights ─► strategy_weights (global)
  + rejected_signals   │                     ├─ ensemble weights + calibrator
  + partial-exit stats │                     ├─ regime probabilities
  + feature snapshots  │                     ├─ interaction weights
                       │                     ├─ feature importances + CIs
                       │                     ├─ edge half-lives
                       │                     └─ champion/challenger state
                       ├─► train-user-models ─► user_model_state
                       │   (Bayesian, shrunk toward archetype, then global)
                       ├─► train-meta-labeler (existing, extended)
                       ├─► drift-monitor  ─► drift_events (feature + concept)
                       ├─► model-health   ─► model_health_reports
                       └─► stress-test    ─► rejects/promotes challengers

  online: micro-Bayesian priors updated after every closed trade
  scanner: reads global + archetype + user layers, always with CIs
```

## Core learning layers

### A. Ensemble instead of a single model *(#1, #2, #24)*
Nightly train four cheap models on the same feature matrix from `signal_outcomes`:
- Logistic regression (linear main effects)
- Gaussian naive Bayes (independent effects, robust to sparsity)
- Ridge / linear SVM (margin-based linear)
- Depth-3 decision tree (small interactions)

Combine by **stacked meta-learner** (tiny logistic over the four probabilities) whose weights themselves are learned per market regime — so momentum-friendly regimes lean on the tree, mean-reverting regimes lean on NB, etc. Final probability is post-processed by **isotonic regression + Platt scaling** so "72% confidence" empirically wins 72% of the time. All coefficients stored as JSON in `strategy_weights.notes.ensemble`.

### B. Separate Entry / Exit / Sizing specialists *(#10, #11, #22)*
Three models trained on the same rows but different targets:
- **Entry model** → P(trade profitable | features at open)
- **Exit model** → learns from `MFE / MAE / exit_efficiency` (needs new columns on `signal_outcomes`) whether current trail multiples are too tight/loose per strategy×regime
- **Sizing model** → `finalKelly = engineKelly × userScalar × volScalar × calibratedConfidence` — Kelly shrinks with predictive-variance, not just point estimate

### C. Feature engineering with statistical guardrails *(#5, #6, #7, #8, #33)*
- Auto-generate candidate features nightly: rolling z-scores, ATR×RSI, RSI×trend, sector-momentum×regime, vol×earnings-proximity, multi-timeframe confirms.
- Bucket nonlinear features (ATR into 0–1/1–2/2–3/3–5/5+) so we don't force a straight line through obvious curvature.
- Every weight persisted with `{ mean, variance, sample_size, ci95_lo, ci95_hi }`. Scanner scales the applied nudge by `1 − relative_ci_width` — reliable weights fire fully, wide-CI weights barely move conviction.
- Monthly permutation-importance + mutual-information pass drops features whose IG ≈ 0; new candidates are promoted only after two consecutive months of positive out-of-sample lift.

### D. Regime as a probability, not a label *(#3)*
`regime-detector` returns `{ bull_quiet, bull_volatile, bear_quiet, bear_volatile, neutral }` softmax probabilities. Every tilt, floor, and exit multiplier is applied as `Σ regime_p × per-regime-value`. Removes cliff effects on regime flips.

### E. Rejected-signal learning *(#9)*
New table `rejected_signals` writes every candidate the scanner *considered* but filtered (with all features + reason). Nightly job labels rejects with the counterfactual: what price did the ticker do over the strategy's typical horizon? Feeds back into the entry model as negative/positive-with-cost labels. Massively expands training data without any trading.

## Personalisation with real statistics

### F. Dynamic Bayesian shrinkage *(#4, #23, #27)*
Shrinkage constant is no longer a fixed `k=30`. It's
`k = base × (1 + consistencyStdDev / meanEdge)` — noisy users shrink harder, consistent users unlock personalisation faster. Cold-start users inherit from their **archetype cluster** (K-means on account size, risk tolerance, style filter, first-week behaviour). Optional **federated aggregation**: only per-user *gradient means* (not trades) contribute to the global model — privacy-preserving global lift.

### G. Online micro-updates between nightly retrains *(#12)*
After every closed trade, a Beta-Binomial posterior on the user's per-strategy win-rate updates in <1 ms. No retraining — just posterior maths. Calibration stays current between 03:30 UTC runs.

## Safe deployment

### H. Champion / Challenger + auto-rollback *(#13, #14, #34, #35)*
Every new nightly model is a **challenger**. It "paper-trades" the next session in shadow mode (signals computed and logged, never executed). Only after `n` shadow days with better calibrated log-loss AND non-inferior Sharpe does it promote to champion. If live calibration error jumps > threshold post-promotion, auto-rollback to previous champion. Everything **versioned** in `model_versions` (id, training window, feature list, hyperparams, validation metrics, deploy ts) so any trade is reproducible.

### I. Stress-test gate *(#34)*
Before promotion, replay challenger through canned regimes (2020 crash, 2022 bear, 2017 low-vol, earnings-heavy weeks) using the existing bar cache. Reject if it only shines in one environment.

## Monitoring & self-healing

### J. Drift detection (feature + concept) *(#15, #16, #18, #32)*
- **Feature drift:** nightly PSI + KL between today's 30-day feature dists and the 90-day baseline.
- **Concept drift:** Jensen-Shannon on predicted-probability distribution vs realised outcomes. Extends existing ADWIN.
- **Adaptive decay:** exponential time-weight `e^(−days/λ)` with λ shortening automatically when drift is high (forget faster in fast markets).
- Per-strategy **edge half-life** estimated from rolling Sharpe decay curves; short-half-life strategies get down-weighted.

### K. Strategy retirement *(#31)*
Every strategy tracked; auto-deactivated when 300+ trades show negative expectancy at 95% confidence. Automatically re-enabled if a rolling window recovers.

### L. Anomaly & data-quality guard *(#28)*
Pre-training pass rejects rows with impossible returns, duplicate trades, bad fills, stale bars, or feature outliers > 6σ. Garbage-in blocked before it corrupts weights.

### M. Model Health Report *(#25, #30)*
Nightly written to `model_health_reports` and rendered on a new Settings → "Engine Health" tab: calibration error, feature drift, concept drift, top/bottom features by lift, deployment status, rollback status, training time, per-signal **score decomposition** ("+4 trend, +2 sector, −1 ATR, +3 momentum → 81"). Every live signal card gets a "why" popover from this.

## Optimisation & exploration

### N. Bayesian threshold optimisation *(#20, #29)*
Replaces grid search on `minConviction / trailMult / heatCap` with Gaussian-Process BO. Objective is **multi-objective**: weighted stack of Sharpe, Sortino, Calmar, MaxDD, Profit Factor, Expectancy, turnover — not Sharpe alone.

### O. Adaptive exploration *(#26)*
2–5% of autotrader budget reserved for *below-threshold* signals (ε-greedy with UCB bonus for under-sampled feature regions). Prevents the model from only reinforcing what it already believes; discovers new edges.

### P. Portfolio-aware learning *(#21)*
Entry model consumes live portfolio context (current correlation-to-book, sector exposure, factor beta, portfolio heat) as features. Great standalone signals can be rejected when they'd concentrate risk.

## Market memory *(#17, #19)*
Long-term `market_memory` table keeps years of `{features, outcome, regime probs, macro snapshot, VIX, rates, oil, earnings season flag, election year}`. Enables walk-forward retraining (train/validate/test never overlap) and lets us answer "what worked in high-rate bear markets?" — that historical replay powers the stress-test gate too.

## Rollout — six shippable milestones

1. **Foundations.** New columns on `signal_outcomes` (MFE/MAE/exit_efficiency), `rejected_signals` + `model_versions` + `model_health_reports` tables (with GRANTs + RLS), feature-snapshot writer in scanner. No behaviour change.
2. **Ensemble + calibration + regime probabilities.** Extend `calibrate-weights` to train the 4-model stack + isotonic/Platt + soft regime probs. Scanner reads soft weights. Ship with CIs on every stored weight.
3. **Per-user layer + archetypes + online Beta-Binomial.** `train-user-models`, dynamic shrinkage, cold-start via archetype cluster.
4. **Rejected-signal learning + interaction features + auto feature selection.** Feature drift monitor lit up. Adaptive decay λ live.
5. **Champion/Challenger, stress-test, auto-rollback, versioning.** Nothing promotes without shadow-days + regime replay.
6. **Engine Health dashboard + score decomposition popover + strategy retirement + adaptive exploration + Bayesian threshold search.** User-visible transparency and self-tuning close the loop.

## Explicit non-goals
No neural nets, no GPU inference, no per-bar online retraining, no per-ticker deep models (ticker calibration stays a Bayesian-shrunk scalar), no trading against user equity curves. Backtester math stays deterministic — all new learning is consumed at scan time so backtests remain reproducible.

## Cost profile
Everything is closed-form or small-matrix. Four tiny models × ~5k rows × plain-JS gradient descent ≈ 1–2 s. Per-user fits are ~50 ms and only run for users with ≥5 closed trades. One new nightly cron beyond current + one extension of `calibrate-weights`. No new external APIs. Storage grows linearly with trade volume, not with users.
