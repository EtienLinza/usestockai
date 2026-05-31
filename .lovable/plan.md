## Goal

A dedicated detail page for every ticker with an interactive price chart, key stats, news, and the latest AI signal. Every ticker shown anywhere on the site becomes a link to that page.

## Data sources (free, no new keys)

- **Yahoo Finance** (unofficial, server-side via edge function) — price candles for all timeframes. Already used by `fetch-stock-price` and `yahoo-history.ts`.
- **Finnhub** (existing `FINNHUB_API_KEY`) — fundamentals (PE, market cap, 52w range, beta, industry) and company news.
- **Existing `live_signals` table** — latest AI signal for the ticker, if any.

No new secrets required.

## New route

`/stock/:ticker` → `src/pages/StockDetail.tsx`. Added to `src/App.tsx`. Wrapped in `RequireOnboarding` like other pages.

## New edge function: `fetch-stock-chart`

`supabase/functions/fetch-stock-chart/index.ts` — accepts `{ ticker, range }`, server-side Yahoo fetch to bypass CORS.

| Range | Yahoo interval | Yahoo range |
|---|---|---|
| 1D  | 5m  | 1d  |
| 5D  | 15m | 5d  |
| 1M  | 1d  | 1mo |
| 6M  | 1d  | 6mo |
| 1Y  | 1d  | 1y  |
| 5Y  | 1wk | 5y  |

Returns `{ ticker, range, candles: [{t, o, h, l, c, v}] }`. CORS + ticker regex validation, same pattern as `fetch-stock-price`.

## Page layout (`StockDetail.tsx`)

```text
┌─ Navbar ────────────────────────────────────────┐
│ AAPL · Apple Inc.        [+ Watchlist] [Alert] │
│ $xxx.xx  +x.xx (+x.xx%)   Market: REGULAR      │
├─ Range tabs: 1D 5D 1M 6M 1Y 5Y ────────────────┤
│                                                 │
│           Recharts AreaChart (themed)           │
│                                                 │
├─ Key stats grid (MetricCard) ──┬─ Latest AI ──┤
│  PE · Mkt Cap · 52w · Beta ... │  Signal card  │
├─ News headlines (Finnhub) ─────────────────────┤
└────────────────────────────────────────────────┘
```

- Chart: Recharts `AreaChart`, sage-green stroke + gradient fill, themed via existing tokens.
- Stats: reuse `MetricCard`.
- Buttons: reuse `AddToWatchlistButton`, `PriceAlertModal`.
- Signal: query latest row from `live_signals` for that ticker; show `LockedFeature` placeholder if free tier (consistent with existing tier gating).
- Loading: `Skeleton` blocks.
- SEO: `<SEO />` with `Title: {Ticker} Stock Analysis · usestockai`, dynamic meta description.

## Click-through wiring

Add a tiny `<TickerLink ticker="AAPL" />` component (`src/components/TickerLink.tsx`) that wraps children in a `react-router-dom` `<Link to={`/stock/${ticker}`}>` with `stopPropagation` so it works inside clickable rows. Apply across:

- `src/components/dashboard/TradingTab.tsx` — signal cards/rows
- `src/components/dashboard/MarketTab.tsx`
- `src/components/market/TrendingTickers.tsx`
- `src/components/sectors/SectorCard.tsx` / `SectorHeatmap.tsx` (ticker chips)
- `src/pages/Watchlist.tsx`
- `src/pages/AutotraderLog.tsx`
- `src/components/PriceAlertModal` lists, virtual-positions table, sell-alerts panel

Anywhere a ticker symbol is rendered as text today, it becomes a link. Hover state: subtle underline + sage accent — no layout change.

## Out of scope (this pass)

- Intraday websocket streaming (Yahoo 5m polling on 1D is enough).
- Options chain, insider trades, earnings calendar.
- Comparison/overlay charts.
- Adding the detail page to the sitemap dynamically (current `sitemap.xml` is static).

## Files touched

**New:**
- `supabase/functions/fetch-stock-chart/index.ts`
- `src/pages/StockDetail.tsx`
- `src/components/StockChart.tsx`
- `src/components/TickerLink.tsx`

**Edited:**
- `src/App.tsx` (route)
- ~7 components/pages listed above to wrap tickers in `TickerLink`

No DB migrations. No new secrets.
