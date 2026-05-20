# Danelfin AI Score Integration

Danelfin is added as a **supporting conviction factor** — never a hard gate. It runs entirely in the background, nightly, and flows through every layer of the existing pipeline (signals, autotrader, UI, backtest) with small, calibrated weight so the adaptive weighting loop can tune it over time.

Given the free API tier (low rate limit, US-only, current scores only, no history), the design is rate-limit-safe and degrades gracefully when Danelfin is unavailable.

---

## 1. Secret + client

- Add runtime secret `DANELFIN_API_KEY`.
- New `supabase/functions/_shared/danelfin.ts`:
  - `getAiScore(ticker)` → `{ aiScore, technical, fundamental, sentiment, lowRisk, asOf } | null`
  - 6s timeout, in-memory 24h cache, returns `null` on any failure (mirrors `finnhub.ts` pattern).
  - `isDanelfinConfigured()` helper.

## 2. Database

New table `danelfin_scores` (nightly snapshot, one row per ticker per day):

```text
ticker        text       PK part 1
as_of         date       PK part 2
ai_score      int        1..10
technical     int        1..10
fundamental   int        1..10
sentiment     int        1..10
low_risk      int        1..10  nullable
updated_at    timestamptz
```

RLS: `No client access` (server-only, like `ticker_bars_cache`).

## 3. Nightly refresh cron

New edge function `refresh-danelfin-scores` (`verify_jwt = false`, cron-auth header):
- Pulls the union of: scan universe (last `scan_universe_log`), all watchlist tickers, all open `virtual_positions`.
- Throttles requests (free-tier safe: ~1 req/sec, batched).
- Upserts into `danelfin_scores` with today's `as_of`.
- Writes to `cron_heartbeat`.
- Scheduled via `pg_cron` at **22:30 ET on weekdays** (after US close + Danelfin's daily refresh).

## 4. Signal engine overlay (the core of the integration)

In `_shared/signal-engine-v2.ts`:
- New helper `loadDanelfinScores(tickers)` → `Map<ticker, score>`, loaded once per scan (not per-ticker).
- New conviction factor `danelfinFactor`:
  - Long: `+ (aiScore - 5) * 1.5` → range roughly `-6 … +7.5`
  - Short: `- (aiScore - 5) * 1.5`
  - Missing score → `0` (neutral, never blocks).
- Added to the existing weighted-sum conviction the same way every other factor is, so:
  - Adaptive weighting loop already tunes it via `strategy_tilts` / `regime_floors`.
  - Isotonic calibration sees it transparently.
  - Backtest ↔ live parity is preserved (same code path).
- `contributing_rules` JSON in `signal_outcomes` gets a `"danelfin": <delta>` entry, so we can later measure its incremental edge.

## 5. Autotrader (background-only, supporting)

Per your direction, **no hard gate**. Changes in `autotrader-scan/index.ts`:
- Danelfin score is already baked into `conviction` (via #4), so it influences:
  - Entry ranking (higher AI Score → higher conviction → preferred).
  - Capital rotation (#10 you added earlier) — rotation candidates with higher AI Score than incumbents become eligible.
  - Position sizing (Kelly fraction scales with conviction).
- Logged to `autotrade_log.reason` as `"… danelfinΔ=+4"` for transparency.
- No new Settings toggle. (We can add one later if you want to expose its weight.)

## 6. UI (Trading Hub)

Minimal, on-brand surface:
- Small "AI 8" sage-green badge on each signal card and each open position card.
- Hover/long-press → mini popover with the three sub-scores (T/F/S).
- Sortable column in the signals table on desktop.
- Hidden gracefully when score is missing.

No new page, no new tab.

## 7. Backtester

Free tier has **no historical scores**, so:
- Backtest reads `danelfin_scores` if a row exists for that `as_of` date, otherwise treats factor as `0`.
- Going forward, the nightly job builds up history naturally → backtests over recent windows gain the factor automatically.
- Documented in `autotrader_pipeline_and_math.md`.

## 8. Memory

Add `mem://architecture/prediction-engine/danelfin-overlay` describing: source, factor formula, neutral-on-miss behavior, free-tier constraints, and the rule that it must remain a supporting factor (not a gate).

---

## Technical notes

- **Rate limiting**: Free tier — refresh job batches with 1100ms delay between calls and a hard cap of ~300 tickers/night. Falls back to "skip" if budget exhausted; existing scores from yesterday are still served from `danelfin_scores` (max 7-day staleness allowed before treated as missing).
- **Edge function isolation**: per project rule, the Danelfin client lives in `_shared/danelfin.ts` and is duplicated into any function directory that needs it (signal-engine call sites already import from `_shared`).
- **No frontend secret**: all Danelfin calls happen server-side.
- **Cost guard**: if Danelfin returns 401/402/429 three times in a row in one job, the job exits early and writes `status='degraded'` to `cron_heartbeat`.

## Files touched

- new: `supabase/functions/_shared/danelfin.ts`
- new: `supabase/functions/refresh-danelfin-scores/index.ts`
- new migration: `danelfin_scores` table + RLS + cron schedule
- edited: `supabase/functions/_shared/signal-engine-v2.ts` (factor + loader)
- edited: `supabase/functions/autotrader-scan/index.ts` (log line only)
- edited: `supabase/functions/backtest/index.ts` (lookup, no-op on miss)
- edited: `src/components/dashboard/TradingTab.tsx` (badge + column)
- edited: `autotrader_pipeline_and_math.md`
- new memory: `mem://architecture/prediction-engine/danelfin-overlay`

## What you'll need to provide

- The `DANELFIN_API_KEY` value (I'll request it via the secret tool when you approve).
