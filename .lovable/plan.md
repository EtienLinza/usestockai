

# Missing Pieces for the Live Trading Signal System

After reviewing the codebase, here's what's still missing:

## 1. `market-scanner` Missing from `config.toml`
The edge function exists but isn't registered in the config, so it won't deploy. Need to add `[functions.market-scanner]` with `verify_jwt = false`.

## 2. No Portfolio Snapshot Logging
The `virtual_portfolio_log` table exists and the UI reads from it for the equity curve chart, but **nothing ever writes to it**. The market-scanner should log a portfolio snapshot after each scan for users with open positions.

**Approach**: After processing sell signals in market-scanner, calculate total portfolio value (sum of current_price × shares for open positions) and insert a row into `virtual_portfolio_log`.

## 3. Cron Schedules Never Created
The migration enabled `pg_cron` and `pg_net` extensions, but no actual cron schedules were inserted. Per the cron docs, these must be inserted via the data insert tool (not migrations) since they contain project-specific URLs and anon keys.

**Approach**: Create 3 cron schedules (one per batch of 25 tickers) running every 15 minutes during market hours (Mon-Fri, 14:30-21:00 UTC = 9:30 AM-4:00 PM ET).

## 4. Realtime Not Enabled for `virtual_positions`
The `live_signals` table likely has realtime enabled, but `virtual_positions` does not — so portfolio updates won't auto-refresh.

## Implementation

### Step 1: Add market-scanner to config.toml

### Step 2: Add portfolio snapshot logging to market-scanner
After the sell-signals check, if `userId` is provided and there are open positions, compute total value and insert into `virtual_portfolio_log`.

### Step 3: Create cron schedules via insert tool
Three `cron.schedule()` calls for batches 0, 1, 2 — every 15 minutes during market hours.

### Step 4: Enable realtime on virtual_positions
SQL migration: `ALTER PUBLICATION supabase_realtime ADD TABLE public.virtual_positions;`

