

# Cross-Asset Context Layer & Relative Strength Scoring

## What This Adds

The prediction engine currently analyzes each stock in isolation. This upgrade fetches market-wide context (SPY, QQQ, VIX, sector ETF, DXY, TNX) alongside every prediction, computes relative metrics, and feeds them into regime detection, confidence scaling, and the AI prompt.

## Architecture

```text
User requests AAPL prediction
       │
       ├── fetchStockData("AAPL")        (existing)
       ├── fetchCrossAssetData("AAPL")   (NEW - parallel)
       │      ├── SPY  (market regime)
       │      ├── QQQ  (tech beta)
       │      ├── VIX  (^VIX - volatility regime)
       │      ├── DXY  (DX-Y.NYB - dollar strength)
       │      ├── TNX  (^TNX - 10Y yield)
       │      └── Sector ETF (XLK for tech, XLV for health, etc.)
       │
       ▼
  computeCrossAssetMetrics()              (NEW)
       ├── Relative Strength vs SPY (20d rolling)
       ├── Beta vs SPY (20d rolling regression)
       ├── Sector Momentum Score
       ├── VIX Percentile (current vs 1yr range)
       ├── Dollar/Yield regime flags
       │
       ▼
  Feed into: regime detection, confidence, AI prompt, response
```

## Changes to `supabase/functions/stock-predict/index.ts`

### 1. Sector Mapping Helper
Map tickers to their sector ETF using a lookup table (AAPL→XLK, JNJ→XLV, JPM→XLF, etc.). Fall back to SPY if unknown.

### 2. `fetchCrossAssetData(ticker)` Function
- Fetch SPY, VIX (^VIX), DXY (DX-Y.NYB), TNX (^TNX), and the sector ETF in parallel
- Use 60-day range, daily interval (enough for 20d rolling calcs)
- 5-second timeout per fetch, graceful fallbacks if any fail
- Returns an object with close arrays for each asset

### 3. `computeCrossAssetMetrics()` Function
Computes from the fetched data:
- **Relative Strength** = `(stockReturn20d - spyReturn20d)` — simple outperformance metric
- **Rolling Beta** = `cov(stockReturns, spyReturns) / var(spyReturns)` over 20 days
- **Sector Momentum** = sector ETF 20-day return (positive = tailwind, negative = headwind)
- **VIX Percentile** = where current VIX sits in its 1-year range (0-100)
- **Dollar Regime** = DXY 20d change direction (strengthening/weakening/neutral)
- **Yield Regime** = TNX 20d change direction (rising/falling/neutral)

### 4. Integrate Into Regime Detection
- If VIX percentile > 80 and stock beta > 1.3, boost volatility regime weight
- If sector momentum is negative but stock has positive relative strength, flag as "sector divergence" (potential alpha)

### 5. Integrate Into Confidence Scaling
In `calculateMathematicalConfidence`:
- **Relative strength alignment**: if stock outperforms SPY AND consensus is bullish → +3 confidence; if underperforms AND consensus bullish → -3
- **VIX regime penalty**: if VIX percentile > 75 → -4 confidence (high fear = less predictable)
- **Sector tailwind bonus**: if sector momentum aligns with prediction direction → +2

### 6. Integrate Into AI Prompt
Add a new `===== CROSS-ASSET CONTEXT =====` section to the prompt:
- Relative Strength vs SPY
- Beta
- Sector momentum + ETF name
- VIX level + percentile
- Dollar/Yield regime
- Market state summary

### 7. Integrate Into Guide Mode
In `analyzeStockForGuide`: fetch SPY data once at the start of guide scanning (not per-ticker). Compute relative strength per ticker against the shared SPY data. Use it as a scoring bonus.

### 8. Add to Response Payload
Return new fields: `relativeStrength`, `beta`, `sectorMomentum`, `vixPercentile`, `marketContext` object.

### 9. Update UI (`StockPredictionCard.tsx`)
Add a "Market Context" card showing:
- Relative Strength vs SPY (with +/- color)
- Beta value
- VIX percentile gauge
- Sector momentum indicator

## Performance Considerations
- Cross-asset fetches run in parallel with existing stock data fetch (no added latency)
- Guide mode fetches SPY once and reuses for all 50 tickers
- Each cross-asset fetch has its own 5s timeout
- Graceful degradation: if any cross-asset fetch fails, that metric is omitted (not a blocker)

