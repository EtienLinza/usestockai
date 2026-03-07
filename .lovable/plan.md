

# Fix: Backtester Returns All Zeros

## Root Cause

The edge function logs show: `"Backtest request: AAPL from 20 to 2025"` — the start year is arriving as **20** instead of **2020**. 

`new Date("20-01-01")` resolves to year 20 AD, producing a negative Unix timestamp. Yahoo Finance returns no data for that range. Since all tickers return `null`, `validTickerIndices` is empty, the engine runs zero trades, and returns a report full of zeros/N/A.

This likely happens when the number input is edited on mobile — the user may tap into the field and the cursor position causes partial deletion, sending `20` instead of `2020`.

## Fix (Two Files)

### 1. Frontend Validation — `src/pages/Backtest.tsx`

In `handleRunBacktest`, before the fetch call, add year validation:
- If `startYear < 2000` or `startYear > 2026`, show a toast error and return early
- If `endYear <= startYear`, show a toast error and return early
- Clamp the year values on the onChange handlers: if the user types a complete value less than 2000, reset to 2010

Also tighten the Input `min` to enforce 4-digit years visually.

### 2. Backend Validation — `supabase/functions/backtest/index.ts`

After parsing the request body (around line 2004), add a guard:
- If `startYear < 2000`, return a 400 error: `"Invalid start year. Please use a 4-digit year (e.g. 2020)."`
- If any ticker returns `null` from Yahoo, log which ones failed
- If `validTickerIndices.length === 0`, return a 400 error: `"No valid market data found for the given tickers and date range."` instead of silently returning zeros

This ensures users get clear error messages instead of a confusing zero-filled report.

