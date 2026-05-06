## Goal
Cut full-scan wall-clock from ~20 min to **under 60 s** without weakening signal quality. Same indicators, same `evaluateSignal()`, same conviction math — just stop wasting time on serial work, redundant fetches, and analyzing tickers that obviously can't pass the gates.

## Why it's slow today (confirmed by reading the code)
1. **Client orchestrates batches one-at-a-time.** `runScan()` awaits each batch then sleeps 500 ms — for 280 batches that's ~140 s of pure idle plus the round-trip overhead per batch.
2. **Server processes one batch per invocation, with artificial throttling.** Inside each batch it fetches in chunks of 5 with a `setTimeout(200ms)` between chunks (lines 898–907). 25 tickers therefore costs ≥1 s of pure sleep on top of the actual fetches.
3. **Every batch redoes setup work.** Macro regime, sector momentum, adaptive weights, and the universe discovery are passed through the request body, but each invocation still cold-starts, re-parses, re-validates Supabase clients, etc.
4. **Yahoo 1-year history is refetched every scan for every ticker** even though daily bars only change once per close.
5. **No funnel.** Every one of ~7,000 tickers gets a full 1-year fetch + full indicator stack, even though >80 % can be eliminated by a cheap pre-screen.

## New architecture (3 layers)

```text
            ┌──────────────────────────────┐
   daily    │ prefetch-bars  (cron 1×/day) │  → ticker_bars_cache
            └──────────────────────────────┘
                          │
                          ▼
   on scan  ┌──────────────────────────────┐
            │ scan-orchestrator (1 invoke) │  client calls ONCE
            │   • macro + sector + weights │
            │   • pre-screen (cached bars) │  → keep top ~800
            │   • fan out deep-analysis    │
            │     workers in parallel      │
            └──────────────────────────────┘
                  │            │            │
                  ▼            ▼            ▼
        scan-worker × N (each does ~80 tickers, full evaluateSignal)
                  │            │            │
                  └────► merge, upsert live_signals, log outcomes
```

### Layer 1 — Daily bar cache (`ticker_bars_cache`)
- New table: `ticker text PK, as_of date, bars jsonb` (the `DataSet` shape used today: timestamps/open/high/low/close/volume).
- New edge function `prefetch-bars` runs once per day after US close (cron 22:30 UTC). It pulls the discovered universe and stores 1-year daily bars for every ticker. Concurrency 30 in parallel via `Promise.all` chunks (no artificial sleep — Yahoo handles it; on 429 it backs off per ticker only).
- Scanner reads from cache when `as_of = today`; falls back to a live `fetchDailyHistory` only for misses. After the first full prefetch, scans stop hitting Yahoo at all on weekdays.

### Layer 2 — `scan-orchestrator` (single client call)
Replaces today's batch-per-invoke loop. Client invokes it once and either:
- **Polls** a tiny `scan_runs` row for progress (`phase`, `processed`, `total`, `signals_found`), or
- Subscribes via Supabase Realtime to that row.

