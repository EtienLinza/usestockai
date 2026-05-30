
# Final Fix Batch — Remaining Audit Items

Building on what already shipped (survivorship table, intrabar execution opt-in, vol-scaling guard, Finnhub Postgres cache, atomic price-alert claim, IDOR fix, ET weekday bug, ATR guard). This batch closes the rest of the 97-issue audit.

## A. Quant correctness (finish what was started)

1. **Make intrabar execution the default** in `backtest/index.ts`. Flip `executionModel` default from `legacy` → `intrabar`. Keep `legacy` as opt-in for A/B. Stamp `executionModel` into the result payload so the UI can label runs.

2. **Look-ahead bias on entries (#1, #2)** — currently still fills at bar `T` close in both live engine and backtest. Shift entries to `T+1 open` (fallback `T+1 close`) under the same `intrabar` flag. Indicator-flip exits also shift to `T+1`.

3. **Real Kelly sizing (#17)** in `_shared/signal-engine-v2.ts` `computePositionSize`:
   ```
   edge = winRate*avgWin - (1-winRate)*avgLoss
   kelly = edge / (avgWin*avgLoss)
   fraction = clamp(0.25*kelly, 0, 0.20)
   ```
   Pull `winRate`, `avgWin`, `avgLoss` from `signal_outcomes` calibration buckets passed via `weights`. Fall back to the existing conviction-ramp when sample size < 30.

4. **Survivorship-aware backtest universe (#4 part 2)** — wire `constituents_as_of('SP500', bar_date)` into `backtest` universe resolution when `universe = 'sp500'`. Stamp `survivorship_adjusted: true` in result payload.

5. **Double vol-scaling default** — flip `applyVolScaling` default off for single names when portfolio-level SPY scalar is already applied; keep on for index/ETF.

## B. Infra / security (remaining)

6. **`clear-signals` anon-key auth** — require `x-cron-secret` via shared `requireCronOrUser` (currently the audit flagged it as accepting anon key). Same hardening pass on any cron function still missing it: `weekly-digest`, `calibrate-weights`, `prefetch-bars`, `refresh-danelfin-scores`. Audit each, add `requireCronOrUser` where missing.

7. **`payments-webhook` `checkout.session.completed`** — user confirmed subscription-only. Log and ignore the event explicitly (no error, no silent miss) and add a comment documenting the decision.

8. **`bars-cache` `as_of` filter** — current cache lookup ignores `as_of`, so stale bars can leak into fresh scans. Add `as_of >= today_et()` predicate on read; backfill writes already stamp `as_of`.

9. **`autotrader-scan` quick wins** — defer the 2,316-line refactor, but extract the two clearest bugs surfaced in the audit (duplicated stop math, unawaited promise in the rotation branch) into targeted fixes. No structural change.

10. **`scan-worker` Danelfin lookup** — currently uppercases ticker on read but not on write; normalize at the orchestrator boundary so a single source of truth.

## C. DB migrations needed

- None new. All tables (`historical_constituents`, `finnhub_cache`, `claim_price_alert` RPC) already exist.
- One data backfill: seed `historical_constituents` add/drop events 2010→today (currently only holds today's 503 rows). Will commit a static JSON under `supabase/functions/_shared/sp500-history.json` and a one-shot `insert` migration.

## Out of scope (explicitly deferred)

- Full `autotrader-scan` architectural refactor.
- Cron-secret rotation across all 12 cron functions (separate hardening pass).
- Replacing `signal-engine-v2` duplicated indicator math with a shared package (Deno edge-function isolation makes this non-trivial; current replication is intentional).

## Open question

For item 4 (survivorship): the table currently has only **today's** 503 rows. To make the backtest actually survivorship-adjusted I need to seed historical add/drop events. **OK to commit a static `sp500-history.json` covering 2010→today (~500 events, ~12KB)?** If you'd rather defer, I'll ship items 1–3 and 5–10 and leave the universe resolution behind a `survivorship: false` default until the seed lands.
