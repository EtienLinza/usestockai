

# Merge Signals into Dashboard — Unified Trading Hub

## Concept
Replace the separate Dashboard + Signals pages with a single unified Dashboard that uses top-level tabs: **Analyze** (current prediction form + results), **Signals** (scanner + signal feed), **Portfolio** (open positions + live P&L + sell alerts + equity curve), and **History** (closed trades). Remove the `/signals` route entirely.

## Architecture

```text
Dashboard (single page)
├── Header (stats bar: signals count, open positions, unrealized P&L, realized P&L, portfolio value)
├── Sell Alerts Banner (when active)
└── Tabs
    ├── Analyze — PredictionForm (left) + results area (right) [existing Dashboard layout]
    ├── Signals — Scan button + signal feed cards with Register Buy
    ├── Portfolio — Equity curve chart + open positions table with live P&L
    └── History — Closed positions table
```

## Changes

### 1. Rewrite `src/pages/Dashboard.tsx`
- Import all state/logic from current Signals.tsx (signals, positions, prices, sell alerts, portfolio history, scanner)
- Import all state/logic from current Dashboard.tsx (predictions, price target, form)
- Top-level stats row showing key metrics (same 5 cards from Signals)
- Sell alerts banner above tabs
- 4 tabs: Analyze, Signals, Portfolio, History
- **Analyze tab**: keeps existing 2-column layout (PredictionForm left, results right)
- **Signals tab**: scanner button + signal cards (moved from Signals.tsx)
- **Portfolio tab**: equity curve + positions table with live P&L (moved from Signals.tsx)
- **History tab**: closed positions table (moved from Signals.tsx)
- Buy/Sell dialogs remain as-is

### 2. Update `src/App.tsx`
- Remove `/signals` route import and Route
- Remove Signals page import

### 3. Update `src/components/Navbar.tsx`
- Remove the Signals nav link from `navLinks` array (line 36)

### 4. Delete `src/pages/Signals.tsx`
- All code absorbed into Dashboard

### 5. Keep existing components untouched
- `PredictionForm`, `StockPredictionCard`, `StockComparisonView`, `PriceTargetResult` — all still used in Analyze tab
- No changes to edge functions, database, or RLS

## Key Decisions
- Prediction and signals algorithms remain separate backend functions (`stock-predict` for individual analysis, `market-scanner` for bulk scanning) — they serve different purposes and integrating them would reduce flexibility
- The "Scan Market" button moves into the Signals tab header
- URL param `?ticker=` still works for the Analyze tab
- Default tab is "Analyze" unless user has open positions or active signals, in which case it defaults to "Signals"

