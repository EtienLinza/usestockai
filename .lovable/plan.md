## Goal

Add a second mode to the backtester: **Autotrader Mode**. Today's backtester is single/multi-ticker pure-math. The new mode replays the **live autotrader's full decision loop** over historical bars across the same universe the live scanner uses — same entry gates, same exits, same sizing — so the user can see how the actual bot would have performed.

UI becomes a 2-mode toggle at the top of the config panel: **Single Stock** (current behavior, untouched) and **Autotrader**.

## Universe & sentiment (already decided)

- Universe: same as live scanner — `discoverTickers()` from `_shared/scan-pipeline.ts` (~150-200 tickers).
- Sentiment: **skipped**. Live autotrader already removed sentiment from the loop, so this matches reality.

## Settings panel (Autotrader mode)

Prefill from the user's live config (`autotrade_settings` + `portfolio_caps`) on page load, then allow overrides:

- Risk profile (conservative / balanced / aggressive)
- Min conviction
- Max positions
- Max NAV exposure %
- Max single-name %
- Daily loss limit %
- Starting NAV
- Adaptive mode on/off (whether to layer VIX/SPY/PnL adjustments like the live bot)
- Date range (start/end year, same as today)

A "Reset to live settings" button reverts overrides.

## Backend: new edge function `backtest-autotrader`

Lives at `supabase/functions/backtest-autotrader/index.ts`. Auth-required (same JWT check as the existing `backtest`).

### Pipeline

1. **Discover universe** via `discoverTickers()`. Cap to top 100 by liquidity if cost requires it (configurable).
2. **Fetch history** for universe + SPY + ^VIX over the requested date range. Bounded parallelism, same Yahoo path as today's backtester.
3. **Day-by-day walk** from the first bar where every required indicator is warm (~250 bars in):
   - Slice each ticker's series to bars `[0..t]`.
   - **Update macro** (`MacroContext` from SPY slice, VIX value, vol scalar, regime).
   - **For each open position**: call the same `runWinExit` / `runLossExit` extracted from `autotrader-scan`. Apply trailing/peak updates. Execute exits at next bar's open.
   - **For each non-open ticker**: call `evaluateSignal()` (canonical engine). If `BUY/SHORT` and conviction ≥ effective min_conviction, run entry gates in this order: daily-loss limit → max_positions → max_nav_exposure → correlation gate (60d vs open book, |ρ|≥0.75) → single-name cap → vol-target sizing. Enter at next bar's open.
   - Mark-to-market portfolio, append to equity curve.
4. **Build report** in the existing `BacktestReport` shape so the current dashboard renders it unchanged. Trade log, equity curve, drawdown, Sharpe/Sortino/Calmar, monthly returns, regime breakdown, strategy attribution.
5. Skip Monte Carlo robustness/noise tests for v1 (computationally expensive at universe scale).

### Code reuse strategy

Per the project's "Edge Function Replication" memory (subdirectory isolation), I will **copy the exit/entry/effective-settings/correlation/vol-target helpers** from `autotrader-scan/index.ts` into the new function rather than refactor live code. The `_shared/signal-engine-v2.ts` and `_shared/scan-pipeline.ts` are already shared and will be imported directly.

### Performance guards

- Hard cap universe at 100 tickers (configurable in body, default 100).
- Default range capped at 3 years to keep CPU under Deno edge limit.
- Step rate = 1 bar/day (no sub-stepping).
- Early-exit if wall time > 110 s; return partial results with a `truncated: true` flag.

## UI changes

`src/pages/Backtest.tsx`:
- Add `mode: "single" | "autotrader"` toggle at top of config panel.
- Conditionally render the existing config form vs the new autotrader settings form.
- New autotrader form fetches `/autotrade_settings` + `/portfolio_caps` for the current user on mount (read directly via supabase client) and prefills.
- On run, dispatch to `/backtest` (existing) or `/backtest-autotrader` (new) based on mode.
- Results dashboard is unchanged — both endpoints return the same `BacktestReport`.
- Add a small badge on the results header showing "Autotrader replay over N tickers" when applicable.

## Files

- New: `supabase/functions/backtest-autotrader/index.ts` (~800-1000 lines: full simulator + helpers copy)
- Edit: `src/pages/Backtest.tsx` (mode toggle, autotrader settings panel, dispatch logic)
- No DB migrations. No live-engine changes. No changes to existing `/backtest` function.

## Out of scope for v1

- News sentiment replay (intentional — answered).
- Kill-switch / cron / multi-user replay (single user, the caller).
- Auto-watchlist sync.
- Per-position partial exits scaling out across multiple bars (we'll execute partials as 50% reduction at next open, same as live).
- Storing replay results in DB (one-shot response only).

## Verification

1. Run autotrader mode over 2023-2024 with default balanced profile → expect a populated trade log, equity curve, win rate within 5pp of the user's live realized win rate.
2. Toggle adaptive mode off → expect more aggressive/looser results matching the chosen risk profile baseline.
3. Toggle mode back to Single Stock → existing flow works unchanged.