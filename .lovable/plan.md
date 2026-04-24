# AutoTrader Execution Engine

A fully automated trade lifecycle: scans every opted-in user every 10 min, opens positions on high-conviction signals, exits winners on multi-signal peak detection, exits losers on thesis invalidation. Improves on the example plan by reusing the existing `evaluateSignal()` engine end-to-end and integrating with the existing `virtual_positions` table instead of creating a parallel one.

## Step 1 — Wipe trade history (one-time)

Clear all simulated trade history for every user as requested:

- `DELETE FROM virtual_positions` (all rows, all users)
- `DELETE FROM virtual_portfolio_log`
- `DELETE FROM sell_alerts`
- `DELETE FROM signal_outcomes`

Done via the insert/data tool, not a migration (data-only operation).

## Step 2 — Schema additions

**New table `autotrade_settings`** (per-user opt-in + risk knobs, RLS-protected):

```text
user_id              uuid PK FK profiles
enabled              bool       default false   -- master switch
min_conviction       int        default 70
max_positions        int        default 8
max_nav_exposure_pct numeric    default 80      -- % of NAV deployed
max_single_name_pct  numeric    default 20
daily_loss_limit_pct numeric    default 3
starting_nav         numeric    default 100000
paper_mode           bool       default true    -- simulate fills only
notify_on_action     bool       default true
created_at, updated_at
```
Auto-seeded by trigger on `profiles` insert (same pattern as `portfolio_caps`). User toggles `enabled` from `/settings`.

**New table `autotrade_log`** (audit trail, RLS-protected: user reads own):

```text
id, user_id, ticker, action ('ENTRY'|'PARTIAL_EXIT'|'FULL_EXIT'|'HOLD'|'BLOCKED'),
reason text, price numeric, shares numeric, pnl_pct numeric,
conviction int, strategy text, profile text, created_at
```

**Columns added to `virtual_positions`** (so exit logic has the state it needs without a parallel table):

```text
peak_price            numeric   -- highest (long) / lowest (short) seen since entry
trailing_stop_price   numeric   -- ratchets up; never moves backwards
hard_stop_price       numeric   -- ATR-based, set at entry, never changes
entry_atr             numeric   -- ATR at entry
entry_conviction      int
entry_strategy        text      -- 'trend' | 'mean_reversion' | 'breakout'
entry_profile         text      -- 'momentum' | 'value' | 'index' | 'volatile'
entry_weekly_alloc    numeric   -- weeklyBias.targetAllocation at entry
breakout_failed_count int       default 0
opened_by             text      default 'manual'  -- 'manual' | 'autotrader'
cooldown_until        timestamptz   -- per-position cooldown after close
```

**Cron job** (data-insert tool, since the URL is project-specific):
```text
*/10 13-21 * * 1-5    -- every 10 min during US market hours UTC, weekdays
  → POST /functions/v1/autotrader-scan
```

## Step 3 — New edge function `autotrader-scan` (verify_jwt = false, cron-invoked)

One pass per user. Self-contained orchestrator:

```text
1. Load all autotrade_settings WHERE enabled = true
2. For each user (sequential, capped concurrency 3):
   a. Load open virtual_positions (status='open', opened_by IN ('manual','autotrader'))
   b. Load watchlist tickers
   c. Build deduped ticker list = positions ∪ watchlist
   d. Batch-fetch 1y daily OHLCV from Yahoo (5-at-a-time, in-memory cache keyed by ticker
      so SPY + repeated tickers across users only fetch once per scan)
   e. Fetch SPY into MacroContext { spyClose }
   f. For each ticker:
        - if user has open position → runExitDecision(position, data, macro)
        - else if in watchlist     → runEntryDecision(ticker, data, macro, user)
   g. Apply portfolio guardrails before any ENTRY (see Step 5)
   h. Execute decisions (paper mode: log only, no broker)
   i. Write each action to autotrade_log
   j. Insert push-notify rows into sell_alerts for exits / fresh entries
3. Update virtual_portfolio_log snapshot per user
```

## Step 4 — Exit Engine (Win + Loss in parallel; loss wins ties)

Both run on every open position. **First to trigger executes.**

### Win Exit — Peak Detection (5 signals, 3-of-5 rule)

Scores all 5 simultaneously; only counts after `pnl_pct >= 6%` (no peak-timing on tiny gains):

1. **Trailing-stop ratchet hit** — `trailing_stop = max(trailing_stop, peak − atr × profile.trailingStopATRMult)`. Updated on every scan; persisted to DB. Hit when current crosses it.
2. **RSI bearish divergence** — `close[t] > close[t−5] AND rsi[t] < rsi[t−5] AND rsi[t] > 65`.
3. **Volume climax candle** — `vol[t] > 1.8 × avgVol20 AND (close − low)/(high − low) < 0.35`.
4. **MACD histogram rollover** — positive but declining 2 bars in a row.
5. **Thesis completion** (strategy-aware):
   - `mean_reversion`: RSI back to 48–58 neutral
   - `trend`: weekly `targetAllocation` dropped ≥ 0.5 from entry value
   - `breakout`: close back below `entry_price × 1.01`

**Decisions:**
- `triggered ≥ 3` → FULL_EXIT
- `triggered = 2 AND pnl_pct ≥ profile.takeProfitPct × 0.8` → PARTIAL_EXIT 50%
- `pnl_pct ≥ profile.takeProfitPct × 1.5` → FULL_EXIT (hard ceiling, overrides everything)
- else HOLD (peak-detection deferred — let it run)

### Loss Exit — Thesis Invalidation (priority order, fires alone)

