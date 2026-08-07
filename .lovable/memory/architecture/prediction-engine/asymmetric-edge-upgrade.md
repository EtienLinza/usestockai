---
name: Asymmetric Edge Upgrade
description: Gap-risk position cap, edge-scaled sizing, strategy expectancy circuit breaker, gap-through-stop feedback, learning-loop watchdog
type: feature
---

Built after the hard-stop bleed (7 of 18 exits stopped, −$2.7k; outsized losses were overnight gaps filling far below stops). Five layers:

1. **Gap-risk position cap** — `overnightGapPct95()` / `gapCappedDollars()` in `_shared/adaptive-context.ts` compute a ticker's 95th-pctile |overnight gap| from its own 1y bars. Entry dollars are capped so that gap costs ≤ `GAP_LOSS_CAP_NAV_PCT` (1%) of NAV. Applied in both `autotrader-scan` (live) and `_shared/backtest-sim.ts` (parity). This is the ONLY real defense against gap-through-stop losses — stops cannot fill inside a gap.
2. **Edge-scaled sizing** — `edgeSizeMultiplier(effectiveConviction, minConviction, metaScore)` returns 0.5–1.5× on kellyFraction: A+ setups (high blended conviction + meta ≥ 0.6) sized up, marginal passes sized down. Absolute caps (single-name, NAV headroom, heat) still apply.
3. **Strategy expectancy circuit breaker** — nightly `calibrate-weights` computes per-strategy time-decayed trailing 90d expectancy (≥15 closed trades). Negative-expectancy strategies are **benched**: `floorBoost` +10 conviction on their floor, persisted to `strategy_weights.notes.strategy_expectancy`; `autotrader-scan` applies the boost at both conviction gates. Positive-expectancy strategies get wider tilt bands (0.25 vs 0.15 scale). Self-healing — bench lifts automatically when the trailing record recovers.
4. **Gap-through-stop feedback** — `executeExit` records adverse slippage (bps past the stop) into `signal_outcomes.slippage_bps_est` + `feature_snapshot.gap_through_stop_bps` + annotated exit_reason. Nightly ticker calibration penalizes tickers where >50% of stops gapped ≥1% (`gapPenalty` −4, included in the ±8 cap).
5. **Learning-loop watchdog** — calibrate-weights ends by checking: if ≥1 autotrader is enabled but 0 closed outcomes in 7d, records `learning-loop` heartbeat as `degraded` (heartbeat.ts status union extended; health-check maps degraded → error). Prevents a repeat of the silent starvation incident.

Sizing flow order: kellyFraction × volScalar × edgeMult → min(single-name, headroom) → portfolio-heat headroom → risk-parity (stop-width) clamp → **gap cap** → ≥1 share check.
