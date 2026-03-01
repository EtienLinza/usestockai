

# Merge Market, Sectors, and Guide into One "Guide" Tab

## Overview
Combine all three pages into a single Guide page using a tabbed layout to keep content organized without overcrowding. The page will have three sections accessible via tabs: **Opportunities** (current Guide content), **Market** (market overview content), and **Sectors** (sector analysis content).

## Layout Design

```text
+------------------------------------------+
| Guide                          [Refresh] |
| AI-powered market intelligence           |
+------------------------------------------+
| [Opportunities] [Market] [Sectors]       |
+------------------------------------------+
|                                          |
|  (Tab content renders here)              |
|                                          |
+------------------------------------------+
| Disclaimer                               |
+------------------------------------------+
```

## Changes

### 1. Rewrite Guide.tsx with Tabs
- Add three tabs: **Opportunities**, **Market**, **Sectors**
- **Opportunities tab**: Contains the existing trading style selector, sort controls, and stock opportunity cards (all current Guide content)
- **Market tab**: Contains the SentimentGauge, MarketIndicators, market status badge, and TrendingTickers (all current MarketOverview content)
- **Sectors tab**: Contains the view mode toggle (cards/heatmap), sort tabs, SectorCards, and SectorHeatmap (all current Sectors content)
- Each tab manages its own data fetching and loading states independently
- The disclaimer stays at the bottom, visible on all tabs

### 2. Update Navbar
- Remove the separate "Market" and "Sectors" nav links
- Keep only the "Guide" link (at `/guide`)
- Remove Market and Sectors from the dropdown menu as well

### 3. Update App.tsx Routes
- Remove `/market` and `/sectors` routes
- Keep `/guide` route pointing to the merged Guide page

### 4. Clean Up
- Delete `src/pages/MarketOverview.tsx` and `src/pages/Sectors.tsx` (no longer needed as standalone pages)
- Keep all sub-components intact (`SentimentGauge`, `MarketIndicators`, `TrendingTickers`, `SectorCard`, `SectorHeatmap`) -- they'll be imported into Guide.tsx

## Technical Details

- Uses the existing `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@radix-ui/react-tabs`
- Each tab section fetches data independently when selected (lazy loading via useEffect watching active tab)
- Market and Sector data fetching logic moves into the Guide component as separate functions
- Max width stays at `max-w-6xl` to accommodate the wider Market and Sectors content
- The Opportunities tab's refresh button refreshes opportunities; Market/Sectors tabs have their own refresh within the tab content

