

# Live Trading Signal System — Architecture Plan

This is the right direction. You've built a proven signal engine in the backtester — now we turn it into a **live market scanner** that tells users what to buy/sell in real-time, tracks their virtual portfolio, and adapts.

## What We're Building

A new **"Signals"** page that replaces or sits alongside Dashboard. It:

1. **Scans the market** on a schedule (every 15-30 min during market hours — edge functions can't run "every second" but we can poll frequently)
2. **Generates BUY signals** from a broad universe (50-100+ tickers across sectors) using the same weekly bias + daily entry logic from the backtester
3. **Lets users "Buy"** — registers the position in StockAI (no actual trading), recording ticker, entry price, shares, timestamp
4. **Tracks their portfolio** — shows P&L, unrealized gains, allocation
5. **Generates SELL signals** — monitors held positions and alerts when the backtest engine's exit logic triggers (weekly reversal, hard stop, etc.)
6. **Adapts** — uses the same adaptive stock classification (momentum/value/volatile/index) and regime detection

## Architecture

```text
┌─────────────────────────────────────────────┐
│  Edge Function: "market-scanner"            │
│  - Runs on user request or cron (15min)     │
│  - Scans 50-100 tickers via Yahoo Finance   │
│  - Applies weekly bias + daily entry logic  │
│  - Writes signals to DB: live_signals table │
│  - Checks held positions for SELL triggers  │
└─────────────────┬───────────────────────────┘
                  │
     ┌────────────┴────────────┐
     │    Supabase Tables      │
     │                         │
     │  live_signals           │  ← BUY/SELL signals with confidence, regime
     │  virtual_positions      │  ← User's registered buys (ticker, entry, shares)
     │  virtual_portfolio_log  │  ← Historical P&L snapshots
     └────────────┬────────────┘
                  │
┌─────────────────┴───────────────────────────┐
│  Frontend: /signals page                     │
│  - Active signals feed (BUY opportunities)   │
│  - "Register Buy" button → virtual_positions │
│  - Portfolio tracker with live P&L           │
│  - SELL alerts for held positions            │
│  - Realtime updates via Supabase Realtime    │
└──────────────────────────────────────────────┘
```

## Database Tables

### `live_signals`
Stores generated signals (BUY/SELL opportunities):
- `id`, `ticker`, `signal_type` (BUY/SELL), `entry_price`, `confidence`, `regime`, `stock_profile` (momentum/value/etc.), `weekly_bias`, `target_allocation`, `reasoning`, `expires_at`, `created_at`

### `virtual_positions`
User's registered positions:
- `id`, `user_id`, `ticker`, `entry_price`, `shares`, `position_type` (long/short), `status` (open/closed), `exit_price`, `exit_date`, `exit_reason`, `pnl`, `created_at`, `closed_at`

### `virtual_portfolio_log`
Daily snapshots for equity curve:
- `id`, `user_id`, `date`, `total_value`, `cash`, `positions_value`

## Edge Function: `market-scanner`

Reuses directly from `backtest/index.ts`:
- `computeWeeklyBias()` — determines if a stock is in a long/short/flat regime
- `hasDailyEntrySignal()` / `hasDailyMeanReversionEntry()` — timing confirmation
- `classifyStock()` — adaptive profile detection
- `calculateEMA/RSI/MACD/ADX` — all technical indicators

The scanner will:
1. Fetch latest daily data for a universe of 50-100 tickers (batched)
2. Build weekly bars from daily data
3. Run `computeWeeklyBias()` on each ticker
4. For tickers with bias != "flat", check `hasDailyEntrySignal()`
5. Output BUY signals with confidence scores
6. For users with open positions, check exit conditions (weekly reversal, hard stop)
7. Output SELL signals for positions that should be closed

## Frontend: `/signals` Page

Three main sections:
1. **Signal Feed** — Live BUY opportunities ranked by confidence, with "Register Buy" button
2. **My Portfolio** — Open positions with live P&L, unrealized gains
3. **Sell Alerts** — Active sell signals for positions the user holds

## Implementation Steps (Phased)

### Phase 1: Foundation
- Create 3 database tables with RLS
- Create `market-scanner` edge function (extract shared logic from backtest)
- Build `/signals` page with signal feed UI

### Phase 2: Portfolio Tracking
- "Register Buy" flow — user enters shares/amount
- Portfolio dashboard with P&L calculation
- SELL signal generation for held positions

### Phase 3: Automation & Polish
- Cron-triggered scanning (every 15-30 min during market hours)
- Realtime signal updates
- Push notifications for SELL alerts
- Performance history and analytics

## Constraints & Realism

- **No actual trading** — this is a signal + tracking tool
- **Yahoo Finance rate limits** — scanning 100 tickers takes ~30-60s, batched with delays
- **Edge function timeout** — 60s max, so we scan in batches (20-25 tickers per invocation)
- **Market hours only** — signals are only meaningful during 9:30 AM - 4:00 PM ET
- **Not every second** — realistically every 15-30 minutes via cron or user-triggered refresh

This keeps the existing Dashboard/Backtest intact while building the new live system alongside it. The backtester becomes the "proof" that the signals work, and the scanner is the live application of that same logic.

