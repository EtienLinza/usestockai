---
name: Per-User Bayesian Layer (M3)
description: Nightly train-user-models job fits per-user sizing scalar, filter threshold, strategy/regime bias, and Beta-Binomial priors with dynamic shrinkage; cold-start via 4-archetype centroids.
type: feature
---

`train-user-models` runs nightly at 03:50 UTC (20 min after `calibrate-weights`). Reads closed `virtual_positions` for the last 180d and produces one `user_model_state` row per user with:

- **sizing_scalar** (0.5–1.5) — shrunk `1 + 0.15·tanh(sharpe-ish)` toward archetype default
- **filter_threshold** (55–85) — shrunk `median winning-trade conviction − 4pt buffer`
- **strategy_bias** — per-strategy WR delta vs global, clipped ±0.20
- **regime_bias** — per-regime WR delta vs global, clipped ±0.15
- **beta_binomial_priors** — Beta(1+wins, 1+losses) per strategy for online updates
- **shrinkage_k** — dynamic `30·(1 + std/|mean|)`, clamped 8–120
- **archetype_key** — nearest of 4 seed archetypes (conservative_income, balanced_growth, aggressive_momentum, scalper_active) in a log-scaled 9-feature space

Cold-start (<3 closed trades): archetype defaults only, no shrinkage math. All math lives in `_shared/user-models.ts` — pure JS, ~50 ms/user, ready for the scanner/autotrader to consume as a downstream tilt. Online Beta-Binomial updates (`updateBeta`) run in <1 ms and are meant to be triggered from the close-trade path between nightly retrains.

