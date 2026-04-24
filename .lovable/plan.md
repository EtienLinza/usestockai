

## You're right — and here's exactly what's happening

Your read of `_shared/signal-engine.ts` is correct on every count. But there's one nuance worth flagging before the fix: the **scanner** (`market-scanner/index.ts`) already wraps the shared engine with extra logic — it calls `computeSignalConviction(...)` *after* `hasDailyEntrySignal` passes, and applies macro/calibration adjustments. So live signals do get a 0–100 conviction. The problem is:

1. **The gate is still the simple engine.** `hasDailyEntrySignal` is what decides whether `computeSignalConviction` even runs. If the gate is wrong, the rich downstream conviction never gets a chance.
2. **`check-sell-alerts` uses ONLY the simple engine** — it has no `computeSignalConviction` wrapper. So exits run on a different signal than entries.
3. **The backtest uses a totally different code path** (`computeStrategySignal` in `backtest/index.ts`) — so when you backtest, you're measuring something the live system never actually executes.

The consolidation needs to make `_shared/signal-engine.ts` the **single source of truth** that all four call sites use: market-scanner, check-sell-alerts, stock-predict, and backtest.

---

## The consolidation plan

### Step 1 — Promote the backtest's signal engine into `_shared/`

Create `supabase/functions/_shared/signal-engine-v2.ts` containing the canonical multi-strategy engine, lifted directly from `backtest/index.ts`:

- `classifyStock(close, high, low, ticker)` — full version with `meanReversionRate`, `trendScore`, ATR%, blended profiles, INDEX_TICKERS hint. Replaces the broken 3-condition `classifyStockSimple` so `value` actually matches real value names.
- `PROFILE_PARAMS` (full 16-field record) and `blendProfiles(...)`.
- `computeStrategySignal(...)` — runs trend / mean-reversion / breakout in parallel, picks highest conviction, returns `{ signal, conviction (0–100), strategy, regime, atr, positionSizeMultiplier }`.
- `computeWeeklyBias(...)` — keep the existing weekly bias function (it's correct, just used as a *macro filter*, not the entry trigger).
- `evaluateSignal(...)` — new top-level convenience function that combines weekly bias + daily strategy signal + macro context, returns the canonical signal object the scanner stores.

Both long and short paths get full conviction-based sizing (0–100), not the asymmetric `-0.5` cap.

### Step 2 — Wire all four call sites to `signal-engine-v2.ts`

| Call site | Change |
|---|---|
| `market-scanner/index.ts` | Replace `hasDailyEntrySignal` + `computeSignalConviction` with one call to `evaluateSignal(...)`. Macro context (`spyContext`, `macroFloorAdjust`) keeps working — passed in as a param. |
| `check-sell-alerts/index.ts` | Use `evaluateSignal` for exit decisions too — so an open long is closed when the *same engine* that opened it now says HOLD or SHORT. No more "entered with engine A, exited with engine B." |
| `stock-predict/index.ts` | Replace its bespoke prediction math with `evaluateSignal` so the manual analyzer matches the autotrader. |
| `backtest/index.ts` | Delete the duplicated `computeStrategySignal` / `classifyStock` / `PROFILE_PARAMS` and import from `_shared/signal-engine-v2.ts`. The backtest now literally simulates the live code path. |

### Step 3 — Delete the broken bits

- Old `hasDailyEntrySignal` (the one that ignores `_high, _low, _volume`) — removed entirely.
- Old `classifyStockSimple` (the 3-condition value gate) — removed.
- The asymmetric `targetAllocation: -0.5` short cap — removed; shorts size by conviction like longs.
- The header comment `// (backtest/index.ts has its own enriched classifier with blending — keep separate)` — replaced with `// SINGLE SOURCE OF TRUTH — used by scanner, sell-alerts, predict, backtest`.

### Step 4 — Verification step (after the consolidation)

Re-run the same 25-ticker / 2000–2025 archetype backtest. Because the backtest now imports from `_shared/signal-engine-v2.ts`, the win-rate/Sharpe/profit-factor numbers it produces are now the **real** numbers your live autotrader will deliver — no more gap between simulated and live performance. If the numbers drop materially from 59.8% / 7.37 PF, that's the truth showing up; if they hold, the gap was real and is now closed.

---

## Files touched

**New:** `supabase/functions/_shared/signal-engine-v2.ts` (~600 lines, mostly lifted verbatim from `backtest/index.ts` lines 180–760)

**Modified:**
- `supabase/functions/_shared/signal-engine.ts` — replaced with re-exports from v2 for backward-compat during the swap, then deleted in a follow-up
- `supabase/functions/market-scanner/index.ts` — call site swap (lines ~95–110 imports, ~820–880 call site)
- `supabase/functions/check-sell-alerts/index.ts` — call site swap (lines ~5–10 imports, ~150–170 call site)
- `supabase/functions/stock-predict/index.ts` — call site swap
- `supabase/functions/backtest/index.ts` — delete duplicate definitions (lines 180–760), import from `_shared`

## What's deliberately out of scope

- **Building new strategies.** This is a pure consolidation — same logic, single home. No alpha changes.
- **Re-tuning thresholds.** Once the live system actually runs the engine the backtest validated, we'll see honest numbers, then tune.
- **Touching the measurement-layer fixes** from the previous round (beta, stress, sensitivity). Those stay.

---

## Why this fixes your six points

| Your concern | How it's resolved |
|---|---|
| 1. `hasDailyEntrySignal` ignores high/low/volume | Replaced by `computeStrategySignal` which uses ATR, BB, OBV, volume ratio, range expansion |
| 2. Only one strategy runs live | All three (trend/MR/breakout) now run live, best one selected by conviction |
| 3. No conviction score | Returns 0–100 conviction at every entry; sizing scales with it |
| 4. `value` classification basically never matches | Replaced with full classifier using `meanReversionRate` + blended profiles — value names actually classify as value |
| 5. No macro/SPY context | `evaluateSignal` accepts `adaptiveContext: { spyBearish, spySMADeclining, isLeader }` and applies the dual-regime guard |
| 6. Asymmetric short side capped at -0.5 | Shorts size by conviction same as longs |

