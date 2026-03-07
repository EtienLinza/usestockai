

# Fix: Stock Classification Is Misclassifying Stocks, Killing Performance

## Root Cause

The edge function logs reveal the problem clearly:
- **AAPL is classified as "value"** — AAPL is a momentum stock
- **XOM is classified as "index"** — XOM is an energy/value stock

The classification thresholds in `classifyStock()` (lines 306-318) are too narrow and most stocks fall through to the `else` default, which is **"index"**. The "index" profile has middling params that don't suit individual stocks at all. And when a momentum stock like AAPL gets "value" params (high ADX threshold of 30, short hold periods, MR conviction bonus), it misses trend trades and takes bad mean-reversion entries.

**Why this regressed**: Before the strategy mode changes, the engine was still using default UI params (buyThreshold=65, adxThreshold=25) for everything because the old default-detection code couldn't tell if the user meant those values. Now that we properly route through profiles in adaptive mode, the **wrong profiles** are being applied with full force.

## The Fix (1 file: `supabase/functions/backtest/index.ts`)

### 1. Fix Classification Thresholds

The current thresholds are:
- `momentum`: trendPersistence > 0.06 AND volatility > 0.012 — too strict, most stocks have autocorrelation near 0
- `value`: meanReversionRate > 0.55 AND trendPersistence < 0.04 — reasonable but too narrow
- `volatile`: atrPctAvg > 0.035 — too high, only catches crypto-level volatility
- Everything else falls to "index" — this is where AAPL and XOM both land

**New thresholds** (relaxed to reduce index fallthrough):
- `volatile`: atrPctAvg > 0.025 (was 0.035) — catches high-vol stocks like TSLA
- `momentum`: trendPersistence > 0.03 (was 0.06) OR (avgVolatility > 0.015 AND atrPctAvg < 0.025 AND meanReversionRate < 0.5) — catches stocks with trend tendency
- `value`: meanReversionRate > 0.45 (was 0.55) AND trendPersistence < 0.05 (was 0.04) — wider net for mean-reverting stocks
- `index`: only true fallthrough (low vol, moderate everything)

### 2. Add Ticker-Based Hints

Known tickers should get classification nudges:
- SPY, QQQ, DIA, IWM, VOO, VTI → force "index"
- This already exists for the `isIndexTicker` guard but doesn't feed into classification

### 3. Log the Classification Details

Add a log line showing the raw metrics (trendPersistence, meanReversionRate, avgVolatility, atrPctAvg) alongside the classification so we can debug future misclassifications without guessing.

### 4. Soften Profile Parameter Gaps

The profiles have extreme differences that amplify misclassification damage:
- `value` has adxThreshold=30 (very high — blocks most trend signals)
- `momentum` has rsiOversold=35 (very loose — triggers too many MR entries)

Bring the profiles closer together so a wrong classification doesn't destroy performance:
- `value.adxThreshold`: 30 → 26
- `momentum.rsiOversold`: 35 → 30
- `index` profile should be a true "balanced" middle-ground

This way even if classification is imperfect, the damage is contained.

## Expected Impact

- AAPL should classify as "momentum" → gets lower ADX threshold, longer holds, trend conviction bonus
- XOM should classify as "value" → gets MR conviction bonus, tighter exits
- SPY/QQQ force-classified as "index" → no circular logic issues
- Stocks that genuinely don't fit any category get balanced "index" params that are closer to the old universal defaults

