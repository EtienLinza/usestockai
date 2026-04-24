// ============================================================================
// LEGACY SHIM — re-exports from signal-engine-v2 (the canonical engine).
//
// All call sites should migrate to importing directly from signal-engine-v2.ts.
// This file exists only to keep older imports working during the transition
// and will be removed once nothing imports from "./signal-engine.ts".
// ============================================================================

export {
  // Types
  type DataSet,
  type StockProfile,
  type WeeklyBias,
  type StockClassification,
  type ProfileParams,
  type SignalState,
  type EvaluateSignalResult,

  // Constants
  PROFILE_PARAMS,
  PROFILE_WEEKLY_PARAMS,
  INDEX_TICKERS,

  // Aggregation & classification
  aggregateToWeekly,
  classifyStock,
  classifyStockSimple,
  blendProfiles,

  // Bias & entry
  computeWeeklyBias,
  hasDailyEntrySignal,
  hasDailyMeanReversionEntry,

  // Multi-strategy signal
  createSignalTracker,
  computeStrategySignal,

  // Top-level orchestrator
  evaluateSignal,
} from "./signal-engine-v2.ts";
