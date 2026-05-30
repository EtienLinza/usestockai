## Goal
Fix the highest-impact security and correctness issues from the audit. Focus on the 5 Criticals + Top 10 quick wins, grouped by area.

## Scope

### A. Edge function security (critical)
1. **`refresh-danelfin-scores` auth bypass** — current guard only rejects when `CRON_SECRET` is set AND mismatched. Flip to reject when secret is unset OR provided header missing/mismatched. Apply same pattern audit to other cron functions (`calibrate-weights`, `check-price-alerts`, `weekly-digest`, `market-scanner`, `scan-orchestrator`, `clear-signals`).
2. **Stripe webhook signature timing attack** — `payments-webhook` / `_shared/stripe.ts` uses `v1Signatures.includes(expected)`. Replace with constant-time compare (byte-wise XOR over equal-length buffers).
3. **Finnhub API key in URL query string** — move `token=` from query to `X-Finnhub-Token` header in `_shared/finnhub.ts` (and any direct call sites) so it stops appearing in edge logs.
4. **Stripe `checkout.session.completed` not handled** — one-time purchases never unlock features. Add handler in `payments-webhook` that, for `mode === "payment"` sessions, records the purchase (insert into `subscriptions` with a synthetic id, or new `one_time_purchases` table — see Open question 1).
5. **Backtest quota TOCTOU race** — replace read-then-write in `backtest/index.ts` with an atomic Postgres RPC `increment_backtest_usage(user_id, month_key, limit)` that does `UPDATE ... WHERE backtests_run < limit RETURNING ...` and returns null when over quota.

### B. Edge function security (high — same pass)
6. **`send-alert-email` IDOR** — stop accepting `userId` from body; require JWT and derive from `auth.getUser(token)`.
7. **`payments-webhook` env from query param** — keep `?env=` but additionally cross-check the Stripe signature against the matching secret (already does); reject if Stripe livemode flag on event disagrees with `env`.
8. **`clear-signals` anon-key auth** — require `x-cron-secret` (use `requireCronOrUser` from `_shared/cron-auth.ts`).
9. **`news-sentiment`, `market-sentiment`, `sector-analysis` unauthenticated** — add `requireCronOrUser({ allowAuthenticatedUser: true })` so anon can't hammer them; keep `verify_jwt = false` so authed users still work.
10. **`health-check` service-role exposure** — switch to anon key + restrict response to non-sensitive boolean health flags.

### C. Quant correctness (top wins)
11. **Static Sharpe annualization + Sortino denominator** — `_shared/signal-engine-v2.ts` (or wherever metrics live): use `Math.sqrt(252)` constant; Sortino downside std must divide by count of negative returns, not `N`.
12. **DST-correct ET conversion** — replace hardcoded `-4` offsets with shared `etMinuteOfDay()` helper that uses `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' })`. Apply across `market-calendar.ts`, scanners, premarket cron sites.
13. **`signal_outcomes` upsert** — change `.insert` → `.upsert({ onConflict: 'signal_id' })` (requires unique index on `signal_id`, included in migration).

## Out of scope this pass
- Survivorship bias rewrite (#4) — needs historical S&P 500 constituent dataset; large project.
- Look-ahead bias on same-bar entries (#1-3) — requires bar-shift refactor across engine + backtest.
- Double vol-scaling, ATR-units bug, Kelly rewrite — bundled for a follow-up "quant correctness v2" pass.
- Finnhub cache migration to Postgres — follow-up.
- `autotrader-scan` monolith refactor.

## Technical details

**Migrations needed (single file):**
- `CREATE UNIQUE INDEX IF NOT EXISTS signal_outcomes_signal_id_uniq ON signal_outcomes(signal_id) WHERE signal_id IS NOT NULL;`
- `CREATE OR REPLACE FUNCTION public.increment_backtest_usage(_user_id uuid, _month_key text, _limit int) RETURNS int` — atomic upsert + bounded increment, returns new count or `-1` if over limit. `SECURITY DEFINER`, grant EXECUTE to `authenticated`.
- (If we go with new table for option B in Open Q1) `CREATE TABLE public.one_time_purchases (...)` + GRANTs + RLS.

**Files touched (estimated):**
- `supabase/functions/_shared/stripe.ts` — constant-time compare
- `supabase/functions/_shared/finnhub.ts` — header auth
- `supabase/functions/_shared/cron-auth.ts` — fix unset-secret bypass
- `supabase/functions/_shared/market-calendar.ts` — DST helper (likely already exists; verify)
- `supabase/functions/_shared/signal-engine-v2.ts` — Sharpe/Sortino
- `supabase/functions/refresh-danelfin-scores/index.ts`
- `supabase/functions/payments-webhook/index.ts`
- `supabase/functions/backtest/index.ts`
- `supabase/functions/send-alert-email/index.ts`
- `supabase/functions/clear-signals/index.ts`
- `supabase/functions/news-sentiment/index.ts`
- `supabase/functions/market-sentiment/index.ts`
- `supabase/functions/sector-analysis/index.ts`
- `supabase/functions/health-check/index.ts`
- Any callers of `signal_outcomes.insert`
- Any sites still using hardcoded `-4` ET offset

## Open questions
1. **One-time purchases**: do you sell any one-time products today, or is it 100% subscriptions? If subscriptions only, I'll just log+ignore `checkout.session.completed` and skip the new table. If you sell one-offs (or plan to), I'll add a `one_time_purchases` table.
2. **Order**: ship all of A+B+C as one PR, or split into (1) security pass (A+B) then (2) quant correctness (C)?

Once you answer those (or say "ship all, subs only"), I'll switch to build mode and execute.