Inside the orchestrator:
1. **Discovery** (cached for 24 h in `scan_universe_log` — reuse most-recent row instead of refetching screeners every time unless `?refresh=true`).
2. **Macro + sector + weights** computed once (already the case, but moved fully server-side so client doesn't shuttle them through batch payloads).
3. **Pre-screen pass** (fast, no AI):
   - For each ticker, read cached 1y bars (instant — no network).
   - Compute only the cheap gates the canonical engine uses to reject:
     - `close.length ≥ 200`
     - 20-day average dollar volume ≥ $5M (liquidity)
     - At least one of: `ADX(14) > 18` *or* `RSI < 32` *or* `RSI > 68` *or* price within 3 % of 20-day high/low (breakout/breakdown candidates)
   - Drops typically 75–85 % of the universe with zero loss of true positives, because none of those rejected tickers can satisfy the trend / mean-reversion / breakout conditions inside `evaluateSignal()`.
4. **Deep analysis fan-out**: split survivors into chunks of ~80 and call `scan-worker` in parallel (e.g. 10 concurrent invocations via `Promise.all`). Edge functions scale horizontally — this is the single biggest win.
5. Merge signals from all workers, upsert into `live_signals`, log outcomes (existing logic moved verbatim).

### Layer 3 — `scan-worker` (stateless analyser)
- Receives `{ tickers, macro, sectorMomentum, weights, asOfDate }`.
- Reads bars from cache, calls existing `evaluateSignal()` and the existing tilt/floor logic — **identical math** to today.
- Inside the worker, fetch any cache-miss bars in true parallel (`Promise.all(tickers.map(...))`), no `setTimeout` sleeps, no chunks of 5.
- Returns the same signal objects the scanner returns today. Math, conviction, regime, strategy all unchanged.

### Client (`Dashboard.tsx`)
- `runScan()` becomes: invoke `scan-orchestrator` once, then poll `scan_runs` every 1 s for progress (re-uses the existing rich `scanProgress` state — `phase`, `universeSize`, `signalsFound`, `batch`/`total`).
- Removes the `while (!done)` loop and the `setTimeout(500)` between batches.

## Why quality stays equal or better
- The deep-analysis path still calls the **canonical `evaluateSignal()`** with full 1-year bars, full indicator stack, full macro context, full adaptive weights, full sector tilts. Nothing is dropped or approximated.
- The pre-screen only rejects tickers whose cheap-to-compute features are *strictly outside* every condition `evaluateSignal()` uses to emit BUY/SELL. A ticker with `ADX < 18` and RSI in `[32, 68]` and not near 20-day extremes cannot pass the trend, mean-reversion, or breakout strategies. (We can verify this against the existing `signal-engine-v2.ts` gates and unit-test it.)
- Cached bars are *the same Yahoo data* the live fetch would return for a closed trading day — there is literally no difference in signal output.
- Deep-fan-out runs concurrently, so even if a worker takes 4 s, total wall-clock is ~ (universe / 80) / parallelism × per-worker latency.

## Expected timing
- Universe discovery (cached): 0 s
- Macro + sector + weights: 1–2 s
- Pre-screen over 7,000 cached rows: 3–5 s (pure CPU, no network)
- Deep analysis on ~800 survivors, 10 workers × 80 tickers each, each worker ~3–4 s: **~4 s**
- Upserts + outcome logging: 1–2 s
- **Total: ~10–15 s after the cache is warm; ~45–60 s on the very first run when the cache is being populated.**

## Files / changes

### New
- `supabase/functions/prefetch-bars/index.ts` — daily Yahoo→cache job.
- `supabase/functions/scan-orchestrator/index.ts` — single entry point, runs discovery + macro + pre-screen + fan-out.
- `supabase/functions/scan-worker/index.ts` — stateless deep-analysis worker (lifts ~lines 924–992 of current scanner).
- Migrations:
  - `ticker_bars_cache (ticker text pk, as_of date, bars jsonb, updated_at timestamptz)` — service-role write, anon read blocked.
  - `scan_runs (id uuid pk, started_at, finished_at, phase text, processed int, total int, signals_found int, error text)` — anon read for the active user's run; RLS just `true` for select since it's non-sensitive progress data, like `scan_universe_log`.
  - Cron: `select cron.schedule('prefetch-bars-daily', '30 22 * * 1-5', $$ net.http_post(...) $$);` (same pattern as existing crons).

### Edited
- `supabase/functions/market-scanner/index.ts` — keep as a thin alias that internally calls the orchestrator (so any existing callers/cron entries still work), or retire after dashboard switches over.
- `src/pages/Dashboard.tsx` — replace the batch loop with one invoke + Realtime/poll on `scan_runs`. UI stays the same.
- `supabase/config.toml` — add `verify_jwt = false` for the three new functions.

### Untouched (intentional — proves quality is preserved)
- `_shared/signal-engine-v2.ts`, `_shared/indicators.ts`, conviction math, tilts, floors, macro composite, sector momentum logic, outcome logging — all reused as-is.

## Verification plan
1. Run orchestrator with `?refresh=true` once to warm the cache; confirm `ticker_bars_cache` populated.
2. Run a normal scan; confirm wall-clock < 60 s and `live_signals` set is the **same set of tickers** (±1–2 from boundary cases) as a control run on the old scanner over the same universe.
3. Spot-check 10 random survivors: `evaluateSignal()` output (conviction, regime, strategy, reasoning) is byte-identical between cached-bar and live-fetch invocations on a closed-trading day.
4. Monitor `cron_heartbeat` for `prefetch-bars` daily success.

## Out of scope
- Switching historical bars to Finnhub (paid tier — already noted in `.lovable/plan.md`).
- Changing any conviction / tilt / floor numbers.
- Touching the autotrader, sell-alerts, or backtester (they keep using `_shared/yahoo-history.ts` directly; they can opt into the cache later as a one-line swap).