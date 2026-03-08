

# Merging the Guide into the Dashboard

## Current State

**Dashboard** has 3 tabs: Analyze (individual predictions), Signals (market scanner), Portfolio (virtual positions + P&L).

**Guide** has 3 tabs: Opportunities (6-8 AI-curated picks via Gemini, with trading style selector), Market (Fear/Greed gauge, index changes, trending tickers), Sectors (ETF heatmap + sector performance cards).

## Should You Merge?

**Yes.** The Guide is useful content, but as a separate page it's disconnected from where you actually trade. Merging it into the Dashboard puts market context right next to your signals and positions — which is how real trading platforms work. One hub, everything visible.

## How to Merge

Add two new tabs to the Dashboard, making it a 5-tab hub:

```text
[ Analyze | Signals | Portfolio | Market | Sectors ]
```

- **Market tab** — Fear/Greed gauge, index changes (SPY/QQQ/DIA), VIX, trending gainers/losers. Exactly what's in Guide's "Market" tab today.
- **Sectors tab** — ETF heatmap + sector cards with daily/weekly/monthly sort. Exactly what's in Guide's "Sectors" tab today.

**What about Opportunities?** The Guide's AI Opportunities feature overlaps heavily with the Signals tab (both find stocks to trade). Instead of a separate tab, the best approach is to add a "Style Filter" dropdown to the existing Signals tab, letting users filter scanner results by trading style (Scalping, Day Trading, Swing, Position). This gives the same value without duplicating a stock-picking UI.

## Changes

1. **`src/pages/Dashboard.tsx`** — Add "Market" and "Sectors" tabs. Import and render `SentimentGauge`, `MarketIndicators`, `TrendingTickers`, `SectorCard`, `SectorHeatmap` (lazy-loaded on tab activation). Add market data fetching logic (adapted from Guide.tsx).

2. **`src/pages/Dashboard.tsx`** — Add a trading style filter dropdown to the Signals tab that filters displayed signals by volatility/volume/cap characteristics matching each style.

3. **Remove `src/pages/Guide.tsx`** and the `/guide` route from `App.tsx`.

4. **Update `src/components/Navbar.tsx`** — Remove the Guide nav link. Navigation becomes: Dashboard, Watchlist, Backtest.

5. **Clean up** — Remove the Guide edge function call if it's no longer needed, or keep `stock-predict` since Analyze still uses it for individual ticker predictions.

## Result

Navigation simplifies from 4 pages to 3: **Dashboard** (everything trading), **Watchlist**, **Backtest**. All market intelligence lives inside the Dashboard where it's actionable.

