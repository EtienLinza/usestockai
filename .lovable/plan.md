

# Scanning Algorithm Improvements — Hedge Fund Gap Analysis

## Current State Summary

The market scanner uses a 3-layer approach: Weekly Bias (macro trend filter) → Daily Entry Signal (EMA/RSI/MACD confirmation) → Conviction Score (0-100 composite). It scans ~75 hardcoded + ~100 dynamic tickers from Yahoo screeners, fetches 1 year of daily data, and writes BUY/SELL signals to the database.

## Weaknesses Identified

### 1. Volume is Ignored in Signal Generation
The scanner passes `volume` to `computeSignalConviction` but **never uses it**. No volume confirmation on breakouts, no volume-weighted trend strength. Hedge funds never enter a position without volume confirmation — a breakout on thin volume is a trap.

**Fix**: Add volume confirmation checks — require above-average volume on entry signals, add OBV trend as a conviction modifier, and penalize signals with declining volume.

### 2. No Relative Strength vs SPY
SPY data is fetched but only used as a binary bearish/bullish flag (`spyBearish`). The scanner doesn't compute how each stock performs *relative* to SPY. A stock going up 2% while SPY goes up 5% is actually weak.

**Fix**: Calculate 20-day rolling relative strength (stock return - SPY return) and use it as a conviction bonus/penalty. Stocks outperforming SPY get +5-10 conviction; underperformers get penalized.

### 3. Conviction Scoring Has Dead Zones
The conviction formula has gaps — if a stock doesn't meet trend conditions (3/4 checks + above SMA200) and isn't oversold enough for mean reversion, it scores 0 and only a breakout squeeze can save it. Many valid setups fall through.

**Fix**: Add a "momentum pullback" strategy for stocks in uptrends that pull back to the 20 EMA with RSI between 40-55 — the most common institutional entry pattern. Also add a "VWAP reclaim" signal.

### 4. No Multi-Timeframe Confluence
The scanner checks weekly bias and daily entry independently. It doesn't check if the signal aligns across timeframes — e.g., a daily buy signal is much stronger if the 4-hour chart also shows momentum.

**Fix**: Since we only have daily data from Yahoo, simulate intraday confluence by checking if the last 5 days show consistent directional closes (3+ of last 5 closes in signal direction) and if ATR is expanding (trend acceleration).

### 5. Stock Classification is Too Coarse
`classifyStockSimple` only returns 4 profiles and never returns "value" — the code path doesn't exist. The classification also uses the entire history equally, making it slow to adapt.

**Fix**: Add the "value" classification path (low volatility + low trend score + price near SMA200). Use the last 120 bars for classification instead of full history to capture regime changes faster.

### 6. No Sector Rotation Awareness
Signals are generated per-stock with zero awareness of sector momentum. Hedge funds overweight hot sectors and underweight cold ones.

**Fix**: Fetch sector ETF data (XLK, XLF, XLE, etc.) once per scan and compute 20-day sector momentum. Apply a sector bonus (+3-5 conviction) for stocks in the top 3 sectors and a penalty (-3-5) for stocks in the bottom 3.

### 7. No Risk-Adjusted Filtering
A 70-conviction signal on a 4% daily volatility stock is not the same as a 70-conviction signal on a 1% stock. The scanner treats them identically.

**Fix**: Add a Sharpe-like quality filter — divide conviction by annualized volatility to get a "quality score." Rank signals by quality score instead of raw conviction.

### 8. Conviction Threshold Too Low
The minimum conviction threshold is 55, which lets through mediocre setups. The backtest engine uses 68.

**Fix**: Raise the minimum to 65 for trend signals and 60 for mean reversion (which are inherently contrarian and need lower bars).

### 9. No Divergence Detection
The `stock-predict` function has RSI/MACD divergence detection, but the scanner doesn't. Bullish divergence (price making lower lows while RSI makes higher lows) is one of the strongest reversal signals.

**Fix**: Port the divergence detection from `stock-predict` into the scanner's conviction scoring. Bullish divergence should add +8-10 conviction.

### 10. SPY Data Fetched Per Batch (Wasteful)
Every batch re-fetches SPY data. With 6+ batches, that's 6 redundant API calls.

**Fix**: Pass SPY regime status (`spyBearish`, SPY close, SPY SMA200) as a parameter from the first batch to subsequent batches, similar to how `tickerList` is forwarded.

## Implementation Plan

1. **Enhance `computeSignalConviction`** — Add volume confirmation, relative strength bonus, divergence detection, momentum pullback strategy, and risk-adjusted quality score.

2. **Add sector rotation layer** — Fetch sector ETFs once in batch 0, compute sector momentum scores, pass to subsequent batches, apply as conviction modifier.

3. **Fix stock classification** — Add "value" path, use 120-bar window, make classification adaptive.

4. **Optimize batch pipeline** — Cache SPY data and sector scores across batches. Raise conviction threshold to 65/60.

5. **Add quality ranking** — Sort final signals by risk-adjusted quality (conviction / volatility) instead of raw conviction.

All changes are in `supabase/functions/market-scanner/index.ts` — no database or frontend changes needed.

