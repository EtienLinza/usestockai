---
name: Cross-sectional rank gate, rejection learning, exit meta-labeler
description: Relative top-slice entry gate, nightly rejection audit that can LOOSEN gates, and empirical exit recovery-odds grid
type: feature
---

## 1. Cross-sectional rank gate (`_shared/cross-sectional-rank.ts`)
Applied in `scan-orchestrator` after workers return. Keeps only the top slice of
the day's candidate distribution: `topPct 0.15`, `minKeep 5`, `maxKeep 40`,
`hardFloor 55`. Rank score = conviction × (1 + 0.35·(meta−0.5)·2); null meta is
a pass-through. Dropped names are logged to `rejected_signals` with reason
`below_cross_sectional_rank`, so they feed the counterfactual loop.

## 2. Rejection learning (`evaluate-rejections`, `_shared/gate-adjustments.ts`)
Nightly at 05:05 UTC. Groups labeled rejections (90d) by reason into
`rejection_accuracy`, then writes clamped per-gate deltas into
`gate_adjustments`. Verdict `too_strict` when would-win ≥ 58% and avg return
≥ +0.5% on ≥25 samples. Deltas move one step per night and are clamped in the
row AND in the resolver.

Gates wired: `conviction_floor` (scan-worker min conviction, ±5),
`earnings_blackout_days` (autotrader, −1/+2 around 3), `correlation_threshold`
(autotrader, ±0.10). **This is the only loop that can make filters looser** —
every other loop trains on trades we took and can only tighten.

## 3. Exit meta-labeler (`_shared/exit-meta.ts`, `train-exit-meta`)
Nightly at 05:15 UTC. Empirical grid over (peak excursion %, fraction of peak
given back) → share of historical trades that still finished green. Live exit
pass fires `FULL_EXIT` when giveback ≥ 50% and cell P(win) < 0.35 with ≥20
samples. Known accepted bias: grid uses terminal give-back, a loser-skewed
subset, hence the conservative threshold.

## Bug fixed alongside
`label-rejected-signals` used `MIN_AGE_DAYS = 8` with a 10-bar horizon and
marked rows `labeled_at` even when the forward window didn't exist — 210 rows
were permanently unpriceable. Now `MIN_AGE_DAYS = 20`, skips never set
`labeled_at`, and rows are abandoned only after 60 days.
