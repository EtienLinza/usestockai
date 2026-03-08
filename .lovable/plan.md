

# Adaptive Classification Window

## Current Problem
The classification window has a fixed cap of 1000 bars and a fixed reclassification interval of 500 bars. These are one-size-fits-all constants that don't account for how stable or unstable a stock's metrics actually are. A stock like SPY barely changes character and doesn't need frequent reclassification, while a cyclical stock like XOM might benefit from shorter windows during regime transitions.

## Approach: Metric Stability Drives Window Size

Instead of fixed constants, make the window and interval respond to how much the classification metrics are actually changing.

### Changes to `supabase/functions/backtest/index.ts`

**1. Track metric history**
After each classification, store the key metrics (`trendScore`, `meanReversionRate`, `atrPctAvg`) in a small ring buffer (last 3-5 classifications).

**2. Compute metric stability**
Calculate the coefficient of variation (std/mean) across the stored metric history. High CV = unstable stock, low CV = stable stock.

**3. Adapt window size based on stability**
- **Stable** (CV < 0.15): Use a larger window (up to 1500 bars / ~6 years) — the stock's character is consistent, more data = better estimate.
- **Moderate** (CV 0.15-0.40): Keep the current 1000-bar cap.
- **Unstable** (CV > 0.40): Shrink the window to 600 bars (~2.5 years) — the stock's character is genuinely shifting, so older data is misleading.

**4. Adapt reclassification interval**
- **Stable**: Reclassify every 750 bars (~3 years) — no need to check often.
- **Moderate**: Keep 500 bars (~2 years).
- **Unstable**: Reclassify every 250 bars (~1 year) — check more often since the stock is changing.

**5. Increase smoothing for unstable stocks**
- **Stable**: `PROFILE_SMOOTH_FACTOR = 0.4` (trust new data more since it's consistent).
- **Unstable**: `PROFILE_SMOOTH_FACTOR = 0.15` (trust new data less, smooth harder to prevent whiplash).

**6. Log the adaptive state**
Add the stability score and chosen window/interval to the classification log line.

### Implementation Details
- Ring buffer: simple array of `{trendScore, meanReversionRate, atrPctAvg}` objects, push and shift when length > 4.
- CV calculation: average the CVs of the three metrics.
- First 2 classifications use the current defaults (not enough history to compute stability).
- All constants become initial defaults that get overridden once stability data is available.

