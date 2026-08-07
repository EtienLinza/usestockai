---
name: Ensemble Champion Wired Live (WS1)
description: The 4-model ensemble champion is now loaded at scan start and blended 0.7/0.3 with the simple meta-labeler for live entry meta-filtering; entry feature snapshots persist to virtual_positions and flow through to signal_outcomes for retraining.
type: feature
---

`autotrader-scan/index.ts` now imports `loadChampionEnsemble` (from `_shared/ensemble-loader.ts`) and `predictEnsemble` (from `_shared/ensemble.ts`). At scan start it queries the latest `model_versions` row with `status='champion'`, `model_kind='ensemble'` and logs coverage.

**Scoring blend** (`blendMetaScore`): champion 0.7 × simple-meta-labeler 0.3 when both exist; champion-only if no simple model; simple-only during cold start (no promoted champion yet — the common case until `manage-models` runs its first promotion). The blended `metaScore` drives the existing skip/demote gates and the continuous ±8 conviction bend.

**Entry feature snapshot** (`buildEntryFeatureSnapshot`): captures entry-observable numeric features (atr_pct, weekly_alloc, kelly_fraction, danelfin_score/delta, eps_revision_score/delta, regime_delta, is_buy/short, regime one-hots, hour/day, conviction_at_entry) plus underscore-prefixed string metadata keys (`_market_regime`, `_signal_regime`, `_strategy`, `_profile`) consumed only at exit. Stored on `virtual_positions.entry_feature_snapshot` at entry.

**Exit → training loop**: on full exit, the outcome's `signal_outcomes.feature_snapshot` spreads the entry snapshot then overlays exit-computed `initial_stop_pct` + `gap_through_stop_bps`. `regime` and `contributing_rules.market_regime` are now populated from the entry snapshot metadata instead of hardcoded null/"neutral". The nightly `calibrate-weights` trainer flattens these features (numeric only) + prepends `conviction` → retrains the ensemble → `manage-models` promotes the best challenger to champion. Closed loop.

**Cold-start safety**: until the first champion is promoted, `loadChampionEnsemble` returns null and the engine runs on the simple meta-labeler exactly as before — no behavior change.
