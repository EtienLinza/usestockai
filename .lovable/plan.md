

# Fix Backtester — All Issues

## Critical Issues Found

### 1. Missing config.toml entry (Function won't deploy)
The `backtest` edge function has no entry in `supabase/config.toml`. Without `[functions.backtest] verify_jwt = false`, API calls return 404.

### 2. Incomplete CORS headers
Missing required headers (`x-supabase-client-platform`, etc.) which can cause preflight failures from the Supabase JS client.

### 3. MACD signal alignment bug
`calculateEMA(macd.filter(v => !isNaN(v)), 9)` filters NaN values, shrinking the array. The padding calculation `macd.length - signal.length` can misalign the signal line with the MACD line, producing incorrect MACD histogram values that feed into every trade signal.

### 4. Stress period detection logic error
`Math.min(...windowClose.slice(windowClose.indexOf(Math.max(...windowClose))))` includes the peak bar itself in the trough search. If the peak is the last element, `slice()` returns just `[peak]`, so trough = peak and drawdown = 0, missing real stress periods. Must search from `peakIndex + 1`.

### 5. Monte Carlo hardcoded position sizing
Line 785: `capital *= (1 + ret * 0.1)` hardcodes 10% position size instead of using the user's configured `positionSizePct`.

### 6. Multi-ticker equity curve combination bug
When backtesting multiple tickers, each ticker's backtest starts with full `initialCapital`. The combination logic adds `(point.value - initialCapital)` to existing points, but this double-counts initial capital for the first ticker and creates inaccurate portfolio equity curves.

### 7. Portfolio turnover calculation incorrect
Line 624: `t.entryPrice * (initialCapital * 0.1)` mixes price and capital values nonsensically. Should be `positionSize` (capital * positionSizePct/100) per trade.

## Implementation

### `supabase/config.toml`
Add `[functions.backtest] verify_jwt = false`.

### `supabase/functions/backtest/index.ts`
1. **CORS**: Add full required headers string
2. **MACD fix**: Track NaN positions properly — apply EMA on filtered array then re-insert NaN padding at correct indices
3. **Stress detection**: Change trough search to `windowClose.slice(peakIdx + 1)` with guard for empty slice
4. **Monte Carlo**: Use `config.positionSizePct / 100` instead of hardcoded `0.1`
5. **Multi-ticker equity**: Divide `initialCapital` by number of valid tickers so each gets proportional allocation
6. **Portfolio turnover**: Fix formula to `sum(positionSize per trade) / initialCapital / years`

### `src/pages/Backtest.tsx`
No structural changes needed — the frontend correctly renders whatever the backend returns. The fixes are all backend-side.

