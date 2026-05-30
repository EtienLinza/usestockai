# Next Fix Batch — Quant Correctness + Infra

Building on the security/correctness pass already shipped. This batch tackles the remaining **Critical quant bugs** and **High-impact infra** items from the 97-issue audit.

## A. Quant correctness (Critical)

### 1. Survivorship bias in backtest universe (#4)
**Problem:** Backtest pulls today's S&P 500 constituents → win-rates inflated because delisted/failed names never appear.
**Fix:**
- Add `historical_constituents` table: `(ticker, index_name, start_date, end_date)`.
- Seed with point-in-time S&P 500 membership (use a static snapshot file checked into `supabase/functions/_shared/sp500-history.json` — small, ~10KB).
- `backtest` and `walk-forward` resolve universe per-date from this table instead of today's CSV.
- Add `survivorship_adjusted: true` flag in result payload so UI can label runs.

### 2. Look-ahead bias — same-bar close entry (#1, #2, #3)
**Problem:** Signal computed on bar `T` close, then "filled" at bar `T` close → uses information that wouldn't exist at decision time.
**Fix in `_shared/signal-engine-v2.ts` + `backtest`:**
- Shift entry to bar `T+1` open (or `T+1` close as fallback when open missing).
- Same shift for exits triggered by indicator flips.
- Hard-stop/take-profit intrabar fills stay on bar `T+1` (use bar high/low, not close — see #3).
- Add `executionModel: 'next_open' | 'next_close'` to backtest config; default `next_open`.

### 3. Stop-loss P&L understated (#21)
**Problem:** Hard stops fill at end-of-day close, so a stop hit at 10am gives you the 4pm price.
**Fix:** When `bar.low <= hardStop` (long) or `bar.high >= hardStop` (short), fill at `hardStop` price exactly. Same for take-profit using `bar.high`/`bar.low`.

### 4. Double vol-scaling (#25)
**Problem:** Position size = `kellyFraction × spyVolScalar × atrScalar` — SPY vol is already embedded in per-name ATR for most tickers, so we shrink twice in high-vol regimes.
**Fix in `vol-target-sizing.ts`:** Use **either** SPY scalar (for index/ETF positions) **or** per-name ATR scalar (for single names). Pick by `assetType`. Add unit test asserting product never multiplies both.

### 5. ATR units bug (#23)
**Problem:** ATR fallback returns dollar amount instead of percent → divisor becomes huge → position size collapses to near-zero shares.
**Fix:** Audit `computeATR` / `atrPct` helpers in `_shared/indicators.ts`. Standardize on `atrPct = atr / price`. Add guard `if (atrPct > 1) atrPct = atrPct / price` defensive fallback + log warning.

### 6. Kelly is a linear ramp, not Kelly (#17)
**Problem:** `kellyFraction = (conviction - 50) / 50` is just a ramp; no edge/odds math.
**Fix:** Real fractional Kelly:
```
edge = winRate × avgWin - (1 - winRate) × avgLoss
kelly = edge / (avgWin × avgLoss)
fraction = clamp(0.25 × kelly, 0, 0.20)  // quarter-Kelly, capped 20%
```
Source `winRate`, `avgWin`, `avgLoss` from `signal_outcomes` calibration buckets (already exist via isotonic calibration). Fall back to conviction-ramp only when sample size < 30.

## B. Infra (High impact)

### 7. Move Finnhub in-memory caches to Postgres (#22, #23 ops)
**Problem:** Each edge-function cold start re-fetches every ticker → O(users × tickers) Finnhub calls → 429 storms.
**Fix:**
- New table `finnhub_quote_cache(ticker PK, quote jsonb, fetched_at)`.
- `_shared/finnhub.ts` reads cache (TTL 60s for quotes, 1h for profiles), writes-through on miss.
- Service-role only; RLS denies all client access.

### 8. `send-alert-email` IDOR (#F-03 — leftover)
**Fix:** Already partially audited; ensure `userId` is derived from JWT only, never from request body. Reject if missing.

### 9. `clear-signals` anon-key auth (#F-from-audit)
**Fix:** Require `x-cron-secret` header matching `CRON_SECRET`; reject otherwise.

### 10. `check-price-alerts` serial loop + no idempotency (#F-29)
**Fix:**
- Add unique partial index on `price_alerts(id) WHERE triggered_at IS NOT NULL` (already triggered → no double-fire).
- Process in `Promise.all` chunks of 10.
- Set `triggered_at` atomically with `UPDATE ... WHERE triggered_at IS NULL RETURNING id`; only send email on rows we won.

### 11. `aggregateToWeekly` UTC weekday bug (#low)
**Problem:** Uses UTC `getDay()` → Monday US bars (after midnight UTC Sunday) roll into prior week.
**Fix:** Compute weekday in ET via `etDayOfWeek()` helper before bucketing.

## C. DB migrations needed

1. `historical_constituents` table + seed
2. `finnhub_quote_cache` table
3. Unique partial index on `price_alerts(id) WHERE triggered_at IS NOT NULL`

## Out of scope (defer to next round)

- `payments-webhook` `checkout.session.completed` (waiting on answer: do you sell one-time products? If no, just log+ignore).
- `autotrader-scan` 2,316-line refactor (architectural, not a bug).
- `bars-cache` `as_of` filter (low impact).
- Stress-test cron-secret rotation across all 12 cron functions (separate hardening pass).

## Open question

**Survivorship seed data:** OK to bootstrap with a static S&P 500 membership JSON I commit (covers 2010→today, ~500 add/drop events)? Or do you want me to skip backtest survivorship for now and only ship items 2–11?
