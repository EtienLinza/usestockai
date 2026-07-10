---
name: Shared Adaptive Context
description: Single source of truth for regime, VIX, vol-target, drawdown/CDaR, correlation gate, and adaptive settings — imported by both live autotrader and portfolio backtest so behavior can never diverge.
type: feature
---
`supabase/functions/_shared/adaptive-context.ts` owns every adaptive primitive:

- Constants: `ROLLING_DD_HARD_BLOCK_PCT`, `CDAR_*`, `VOL_TARGET_*`, `VOL_LOOKBACK*`, `CORR_LOOKBACK_BARS`, `RISK_PROFILE_BASELINES`.
- Pure fns: `spyTrendOf`, `isBearishMacro`, `vixRegimeOf`, `realizedVolAnnualized`, `volTargetScalar`, `adaptiveCorrThreshold`, `dailyReturns`, `pearson`.
- Core adaptive tuning: `computeEffectiveSettings<S extends AdaptiveSettings>(s, ctx, regimeFloors)` — VIX/SPY/drawdown/CDaR layered on profile baseline.
- Helper: `computeRollingDrawdown(navHistory[], window=30)` → `{drawdownPct, cdarPct}`.

Both `autotrader-scan/index.ts` (live) and `_shared/backtest-sim.ts` (portfolio backtest) import from this file. The backtest passes `AdaptiveInputs { spyBars, vixBars, regimeFloors }` into `simulateChunk`, which builds per-day `MacroContext` + `AdaptiveContext` and calls `computeEffectiveSettings` on every trading day.

Sizing in the backtest now matches live exactly: `baseFrac = sig.kellyFraction * volScalar; cappedFrac = min(baseFrac, eff.max_single_name_pct/100, headroom); targetDollars = nav * cappedFrac`.

Rule: never re-declare these constants or functions in a call site. If live behavior needs a change, edit this file — the backtest picks it up automatically.

Remaining live-only behavior not yet in the backtest (deliberate, planned Phase 2):
- `computeEntryGuardEnvelope` reversal-risk gate
- `assessReversalRisk` at-close guard
- Meta-label ML filter
- Sector caps + portfolio beta cap
- Add-on / pyramid engine
- Signal cooldown, isotonic calibration curve
- Ticker calibration + strategy tilts (loaded but not yet applied in sim)
- Rotation
