# Portfolio-Mode Backtest — Brainstorm

Goal: let users backtest the same way we trade live — scan a universe every "day", run the full autotrader gate stack (conviction, reversal-risk, ATR envelope, sector/beta caps, portfolio heat, CVaR, correlation), open/manage/exit positions with the R-ladder — over multi-year windows. Long runtimes are OK; **completion** is the requirement.

The current single-ticker `backtest` function already dies on 5y × 2 tickers. A portfolio sim over 500 tickers × 5y in one edge call is not physically possible under the 400 s / worker-memory limits. So the whole design has to be about **splitting the work** so no single invocation exceeds the limit, and **caching** so we don't recompute the expensive parts.

## The real cost drivers (what actually blows up)

1. **Bar fetches** — Yahoo history for N tickers × Y years. Network-bound, not CPU. Solve once, reuse forever.
2. **Per-bar signal evaluation** — `evaluateSignal` over the whole universe per day. This is the CPU killer: ~500 tickers × 1260 days × ~2 ms = ~20 min pure compute.
3. **Portfolio gates per candidate day** — CVaR base rebuild, correlation matrix, sector/heat math. Cheap per-call, but multiplied by open-book churn.
4. **Trade-management ticks** — R-ladder / trailing stop / gap-trim per open position per bar. Small but non-trivial across long windows.

Wall-clock isn't the enemy — **per-invocation CPU** and **memory ceiling** are.

## Four architecture options

### Option A — Job queue with a coordinator + day-shard workers (recommended)

Split the backtest into three tiers, mirroring the live scan pipeline:

```text
[client] → backtest-portfolio-start (create job row, seed universe, return job_id)
              │
              ├── prefetch-bars-batch (chunked; writes ticker_bars_cache_backtest)
              ├── precompute-signals (day-shard: N days per invocation, writes signal_shard rows)
              └── simulate-portfolio (walks days in order, reads pre-computed signals,
                                     runs gates + trade mgmt, persists state after each chunk)

[client] polls backtest-status(job_id) → progress %, partial metrics, final report
```

Each stage checkpoints to a `backtest_jobs` / `backtest_state` table. Any invocation that runs out of CPU just returns "chunk done", the coordinator (pg_cron or a lightweight self-invoking edge function) picks up the next chunk. No single call exceeds its budget; the *job* takes as long as it needs.

Key properties:
- **Resumable.** Kill an invocation mid-shard → next tick continues from checkpoint.
- **Cacheable.** Bars + pre-computed signals for date D and ticker T are deterministic given the engine version. Hash the engine version; reuse across users.
- **Observable.** User sees a real progress bar, ETA, "currently simulating 2023-04-11", cancel button.
- **Cost-scoped.** Elite tier gets unlimited window; free/pro capped by shard budget.

### Option B — Client-driven chunked simulation (no long server calls)

The browser is the coordinator. It calls a stateless `backtest-chunk` edge function with `{state, dateRangeStart, dateRangeEnd}` where the chunk is small enough (say 20 trading days) to always fit in the CPU budget. The function returns the updated portfolio state; the client loops until done and renders the final report.

Pros: dead simple, no new tables, works today. Zero server orchestration.
Cons: user must keep the tab open; state blobs get big; harder to share/persist a completed run.

### Option C — Vectorized offline pre-compute + fast sim

One-time (per engine version) job: pre-compute every signal for every ticker for every day into `historical_signals_cache(ticker, date, conviction, decision, atr_pct, ...)`. Then the actual "backtest" is just a small function that reads pre-computed signals for the date range and simulates portfolio gates + trade management — cheap enough to fit in one invocation for reasonable universes.

Pros: near-instant repeat backtests (great UX for parameter sweeps).
Cons: big upfront batch (needs the queue from Option A to build it); cache invalidates on any engine change.

### Option D — External compute

Run the sim in a Cloud Run / Fly.io / self-hosted container triggered by an edge function. No CPU limit at all. But: new infra, new secrets, new billing surface, and we lose the "everything in Lovable Cloud" property.

## Recommendation

**Ship Option A, and use its infrastructure to enable Option C later.**

Option A gives us:
- Real portfolio backtests today (long-running but reliable).
- The `historical_signals_cache` table falls out naturally from the "precompute-signals" stage — that's Option C for free the next day.
- Clean progress/cancel UX for the disclaimer flow you mentioned.

## Rough shape (technical section)

Data model:
- `backtest_jobs(id, user_id, params_json, universe[], status, progress_pct, current_date, cpu_ms_spent, created_at, finished_at, error)`
- `backtest_state(job_id, positions_json, cash, nav_history_json, open_risk, cvar_base_json, checkpoint_date)`
- `historical_signals_cache(ticker, engine_version, date, conviction, decision, atr_pct, strategy, profile, regime, extras_json)` — global (unique on ticker+engine_version+date), so cache hits across users.
- Reuse existing `ticker_bars_cache` for bars.

Functions:
- `backtest-portfolio-start` — validate params, create job, enqueue first chunk.
- `backtest-portfolio-tick` — the workhorse; picks the next unfinished stage/chunk for one job and runs until ~200 s of CPU, then checkpoints and returns. Re-invoked by pg_cron every N seconds while jobs are `running`.
- `backtest-portfolio-status` — read-only, returns progress + partial equity curve for the UI.
- `backtest-portfolio-cancel` — flip status.

Simulation loop reuses the existing engine directly:
- Bar loop uses `evaluateSignal` from `_shared/signal-engine-v2.ts` (same code path as live).
- Gate stack imports the exact helpers from `autotrader-scan` (extract `computeEntryGuardEnvelope`, `assessReversalRisk`, sector/beta/heat/CVaR/correlation checks into `_shared/portfolio-gates.ts` — a refactor step so live and backtest share one implementation).
- Trade management: same R-ladder + gap-trim + trailing stop code, again lifted to `_shared/trade-manager.ts`.

That refactor is the meat of the work — the backtest becomes "loop through days, call the same functions live uses" instead of a parallel implementation that drifts.

UI:
- New "Portfolio Backtest" tab on `Backtest.tsx` with universe picker (S&P 500 / Nasdaq 100 / custom watchlist), date range, disclaimer "This may take X-Y minutes", start button.
- Progress card polls status every 3 s, shows current date + partial equity curve.
- Report reuses existing Recharts components once done.

## Open questions

1. **Universe scope** — should the default be S&P 500, Nasdaq 100, current watchlist, or user-defined?
2. **Cache reuse** — happy for pre-computed signals to be shared across all users (same engine version), or keep per-user?
3. **Cancel/replay** — do you want completed backtests archived (viewable later) or ephemeral?
4. **Trigger cadence** — pg_cron every 10 s for the tick function, or self-invoke chain (function re-invokes itself when a chunk finishes)?