1. **Hard stop** — `currentPrice ≤ hard_stop_price` (long). Set at entry as `entry_price − entry_atr × profile.hardStopATRMult`. **Non-negotiable.** FULL_EXIT.
2. **Thesis invalidation** (only when `pnl_pct < −3%`):
   - Weekly bias flipped to opposite of position direction
   - `macroPermitsEntry()` now blocks the position's direction
   - Mean-reversion + held > `profile.maxHoldMR` bars + RSI still < 40 → "MR failed"
   - Breakout + `breakout_failed_count >= 2` → "breakout failed"
3. **Time stop** — held ≥ `profile.maxHold[strategy]`: FULL_EXIT regardless of P&L (dead capital).

### Why this is better than the example plan

- **Strategy-aware thesis check uses live `evaluateSignal()` output** — not a hard-coded re-implementation. The exit engine just calls `evaluateSignal()` once and reads `weeklyBias.targetAllocation` and the new bias direction directly. One source of truth, zero drift.
- **Trailing stop is recalculated in-function and only persisted on change** — no DB write storm.
- **Peak detection ignored below +6%** prevents exiting noise as "exhaustion".

## Step 5 — Entry Engine

Run only when `position == null`. Returns ENTER + size, or HOLD + reason (logged).

```text
1. Cooldown check (per-ticker, from closed virtual_positions.cooldown_until)
2. Portfolio guardrails:
     - open_count < settings.max_positions
     - sum(open NAV %) + new_size ≤ settings.max_nav_exposure_pct
     - new_size ≤ settings.max_single_name_pct
     - within market hours (skip first 30 min and last 15 min)
3. Daily loss limit check:
     - sum today's realized + unrealized P&L ≥ −settings.daily_loss_limit_pct → block
4. Call evaluateSignal(data, ticker, adaptiveContext, macro)
     - if decision == 'HOLD' or conviction < settings.min_conviction → HOLD
5. Size: shares = floor(settings.starting_nav × kellyFraction × cap_multiplier / current_price)
     - cap_multiplier shrinks size when portfolio headroom is tight
6. Calculate stops at entry:
     - hard_stop_price  = entry − entry_atr × profile.hardStopATRMult     (long)
     - trailing_stop    = same as hard_stop (will ratchet up)
     - peak_price       = entry_price
7. INSERT virtual_positions with opened_by='autotrader' and all the new columns populated
8. Log to autotrade_log
```

## Step 6 — Execution Layer (paper mode)

In v1 everything is paper-traded:
- Entries: insert `virtual_positions` row at current scan price.
- Exits: update existing row → `status='closed'`, set `exit_price`, `exit_date`, `exit_reason`, `pnl`, `closed_at`, `cooldown_until = now() + profile-cooldown-days`.
- Partials: split the row — close N shares, leave (shares − N) open. Implemented by reducing `shares` on the open row and inserting a paired closed row with `exit_reason='partial_<count>'` for accounting.
- Every action posts a `sell_alerts` row (so the existing Notification Center bell already shows it — no UI work required for v1).

`paper_mode = false` is left as a hook for later broker integration; throws "Live mode not yet supported" for now.

## Step 7 — Frontend touch-up

Minimal — most observability already exists:

- `/settings` page: add an **AutoTrader** card with `enabled` toggle, conviction slider, max-positions stepper, NAV-exposure slider, daily-loss-limit slider. All bound to `autotrade_settings`.
- Dashboard Trading tab: add a small **"AutoTrader: ON • last scan 4m ago"** badge that reads from the most recent `autotrade_log` row.
- New `/autotrader-log` page: simple table of last 100 actions (action, ticker, reason, P&L) — pulled from `autotrade_log`.

## Files touched

**New:**
- `supabase/functions/autotrader-scan/index.ts` (~600 lines, the orchestrator + entry/exit engines)
- `supabase/functions/autotrader-scan/win-exit.ts` (~150 lines, the 5-signal peak detector)
- `supabase/functions/autotrader-scan/loss-exit.ts` (~120 lines, thesis invalidation)
- `src/pages/AutotraderLog.tsx` (audit page)
- `supabase/migrations/<ts>_autotrader.sql` (schema only — settings table, log table, virtual_positions columns, trigger, RLS)

**Modified:**
- `src/pages/Settings.tsx` — add AutoTrader card
- `src/components/dashboard/TradingTab.tsx` — add status badge
- `src/App.tsx` — register `/autotrader-log` route

**Data ops (insert tool, not migration):**
- One-time wipe of `virtual_positions`, `virtual_portfolio_log`, `sell_alerts`, `signal_outcomes`
- `cron.schedule(...)` for `autotrader-scan` every 10 min during market hours

## What this fixes vs the example plan

- **Reuses `evaluateSignal()` for thesis re-check** — example re-implemented `computeWeeklyBias()` calls; we just call the canonical engine.
- **Extends `virtual_positions` instead of forking a `user_positions` table** — keeps Dashboard, Notification Center, and signal_outcomes wiring intact.
- **Cooldown lives on the closed position row** (`cooldown_until`), not a side table — simpler invalidation, one less table to keep in sync.
- **Market-hours-only cron schedule** — saves ~70% of edge-function invocations vs always-on every 10 min.
- **Single shared price cache per scan** across users — SPY and overlapping watchlist tickers are fetched once.
- **Paper-mode default** — no broker wiring required for v1; logic is broker-agnostic and the `paper_mode` flag is the only thing that gates real fills later.

## Out of scope for v1

- Real broker (Alpaca) integration — `paper_mode = true` is enforced
- Earnings-calendar guardrail (needs a paid data source)
- VIX-spike global pause (can ride on existing `market_sentiment.vix_value` in v2)
- Per-sector concentration cap inside autotrader (existing `portfolio-gate` already covers this for manual entries; v2 will call it from autotrader too)
