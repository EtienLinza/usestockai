

# Audit Results — Dashboard Merger & Background Alerts

## Verified Working
- Signals page fully removed (no imports, no routes, no file)
- Dashboard has 3 tabs: Analyze, Signals, Portfolio (with collapsible trade log)
- MetricCard shared component used in both Dashboard and Backtest
- `market-scanner` edge function: all `checkSells`/`userId` logic removed
- `check-sell-alerts` edge function: deployed, executing correctly (logs: "3 positions, 0 new alerts")
- `sell_alerts` table: RLS correct (SELECT/UPDATE/DELETE for auth users, service role inserts)
- Realtime subscription on `sell_alerts` with user-scoped filter
- 6 market-scanner cron jobs running correctly during market hours
- Sell alert dismiss/close flows wired correctly in Dashboard

## Issues to Fix

### 1. Cron job #7 runs 24/7 (should be market hours only)
Current: `7,22,37,52 * * * *` — runs every ~15 min, all hours, all days
Should be: `7,22,37,52 14-21 * * 1-5` (Mon-Fri, 9:30AM-4PM ET in UTC)

**Fix**: Unschedule job #7 and recreate with market-hours-only schedule.

### 2. History page still exists as standalone route
`src/pages/History.tsx` (637 lines) is still in `App.tsx` and `Navbar.tsx`. This is the **prediction history** page (past AI predictions), not trade history — so it's a separate feature from the trade log. **No action needed** unless you want to remove it.

### 3. Minor: Old cron jobs send dead `checkSells` param
Jobs #1-3 still include `"checkSells": false` in the body. Harmless (scanner ignores it) but messy. Optional cleanup.

## Recommended Fix
Only item #1 is a real issue — wasting edge function calls nights/weekends. Will:
- Delete cron job #7
- Recreate with `7,22,37,52 14-21 * * 1-5` schedule (matching scanner's market hours in UTC)

