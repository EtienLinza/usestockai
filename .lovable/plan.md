# Make Portfolio Backtest = Live Autotrader (Exactly)

**Goal:** The portfolio backtest calls the *same functions* the live scanner does — not a lookalike copy. If a live behavior changes, the backtest inherits it automatically.

## The problem

`_shared/backtest-sim.ts` is a "faithful but simplified" reimplementation of `autotrader-scan/index.ts`. It duplicates:

- Entry gates (conviction floor, ATR ceiling, correlation, heat, exposure)
- Sizing (kellyFraction only — no vol-target scalar, no ticker calibration, no strategy tilts)
- Position management (R-ladder + trail — missing add-ons, meta-label filter, reversal-risk, guard envelope, drift events)
- No adaptive tuning (regime floors, VIX gating, drawdown tightening, CDaR)
- No sector caps, no portfolio beta cap, no correlation-book gate with adaptive threshold
- No emergency mode / daily-loss halt / rotation / cooldowns
- No isotonic calibration curve or per-ticker calibration

That's why results diverge from live.

## The fix — lift, don't copy

Extract the live decision logic into `_shared/` modules that **both** `autotrader-scan` and the backtest sim import. The live scanner keeps working unchanged (same behavior, same call sites). The backtest replaces its handcrafted stepDay with calls into those same modules.

### New shared modules

1. `_shared/adaptive-context.ts` — `computeEffectiveSettings`, `vixRegimeOf`, `spyTrendOf`, `volTargetScalar`, `realizedVolAnnualized`, `RISK_PROFILE_BASELINES`, `adaptiveCorrThreshold`, `algoScanIntervalMinutes`.

2. `_shared/entry-gates.ts` — `computeEntryGuardEnvelope`, `assessReversalRisk`, `maxCorrelationToBook`, `pearson`, `dailyReturns`, `inferInitRiskPerShare`, `inferHardStopPrice`, `bucketKeyAT`, plus a new `evaluateEntryCandidate(args)` that wraps the entry portion of `runEntryDecision` and returns `{decision, size, stops, reasons}` without any DB writes.

3. `_shared/exit-manager.ts` — `runWinExit`, `runLossExit`, `computePeakSignals`, add-on eval — returning intents (`{action, shares, price, reason}`) instead of writing to DB.

4. `_shared/portfolio-caps.ts` — sector-max, portfolio-beta, correlated-position caps as pure functions.

### Refactor `autotrader-scan/index.ts`

- Delete the extracted function bodies and import them.
- `runEntryDecision`, `runWinExit`, `runLossExit` become thin wrappers: call shared → apply intent to DB.
- No behavior change; commit signature identical.

### Rewrite `_shared/backtest-sim.ts`

- Delete the handcrafted `stepDay` gate stack.
- Each simulated day now runs the exact live sequence:
  1. Build a `MacroContext` from SPY bars sliced up to `date` (already have SPY in bars if included; if not, pre-fetch SPY + ^VIX once and pass in).
  2. Build `AdaptiveContext` via `computeEffectiveSettings` (VIX regime, SPY trend, vol scalar, drawdown/CDaR).
  3. For each open position → `runWinExit` + `runLossExit` intents → apply to sim state (fill at OHLC).
  4. For each active-in-index candidate → `evaluateEntryCandidate` → apply intent (open at close).
  5. Add-on evaluation for existing positions.
- Same order-fill model (market at bar close, gaps fill at open) but using live-derived intents.
- Time-accurate universe filter stays as-is.
- CPU-budgeted chunking stays as-is.

### Sim adapters for the shared modules

Shared functions were written against Supabase DB reads for things like `strategy_weights`, `signal_cooldown`, `meta_label_model`, `ticker_calibration`. Refactor these to take the loaded values as **arguments** (dependency-injected). The live scanner loads them once from DB per scan; the backtest loads them once at job start and passes the same objects. Zero DB reads inside per-bar hot path.

### Data the sim must pre-load once per job (in `simulate` stage init)

- Active `strategy_weights` row (regime_floors, exit_calibration, calibration_curve, strategy_tilts, ticker_calibration)
- SPY + ^VIX bars (added to `backtest_bars_cache`)
- Sector map for the universe (from a static JSON or from `finnhub_cache`)
- `portfolio_caps` defaults (or per-user row for backwards compat)

### What we intentionally skip in backtest

- Emergency mode / kill switch (user-facing runtime state, N/A)
- Rotation (relies on live conviction stream — could add later)
- Auto-add-to-watchlist (universe is fixed for the run)
- Real order execution / notifications
- Live news sentiment (no historical NewsAPI archive — signal engine already handles this gracefully with nulls)

Everything else — every gate, cap, scalar, calibration, R-ladder rung, trail, add-on rule — runs identically.

## Technical notes

- `runEntryDecision` currently mixes decision + persistence. The extraction returns a pure `EntryIntent` object; the live scanner applies it via existing `executeEntry`; the backtest applies it via a new `applyEntryToSimState` that mirrors the persistence semantics against in-memory state.
- `runWinExit` / `runLossExit` similarly split into `evaluateWinExit` / `applyExitToSimState`.
- We do NOT change signatures the outside world depends on (`serve` handlers, cron jobs) — only internal factoring.
- Engine version bumps to `v3` in `backtest_bars_cache` if we start caching SPY/VIX under the same table (or use a separate `benchmark_bars_cache` — cleaner).

## Files touched

**New:**
- `supabase/functions/_shared/adaptive-context.ts`
- `supabase/functions/_shared/entry-gates.ts`
- `supabase/functions/_shared/exit-manager.ts`
- `supabase/functions/_shared/portfolio-caps.ts`

**Rewritten:**
- `supabase/functions/_shared/backtest-sim.ts`
- `supabase/functions/backtest-portfolio-tick/index.ts` (pre-loads strategy_weights / SPY / VIX / sector map)

**Edited:**
- `supabase/functions/autotrader-scan/index.ts` (imports from new shared modules; delete duplicated bodies)

## Estimate

Large refactor. ~2000 lines moved, ~400 lines new glue. The live scanner needs to be re-verified after extraction — I'll run `tsgo --noEmit` after each shared-module extraction and after the sim rewrite. Expect a longer-than-usual turn.

## Confirm before I start

This is the right shape, but I want to flag one tradeoff: **speed will drop**. The live gate stack is heavier than the current sim; a 500-name × 3-year unlimited run that currently takes ~15 min will likely take 45–60 min on first run (bars are still cached after that). Acceptable given your "runnable regardless of duration" stance from earlier, but confirm.

Say **go** and I'll ship it. Say **narrow it** if you want fewer shared modules first (e.g. just entry gates), and I'll trim.