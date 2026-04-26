## Goal
Make Finnhub the **primary live-quote source across the entire backend**, with Yahoo retained only where Finnhub's free tier doesn't expose the data (historical daily candles, predefined screeners). Centralize all data access through `_shared/finnhub.ts` so future swaps are one-file changes.

## Honest constraint (free-tier reality)
Finnhub's free tier does **not** include `/stock/candle` (historical OHLCV) or screeners. Yahoo therefore must remain for:
- **1-year daily candles** — used by autotrader-scan, check-sell-alerts, market-scanner, portfolio-gate, sector-analysis, backtest
- **Predefined screeners** — used by market-sentiment (trending) and market-scanner (discovery batch 0)

Everywhere else (single live quote, prev close, market state, news, fundamentals) Finnhub becomes primary.

## Changes

### 1. Expand `_shared/finnhub.ts`
Add two thin helpers so every function can drop its inline Yahoo quote fetcher:
- `getLiveQuote(ticker)` — already exists as `getQuote`, just re-exported under a clearer name with `{ price, previousClose, changePct }` shape.
- `getQuoteWithFallback(ticker)` — tries Finnhub, falls back to Yahoo intraday meta (`/v8/finance/chart?interval=1m&range=1d`). Returns `{ price, previousClose, marketState, source }`. This is the new universal live-quote entry point.

### 2. Edge functions to refactor (live-quote sites)
Replace inline Yahoo fetchers with `getQuoteWithFallback`:

| Function | What changes |
|---|---|
| `check-price-alerts` | `fetchCurrentPrice` → `getQuoteWithFallback().price` |
| `check-sell-alerts` | Inline live quote inside the alert-check loop → `getQuoteWithFallback`. Historical 1y candles stay on Yahoo (needed for ATR/trailing-stop math). |
| `autotrader-scan` | `fetchLiveQuote` → `getQuoteWithFallback`. The 1y candle fetch stays on Yahoo. |
| `market-sentiment` | Index quote (SPY/QQQ/etc) → `getQuoteWithFallback`. Screener calls stay on Yahoo. |
| `portfolio-gate` | Live price → `getQuoteWithFallback`. Historical bars stay on Yahoo. |
| `fetch-stock-price` | Already split; keep as-is (Finnhub primary, Yahoo fallback for quote, Yahoo for 5d candles). |

### 3. Edge functions where nothing changes
- `backtest` — pure historical-only; no live quote needed.
- `sector-analysis` — historical sector ETF candles only.
- `market-scanner` — already calls `fetch-stock-price` indirectly + uses Yahoo screener for discovery.
- `news-sentiment` — already on Finnhub.

### 4. Shared candle helper (light refactor)
Extract the duplicated `fetchYahooData` (1y daily candles) into `_shared/yahoo-history.ts` with one canonical implementation used by autotrader-scan, check-sell-alerts, portfolio-gate, market-scanner, and sector-analysis. This isn't strictly Finnhub work but it's the right time to deduplicate, and it makes a future paid-tier upgrade to Finnhub candles a single-file swap.

### 5. Optional: fundamentals enrichment in `autotrader-scan`
When evaluating a candidate, opportunistically pull `getFundamentals(ticker)` (PE, beta, market cap, industry) and attach to `autotrade_log.reason`. Cheap context for the user without changing signal math.

## Out of scope (intentionally)
- **Replacing Yahoo historical candles with Finnhub `/stock/candle`** — paid tier only. If you upgrade, the `_shared/yahoo-history.ts` module is the single swap point.
- **Replacing Yahoo screener** — no free-tier equivalent.
- **Changing signal-engine math** — purely a data-source refactor.

## Files touched
- `supabase/functions/_shared/finnhub.ts` (extend)
- `supabase/functions/_shared/yahoo-history.ts` (new — dedup)
- `supabase/functions/check-price-alerts/index.ts`
- `supabase/functions/check-sell-alerts/index.ts`
- `supabase/functions/autotrader-scan/index.ts`
- `supabase/functions/market-sentiment/index.ts`
- `supabase/functions/portfolio-gate/index.ts`
- `supabase/functions/market-scanner/index.ts` (only the dedup import)
- `supabase/functions/sector-analysis/index.ts` (only the dedup import)

## Verification
After deploy, smoke-test with `curl_edge_functions`:
- `check-price-alerts` against an active alert
- `autotrader-scan` (read logs to confirm `quoteSource=finnhub`)
- `market-sentiment` (verify SPY price source)

Logs should show `finnhub` as quote source for live prices, `yahoo` only as fallback.