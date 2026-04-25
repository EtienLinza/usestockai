# StockAI fix plan

Quick correction to my last audit: **MarketTab is not broken** (it reads live from the edge functions, not from those tables) and **per-position P&L already exists** in TradingTab. So the real issues are smaller and more focused than I made it sound. Here's everything worth fixing, ranked.

---

## 🔴 P0 — Security / cost

### 1. Lock down the `backtest` edge function
**Problem:** `backtest` has `verify_jwt = false` AND zero in-code auth check (no `getUser`, no `Authorization` header read). It calls Yahoo + heavy CPU and is publicly callable. Anyone with the URL can DoS it or run unlimited backtests on your dime.

**Fix:**
- Add the same `verifyAuth()` pattern that `stock-predict` already uses (Bearer token → `supabase.auth.getUser()` → 401 if invalid).
- Add a simple in-memory rate limit (10 backtests/min/user, mirroring `stock-predict`).
- Keep `verify_jwt = false` in `config.toml` (signing-keys system requires in-code check anyway).

### 2. Confirm `stock-predict` rate limit is actually wired
Already has `verifyAuth()` + rate-limit map — quick read-through to confirm it's invoked on every request path (the file is 2,591 lines so it's worth grepping).

---

## 🟡 P1 — Correctness

### 3. US market holiday calendar
**Problem:** `isMarketOpen()` in `autotrader-scan/index.ts` (line 813) only checks weekday + 9:30–16:00 ET. On Thanksgiving, Christmas, July 4, MLK Day, etc., the bot will try to trade and either get bad fills or stale data. Same gap in the new `usMarketStatus()` in `Settings.tsx`.

**Fix:**
- Create `supabase/functions/_shared/market-calendar.ts` with a hardcoded NYSE holiday list for 2025–2027 (full closures + early closes at 13:00 ET).
- Export `isMarketHoliday(date)` and update `isMarketOpen()` to consult it.
- Mirror the same list to a frontend `src/lib/market-hours.ts` (see #4) so the Settings countdown also skips holidays.

### 4. Move market-hours helpers into a shared lib
**Problem:** `usMarketStatus()` and `nextUsMarketOpen()` currently live inside `src/pages/Settings.tsx`. Other components (Dashboard countdown, MarketTab status badge) re-implement weaker versions.

**Fix:**
- Extract to `src/lib/market-hours.ts`.
- Update `Settings.tsx`, `MarketTab.tsx` (`getMarketStatus()` at line 32), and any other consumers to import from there.
- Single source of truth + holiday-aware everywhere.

---

## 🟢 P2 — Cleanup / hygiene

### 5. Drop the dead `market_sentiment` and `sector_performance` tables
**Problem:** Both tables are empty (0 rows) and nothing writes to them. The frontend reads live from `market-sentiment` and `sector-analysis` edge functions, which return JSON directly. The tables are leftover schema from an earlier "cache to DB" design.

**Fix:**
- Migration: `DROP TABLE public.market_sentiment` and `DROP TABLE public.sector_performance`.
- No code changes needed (nothing references them — confirmed via grep).
- Optional alternative: keep them and have the edge functions UPSERT a snapshot on each call so you get a free historical record. **I'd lean drop unless you want the history.**

### 6. Per-scan watchdog: update `next_scan_at` even on early-exit
**Problem:** When `autotrader-scan` early-exits because the market is closed, it doesn't update `next_scan_at`. That's why your dashboard countdown was showing stale "10 hours" earlier.

**Fix:** In the early-exit branch (around line 1250 in `autotrader-scan/index.ts`), still write `next_scan_at = now() + scan_interval_minutes` and `last_scan_at = now()` with a note like `"skipped: market closed"`. Now the UI countdown is always meaningful.

---

## ⚪ P3 — Optional / not urgent (skip unless you want it)

- **Refactor `stock-predict/index.ts`** (2,591 lines → split into `auth.ts`, `indicators.ts`, `ai-prompts.ts`, `index.ts`). Pure code-health, no functional change. Risky to do in one shot — would defer.
- **Real-time data feed** (Polygon/Tiingo to replace 15-min-delayed Yahoo). Costs $$ — only worth it if/when going live with real money.
- **Intraday exit triggers** (move from daily-bar exits to bar-by-bar). Larger architectural change; tied to real-time feed above.

---

## What I'll touch

| File | Change |
|---|---|
| `supabase/functions/backtest/index.ts` | Add `verifyAuth()` + rate limit (P0) |
| `supabase/functions/_shared/market-calendar.ts` | **New** — NYSE holidays (P1) |
| `supabase/functions/autotrader-scan/index.ts` | Use holiday helper; update `next_scan_at` on skip (P1, P2) |
| `src/lib/market-hours.ts` | **New** — shared status + holidays (P1) |
| `src/pages/Settings.tsx` | Import from shared lib (P1) |
| `src/components/dashboard/MarketTab.tsx` | Import from shared lib (P1) |
| `supabase/migrations/<new>.sql` | Drop `market_sentiment`, `sector_performance` (P2) |

No backend schema changes beyond the two drops. No data loss (both tables are empty).

---

## Order I'd ship

1. Lock down `backtest` (5 min, biggest risk reduction)
2. Holiday calendar + shared market-hours lib (15 min, fixes the "bot trades on Thanksgiving" foot-gun)
3. Fix `next_scan_at` on early exit (2 min, fixes the misleading countdown for real)
4. Drop dead tables (1 migration)

Want me to proceed with all four, or pick a subset?