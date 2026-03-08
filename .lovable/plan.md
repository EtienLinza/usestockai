

# Full-Site Test Results & Fix Plan

## Test Summary

I tested every page at both desktop (1280×720) and mobile (390×844) viewports: Landing, Auth (sign up flow), Dashboard, Guide, Watchlist, Backtest, and 404.

## Issues Found

### Critical
1. **Signal duplication in database** — 114 rows but only 16 unique tickers (each duplicated ~8×). The dedup fix from earlier is deployed but existing stale data was never cleaned. Additionally, the edge function's `delete().in("ticker", tickersToScan)` may silently fail if the Supabase client isn't properly initialized before the delete runs (no error handling on the delete call). Need to: (a) clean existing duplicates, (b) add a unique constraint on `(ticker)` in `live_signals`, and (c) use `upsert` instead of delete+insert.

### Medium
2. **Auth page copy outdated** — Still says "save your predictions" and "prediction history" — predictions were removed. Should say "track your portfolio" / "access your dashboard."
3. **Password policy mismatch** — Frontend says "at least 6 characters" but backend requires uppercase + lowercase + numbers + special characters. The error toast renders but the messaging is confusing. Need to update the hint text to match the actual policy.
4. **Console warning: forwardRef** — `DropdownMenu` in `Navbar` triggers a React warning about function components not accepting refs. Minor but noisy.

### Low
5. **Auth page subtitle still references "predictions"** — cosmetic but inconsistent with new Trading Hub branding.

## Plan

### 1. Clean duplicate signals & add unique constraint
- Run a migration to deduplicate existing `live_signals` (keep newest per ticker)
- Add a `UNIQUE` constraint on `ticker` column in `live_signals`
- Update the edge function to use `upsert` with `onConflict: 'ticker'` instead of delete+insert

### 2. Update Auth page copy
- Change "save your predictions" → "start tracking the market"
- Change "prediction history" → "your dashboard"
- Update password hint to match actual policy: "Password must include uppercase, lowercase, number, and special character"

### 3. Fix password policy hint
- Update the hint text under the password field to accurately reflect the backend requirements

### 4. Fix Navbar forwardRef warning
- Wrap `DropdownMenu` trigger properly or suppress the warning by using the correct component pattern

## Files Changed
1. **`supabase/functions/market-scanner/index.ts`** — switch delete+insert to upsert
2. **`src/pages/Auth.tsx`** — update copy and password hint
3. **`src/components/Navbar.tsx`** — fix forwardRef warning
4. **Database migration** — deduplicate existing data + add unique constraint on `live_signals.ticker`

