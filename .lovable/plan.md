# Ticker Search + On-Demand Analysis

Add a search bar at the top of the Dashboard that lets you type any ticker, jump to its `/stock/:ticker` page, and run a fresh BUY / SELL / HOLD analysis on demand (independent of the scheduled market scanner).

## UX

New `TickerSearchBar` placed above the Trading/Market tabs:

```text
┌──────────────────────────────────────────────────────────────┐
│  🔍  Search any ticker (e.g. AAPL, NVDA, BTC-USD)            │
│  [   input   ]   [ View ]   [ Analyze ]                       │
└──────────────────────────────────────────────────────────────┘
```

- `View` → navigates to `/stock/<TICKER>` (existing detail page).
- `Analyze` → calls new edge function, then shows an inline `AnalysisResultCard` directly under the search:
  - Big BUY / SELL / HOLD badge (green / red / amber)
  - Confidence %, current price, suggested entry, stop, take-profit
  - Regime, strategy, key bullish/bearish drivers (RSI, MACD, trend, vol, sentiment)
  - Short reasoning paragraph
  - Buttons: "Open full page", "Add to watchlist", "Set price alert"
- Validation: regex `^[A-Z]{1,10}(-[A-Z]{2,4})?$`; auto-uppercase; Enter key triggers `Analyze`.
- Loading skeleton while analyzing (typical 4-8s).
- Same `AnalysisResultCard` also dropped into `StockDetail.tsx` with its own "Run analysis" button, so the analysis is reachable from both places.

## Backend

New edge function `analyze-ticker` (Yahoo + Finnhub, no new secrets):

1. Validate ticker.
2. Fetch ~250 daily bars via existing `_shared/yahoo-history.ts` + live quote via `_shared/finnhub.ts`.
3. Run the same `runSignalEngineV2` used by the scanner (single source of truth — keeps live scan and on-demand analysis identical).
4. If the engine returns a signal → map to `BUY` / `SELL` with its entry/stop/target/confidence/reasoning. If it returns nothing → return `HOLD` with the highest scoring rationale (why no setup).
5. Return JSON; **do not persist** to `live_signals` (avoids polluting the scanner table and bypasses the per-user rate limits applied to scans). A lightweight 30 req/min per-IP throttle is enforced in-function.
6. CORS-safe, `verify_jwt = false` (analysis is read-only/public, matching `fetch-stock-chart`).

## Click-through

The `View` action and "Open full page" button both route to existing `/stock/:ticker`, so all the universal ticker-link plumbing already in place keeps working.

## Files

**New**
- `src/components/dashboard/TickerSearchBar.tsx`
- `src/components/dashboard/AnalysisResultCard.tsx`
- `supabase/functions/analyze-ticker/index.ts`

**Edited**
- `src/pages/Dashboard.tsx` — mount `TickerSearchBar` above the tabs.
- `src/pages/StockDetail.tsx` — add "Run analysis" button + render `AnalysisResultCard` inline.

## Out of scope

- No new tables / migrations.
- No changes to the background scanner, autotrader, or scoring math.
- No fundamentals-only research view (chart/news/stats already exist on `/stock/:ticker`).
- No saved analysis history (results are ephemeral; user can re-run anytime).
