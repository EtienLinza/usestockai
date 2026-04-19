

## Goal

Verify that the entire algorithm pipeline works end-to-end after Phases 1–3, fix every bug uncovered, and unify all algorithm-using surfaces on the new logic. No surface should still be running stale duplicated code.

## What I found

### 🔴 Bugs to fix first

1. **`backtest/index.ts` lines 405–414 — duplicate `regime: string` field in the return type of `computeStrategySignal`.** When `predictedReturn` was deprecated the cleanup left a stray duplicate field. Likely compiles in Deno (TS allows it with a warning) but it's broken and should be removed. The deprecated `predictedReturn` field can also leave the type entirely — nothing reads it.

2. **`check-sell-alerts/index.ts` is fully out-of-date** (the entire file is its own private copy of EMA / RSI / ATR / ADX / `classifyStockSimple` / `computeWeeklyBias` from BEFORE the Phase 1 refactor). Specifically:
   - Uses **EMA-smoothed ADX** (the bug we fixed — values 15-20% too low)
   - `classifyStockSimple` uses the **full price history** (the lookahead bias we removed in Phase 3a)
   - Asymmetric weekly-bias short logic (the bug in Phase 3c that's still pending)
   - This is the function that **decides when to alert users to sell their virtual positions** — so live users are getting decisions from the OLD broken algo.

3. **`market-scanner/index.ts` has a leftover local `calculateOBV`** at line that is now also exported from the shared module. Minor, but should use the shared one.

4. **`stock-predict/index.ts` still defines its own local `calculateOBV`** at line 186 instead of importing from `_shared/indicators.ts`.

### 🟡 Verification needed

5. Run the deployed `backtest` edge function once (50 tickers, 3-year window) to confirm:
   - The duplicate-regime fix didn't break compilation
   - Conviction buckets actually populate now (last run had clustered confidence values)
   - Tiered TP1 (`tp1_partial`) and `breakeven_stop` exit reasons appear in the trade log
   - Win rate, profit factor, hit-rate-by-conviction-bucket vs Phase 2 baseline
6. Trigger `market-scanner` once and inspect `live_signals` to confirm pooled-bonus conviction values spread across 60–100 (not saturated at 100).
7. Open the Backtest page in preview to confirm UI still renders (no broken refs to dropped fields).

## Plan

### Step 1 — Fix the type bug in `backtest/index.ts`
Remove the duplicate `regime: string;` line in the `computeStrategySignal` return type and drop the deprecated `predictedReturn` field. Leave the local variable named `predictedReturn = 0` if it simplifies callsite changes, but remove it from the return type.

### Step 2 — Migrate `check-sell-alerts` onto the shared algo
Rewrite `check-sell-alerts/index.ts` to:
- Import all indicators from `_shared/indicators.ts` (delete the 80+ lines of local copies)
- Import or re-export `classifyStockSimple` + `computeWeeklyBias` + `aggregateToWeekly` + `PROFILE_WEEKLY_PARAMS` from a new `_shared/signal-engine.ts` module so it cannot drift again
- Use the same lookahead-fixed 120-bar `classifyStockSimple` already in `market-scanner` and `stock-predict`

### Step 3 — Create `_shared/signal-engine.ts`
Move `aggregateToWeekly`, `computeWeeklyBias`, `classifyStockSimple`, `hasDailyEntrySignal`, and `PROFILE_WEEKLY_PARAMS` into one shared module. Update imports in `market-scanner`, `check-sell-alerts`, and `stock-predict`. The `backtest` engine has its own enriched `classifyStock` (with blending) so it stays separate, but it still imports indicators from `_shared/indicators.ts`.

### Step 4 — Drop duplicate `calculateOBV` in `market-scanner` and `stock-predict`
Use the shared one. Removes ~30 lines of duplicate code.

### Step 5 — Deploy + run end-to-end validation
1. Deploy `backtest`, `market-scanner`, `check-sell-alerts`, `stock-predict`
2. Curl `backtest` with the 50-ticker / 3-year config — capture win rate, profit factor, conviction-bucket distribution, exit-reason mix
3. Curl `market-scanner` once — verify signals get written to `live_signals` with conviction values spread across 60–100
4. Open Backtest page in preview to confirm UI renders cleanly

### Step 6 — Report deltas
Compare against the Phase 2 baseline (78.1% WR, 47.13 PF on 5-tickers; 74.1% WR / 62.06 PF on 50-ticker Phase 3a run). Flag any regression and call out whether Phase 3c (symmetric weekly bias) and Phase 4 (ATR-scaled cooldown) should be the next steps.

## Out of scope (kept for later phases)

- **Phase 3c** (symmetric weekly bias / `computeWeeklyBias` short-side allocation ladder) — explicitly deferred per user's prior choice.
- **Phase 4** (ATR-scaled cooldown) — deferred.
- **Custom exit targets propagation** — `check-sell-alerts` already uses `target_profit_pct`; tiered TP1 partial exits in live trading are a separate "apply to virtual positions" feature.

## Files to touch

- `supabase/functions/backtest/index.ts` (1 small fix)
- `supabase/functions/_shared/signal-engine.ts` (new)
- `supabase/functions/check-sell-alerts/index.ts` (rewrite, ~70% smaller)
- `supabase/functions/market-scanner/index.ts` (drop local OBV, import from shared engine)
- `supabase/functions/stock-predict/index.ts` (drop local OBV, import from shared engine)

