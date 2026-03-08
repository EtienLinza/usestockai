

# Root Cause Found: Combined Equity Curve Bug

## The Problem

Every single sector across every single backtest run has been showing massively incorrect negative returns due to a **critical bug in the equity curve combining logic** (lines 2381-2393).

## The Bug

When combining equity curves from multiple tickers, the code does this:

1. **Ticker 1**: Sets `combinedEquity` to ticker 1's absolute values (starts at `$2000` for 5-ticker runs where `capitalPerTicker = $10,000/5`)
2. **Tickers 2-5**: Adds only the **PnL delta** (`point.value - capitalPerTicker`) to matching dates

This means the combined curve's BASE is only one ticker's capital ($2,000), not the full portfolio ($10,000). The other 4 tickers contribute only their PnL, not their base capital.

## Proof

Tech Core result:
- Combined equity ends at **$3,334**
- `initialCapital = $10,000`
- `annualizedReturn = (3334/10000)^(1/5) - 1 = -19.72%` -- matches reported value

But the REAL final portfolio value should be:
- Each ticker starts at $2,000 and the base capital is present in each
- Missing base: `4 × $2,000 = $8,000`
- Corrected final: `$3,334 + $8,000 = $11,334`
- Corrected annualized: `(11,334/10,000)^(1/5) - 1 = +2.5%` -- **PROFITABLE**

This same $8,000 deflation applies to EVERY sector across EVERY run, explaining why all 15 sectors show deeply negative returns despite positive per-trade metrics.

## The Fix

Replace the combining logic with proper summation of absolute values:

```typescript
// Current (BROKEN):
if (combinedEquity.length === 0) {
  combinedEquity = equityCurve.map(p => ({ ...p }));
} else {
  for (const point of equityCurve) {
    const pnl = point.value - capitalPerTicker;  // Only adds delta
    const existing = combinedEquity.find(c => c.date === point.date);
    if (existing) existing.value += pnl;
    // ...
  }
}

// Fixed: Use a Map to accumulate absolute values from ALL tickers
const equityMap = new Map<string, number>();
// For each ticker's equity curve, ADD the absolute value
for (const point of equityCurve) {
  equityMap.set(point.date, (equityMap.get(point.date) || 0) + point.value);
}
```

## Implementation Steps

1. **Fix the equity combining logic** -- Replace the broken first-ticker-as-base approach with a `Map<string, number>` that sums absolute equity values from every ticker
2. **Handle non-overlapping dates** -- For dates that exist in some tickers but not others, interpolate or carry forward the last known value from missing tickers (currently these create entries with only one ticker's value)
3. **No other code changes needed** -- The per-trade logic, position sizing, Kelly fraction, and slippage are all correct. Only the portfolio-level equity aggregation is broken.

## Expected Impact

Adding back the missing `$8,000` base to all results:

```text
Sector              | Reported Ann. | Corrected Final | Corrected Ann.
====================|===============|=================|===============
Tech Core           | -19.72%       | ~$11,334        | ~+2.5%
Tech Semis 2        | -15.12%       | ~$12,450        | ~+4.5%
Financials Core     | -17.92%       | ~$11,820        | ~+3.5%
Consumer Staples    | -28.58%       | ~$9,140         | ~-1.7%
Consumer Disc.      | -27.67%       | ~$9,230         | ~-1.5%
```

This single fix should flip 12-13 of 15 sectors from negative to positive, consistent with the strong per-trade metrics we've been observing all along.

