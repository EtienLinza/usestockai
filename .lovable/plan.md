## Goal
Stop the autotrader from buying "fictional tops" at the daily-bar close. Move to a live intraday quote, only execute a small number of entries per scan, and reject any fill that's clearly off the previous close.

This is a combined fix: **(b) live quote** + **(c) stagger entries** + **(d) sanity check**.

---

## Changes

### 1. `fetch-stock-price` edge function — add live quote support
Currently uses `chart?interval=1d&range=5d`, which returns daily bars (during RTH the last bar is a moving "intraday last" but it's noisy and prone to single-tick spikes).

Switch the entry-pricing path to Yahoo's `quote` endpoint, which returns `regularMarketPrice` (the actual live last trade, ~15min delayed but tradable):
```
https://query1.finance.yahoo.com/v7/finance/quote?symbols=TICKER
```

Return both fields in the response so existing callers (chart UI, Dashboard logs) keep working with `latestPrice`, while new code can read `liveQuote`:
- `liveQuote` → `regularMarketPrice` (live)
- `previousClose` → `regularMarketPreviousClose` (for sanity check below)
- `latestPrice`, `priceHistory` → unchanged (still from the 5d daily chart)

### 2. `autotrader-scan` — use live quote as the entry fill
In `runEntryDecision` (around line 585) and `executeEntry` (line 1190+), replace `currentPrice = data.close[data.close.length - 1]` for **entry pricing only** with a fresh live quote fetched at the moment of execution.

Keep `data.close[last]` for indicator math (RSI, MACD, ATR) — those need a complete daily bar. Only the **fill price** and **hard stop** are recomputed against the live quote.

Implementation:
- Add a small `fetchLiveQuote(ticker)` helper inside `autotrader-scan` that calls the Yahoo quote endpoint directly (no need to round-trip through another edge function).
- Call it inside `executeEntry`, right after the `isMarketOpen()` gate.
- Recompute `hardStop` using the live price (so the stop is anchored to actual fill, not the stale daily close).

### 3. Sanity check — reject fills that diverge from previous close
Inside `executeEntry`, after fetching `liveQuote` and `previousClose`:
- Compute `gapPct = |liveQuote − previousClose| / previousClose`.
- If `gapPct > 8%`, log a `BLOCKED` row with reason `"Live quote diverges >8% from prev close ($X vs $Y) — possible bad tick or halt"` and return.

This catches Yahoo data glitches, halted stocks, and pre-market spikes that occasionally bleed into the RTH endpoint.

### 4. Stagger entries — cap new entries per scan
In `processUser` (around line 1004–1058), cap the number of new entries executed per single scan run to **2 per user** (configurable later if needed). Iterate the watchlist sorted by signal `conviction` descending so the strongest opportunities go first.

Implementation:
- Before the `for (const ticker of watchlist)` loop, compute `decisions[]` by running `runEntryDecision` for every eligible ticker first (cheap — math only, no DB writes).
- Sort `ENTER` decisions by `conviction` desc.
- Slice top 2 → execute those via `executeEntry`.
- Remaining `ENTER` candidates get logged as `HOLD` with reason `"Deferred — entry stagger cap (2/scan); will retry next cycle"` so the user can see them in the activity log.

This means the worst case is the bot opens 2 fresh positions every 10 minutes instead of 4–8 in a single tick. Over an hour that's still ~12 positions of headroom, but spread across very different price contexts.

### 5. Minor: persist `last_price` snapshot to `autotrade_log`
The `autotrade_log` row already records `price`. With the live quote in play, this becomes the actual fill price. No schema change needed — just make sure `executeEntry` writes the `liveQuote` into the `price` field (which it already does via `e.price`, now updated).

---

## Files touched
- `supabase/functions/fetch-stock-price/index.ts` — add `liveQuote` + `previousClose` to response
- `supabase/functions/autotrader-scan/index.ts` — `fetchLiveQuote` helper, swap entry price, sanity check, stagger cap

## Not touched
- Backtest engine (it correctly uses historical bars — no live concept exists there)
- Exit logic (already uses `data.close[last]` correctly for the EOD stop/peak math; intraday exits would be a separate, larger change)
- DB schema, RLS, cron schedule

## What this fixes
- **Entry slippage**: live quote ≈ tradable mid, not yesterday's close or an intraday spike
- **Single-tick concentration**: 2-per-scan cap spreads risk across multiple price contexts
- **Bad data fills**: 8% gap check kills obviously broken quotes before they cost real money
- **Stop placement**: hard stop anchored to actual fill, not stale data

## What this doesn't fix
- ~15min Yahoo quote delay (real-time would need a paid feed like Polygon/Tiingo)
- Intraday exit timing — exits still trigger at scan cadence on daily-bar logic
- Holiday calendar — `isMarketOpen()` is still weekday/hours only

After approval I'll implement, deploy both functions, and confirm with a test call on the next scan cycle.