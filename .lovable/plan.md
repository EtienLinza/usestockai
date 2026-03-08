

# Phase 2 & 3: Portfolio Tracking, Sell Alerts, and Automation

## Current State
Phase 1 is complete: database tables, market-scanner edge function, and the Signals page with signal feed, register-buy flow, and basic portfolio/history tables. Key gaps remain.

## What's Missing

### 1. Live P&L on Open Positions (Phase 2)
The portfolio tab shows entry value but **no current price or unrealized P&L**. Need to fetch current prices for open position tickers and display unrealized gains/losses.

**Approach**: When portfolio tab loads, call `fetch-stock-price` (or a lightweight Yahoo Finance fetch) for each unique open-position ticker, then compute and display:
- Current price
- Unrealized P&L ($) and P&L (%)
- Color-coded gain/loss

### 2. Sell Alerts in UI (Phase 2)
The scanner returns `sellSignals` but the frontend **ignores them completely** — the `runScan` function doesn't read or display `data.sellSignals`. Need to:
- Capture sell signals from scanner response
- Display them as prominent alerts (banner or notification cards) in the portfolio tab
- Show reason (hard stop, take profit, weekly reversal) and suggested exit price

### 3. Portfolio Performance Chart (Phase 2)
No equity curve for virtual portfolio. Add a simple line chart showing total portfolio value over time using `virtual_portfolio_log` table + a snapshot mechanism that logs daily value.

### 4. Cron-Based Auto-Scanning (Phase 3)
Currently manual-only. Set up `pg_cron` + `pg_net` to auto-trigger the market scanner every 15 minutes during market hours (Mon-Fri, 9:30 AM - 4:00 PM ET).

## Implementation Plan

### Step 1: Add live P&L to portfolio tab
- Fetch current prices for open position tickers on tab load
- Add Current Price, Unrealized P&L, and P&L% columns to the portfolio table
- Add a portfolio summary card showing total unrealized P&L

### Step 2: Display sell alerts from scanner
- Store `sellSignals` from scanner response in component state
- Add a "Sell Alerts" section at the top of the portfolio tab with warning cards
- Each alert shows ticker, reason, current price, and a "Close Position" button

### Step 3: Add portfolio equity curve chart
- Add a recharts line chart to the portfolio tab header
- Query `virtual_portfolio_log` for historical snapshots
- Add a function to log current portfolio value when scan runs (snapshot on each scan)

### Step 4: Set up cron auto-scanning
- Enable `pg_cron` and `pg_net` extensions via migration
- Create a cron schedule that calls market-scanner every 15 minutes during market hours
- Add a "Last scanned" timestamp display in the UI

All changes touch: `src/pages/Signals.tsx` (UI), `supabase/functions/market-scanner/index.ts` (portfolio logging), and one SQL insert for the cron job.

