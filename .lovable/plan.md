

# Fix Bearish Market Performance

## Problems From the Trade Log

1. **Mean Reversion has NO trend guard** — it freely takes BUY signals below the 200 SMA (e.g., 2009-01-13 BUY MR at $25 → -5.27%, 2011-08-09 BUY MR oversold → -5.18%). These are counter-trend buys into falling knives.

2. **200 SMA lags on trend strategy** — during early 2008, JPM was still above its 200 SMA, so trend buys were allowed (2008-02-05 BUY trend "bullish" → -14.42%, 2008-05-06 BUY trend "strong_bullish" → -10.89%). The 200 SMA hadn't caught up yet.

3. **SHORT positions get destroyed by bear market rallies** — violent counter-trend rallies (e.g., 2008-03-06 SHORT trend → -14.51% from Bear Stearns rescue, 2020-04-01 SHORT trend → -12.82%). Current stops are too tight for bear market volatility.

4. **No regime-based position sizing** — the engine trades the same size in a 2008 crash as in a calm 2017 uptrend.

## Fixes in `supabase/functions/backtest/index.ts`

### Fix 1: Apply 200 SMA Trend Guard to Mean Reversion
Currently only trend strategy checks `above200`/`below200`. Add the same guard to MR:
- Block MR BUY signals when `below200` (don't catch falling knives)
- Block MR SHORT signals when `above200` (don't fight bull trends)

### Fix 2: Add 200 SMA Slope Filter for Trend BUYs
The 200 SMA itself lags, but checking its **slope** catches turning points earlier:
- Calculate `sma200Slope = (s200 - sma200[n-20]) / sma200[n-20]` (20-bar rate of change)
- Block trend BUY signals when `sma200Slope < -0.01` (200 SMA declining > 1%)
- Block trend SHORT signals when `sma200Slope > 0.01` (200 SMA rising > 1%)
- This would have caught early-2008 buys where price was above 200 SMA but the SMA was flattening/rolling over

### Fix 3: Widen Stops in Bearish Regimes
Bear markets have violent counter-trend rallies. Current hard stop for trend is `3 × ATR` — but ATR itself is elevated in bear markets, and rallies regularly exceed 3 × ATR:
- When regime is `bearish` or `strong_bearish`, multiply the effective stop by 1.5× for SHORT positions
- Reduce trailing stop sensitivity: use `3 × ATR` trailing distance instead of `2 × ATR` in bearish regimes

### Fix 4: Regime-Based Position Sizing Penalty
Apply a conviction penalty (not just volatility-based sizing) when the regime is hostile:
- In bearish/strong_bearish regimes, apply 0.7× multiplier to BUY conviction before threshold check
- In bullish/strong_bullish regimes, apply 0.7× multiplier to SHORT conviction before threshold check
- This means counter-trend trades need much higher raw conviction to pass the threshold

## Expected Impact

| Metric | Before | Expected After |
|--------|--------|---------------|
| MR buys in bear markets | Allowed freely | Blocked by 200 SMA guard |
| Trend buys during 2008 rollover | Allowed (price > 200 SMA) | Blocked by slope filter |
| SHORT stops in bear rallies | 3 × ATR | 4.5 × ATR (wider) |
| Counter-trend trade sizing | Full size | 70% conviction → many filtered out |

The net effect: fewer losing trades in bear markets, shorts held longer through rallies, and the engine stops catching falling knives with mean reversion buys.

