

# Algorithm Issues and Fixes

## Critical Bugs

### 1. Array Misalignment from Independent Null Filtering
`calculateAllIndicators` (line 1594-1597) filters `closePrices`, `highPrices`, `lowPrices`, and `volumes` independently with `.filter(p => p != null)`. If a null appears at index 50 in `high` but not in `close`, the arrays become different lengths and every indicator using multiple arrays (ATR, Stochastic, ADX, VWAP, Bollinger) produces garbage data.

**Fix:** Filter all arrays together -- if ANY value is null at index `i`, remove index `i` from ALL arrays. Same issue exists in `analyzeStockForGuide` (lines 1761-1764).

### 2. VWAP is Useless (Cumulative Over 2 Years)
`calculateVWAP` (line 431) accumulates volume-weighted price from the very first bar of the 2-year dataset. A 2-year cumulative VWAP converges to the overall average price and provides zero actionable signal. VWAP should reset daily or at minimum use a rolling window.

**Fix:** Change to a rolling VWAP using a 20-day window instead of cumulative.

### 3. Divergence Detection Index Misalignment
`detectRSIDivergence` (line 669) does `recentRSI = rsi.slice(-lookback).filter(v => !isNaN(v))` which removes NaN values, shrinking the array and breaking the index mapping. Then `rsiOffset = lookback - recentRSI.length` tries to compensate but the filtered indices no longer correspond to price indices. Same issue in `detectMACDDivergence` (line 750).

**Fix:** Don't filter NaN from RSI/MACD arrays. Instead, keep the full sliced array and check for NaN when accessing individual values.

### 4. Consensus Score Rewards Weak Signals
The formula `((bullish - bearish) / total) * 100` (line 642) means a single weak bullish signal of 0.5 with 0 bearish gives a consensus of +100 (maximum). But 8 bullish and 2 bearish gives only +60. The score rewards having fewer indicators fire rather than having strong agreement.

**Fix:** Use a two-factor score: `direction = ((bullish - bearish) / total) * 100` for direction, but weight by `total / maxPossibleTotal` for conviction. Final score = `direction * conviction`.

## Significant Issues

### 5. EMA Seed Value is Inaccurate
`calculateEMA` (line 114) seeds with `ema[0] = prices[0]`, a single price point. Standard practice is to seed with the SMA of the first `period` values and start EMA calculation from index `period`. This causes all EMA-derived indicators (MACD, ADX smoothing, ATR) to be inaccurate for the first ~50 bars, which bleeds into later values.

**Fix:** Seed EMA with SMA of the first `period` values and begin EMA from index `period`.

### 6. News Sentiment Keyword Matching is Not Contextual
`fetchNewsSentiment` (line 1151-1184) uses `text.includes(word)` which means "not rising" matches "rising" as positive, "no profit" matches "profit" as positive, "avoid risk" matches "risk" as negative. This injects noise into sentiment scores.

**Fix:** Add basic negation detection -- check if the word is preceded by "not", "no", "don't", "isn't", "never" within a small window, and flip the score.

### 7. Weekly Data Fetch Has No Timeout
The previous plan called for a 5-second timeout on `fetchWeeklyData` (line 1007) but it was never implemented. A slow Yahoo response can make the entire prediction hang.

**Fix:** Add `AbortController` with a 5-second timeout.

### 8. Guide Scoring Ignores Calibrated Confidence
`analyzeStockForGuide` (line 1903) uses `Math.min(92, 45 + score * 6)` for confidence instead of the calibrated `calculateMathematicalConfidence`. This means guide opportunities have inconsistent confidence compared to dashboard predictions.

**Fix:** Use `calculateMathematicalConfidence` for guide opportunities too, falling back to the simple formula only when weekly data isn't available.

## Minor Issues

### 9. Dynamic Uncertainty Cap Too Low for Crypto
`calculateDynamicUncertainty` caps at 18% (line 925). Crypto assets like BTC can easily move 20-30% in a month. This artificially narrows uncertainty bands for volatile assets.

**Fix:** Detect if ticker contains "-USD" (crypto) and raise cap to 30%.

### 10. AI Can Override Confidence by +/-8%
The prompt instruction (line 1313) "You may adjust by +/- 8%" lets the AI deviate significantly from the mathematical baseline, undermining the calibration system.

**Fix:** Tighten to +/- 4% and instruct AI to explain any deviation.

## Implementation Plan

### Step 1: Fix array alignment (Critical)
Create a `alignArrays` helper that takes all OHLCV arrays, finds indices where ANY value is null, and removes those indices from ALL arrays simultaneously. Apply in both `calculateAllIndicators` and `analyzeStockForGuide`.

### Step 2: Fix VWAP to rolling window
Replace cumulative VWAP with a 20-period rolling VWAP calculation.

### Step 3: Fix divergence detection indexing
Remove `.filter(v => !isNaN(v))` from both divergence functions. Check NaN inline when accessing values.

### Step 4: Fix consensus score formula
Add conviction weighting: `const maxTotal = 13.5; const conviction = Math.min(1, total / (maxTotal * 0.6)); return direction * conviction;`

### Step 5: Fix EMA initialization
Seed with SMA of first `period` values, fill first `period-1` with NaN.

### Step 6: Add negation-aware sentiment
Add a `hasNegationBefore(text, wordIndex)` helper and use it in sentiment scoring.

### Step 7: Add weekly data timeout
Add `AbortController` with 5-second timeout to `fetchWeeklyData`.

### Step 8: Unify guide confidence scoring
Use `calculateMathematicalConfidence` in guide mode.

### Step 9: Raise crypto uncertainty cap
Check for crypto tickers and use 30% cap.

### Step 10: Tighten AI adjustment range
Change prompt from +/-8% to +/-4%.

