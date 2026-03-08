

# Massive Diagnostic Report: 50+ Stocks, All Sectors, 2000-2025

## Backtest Results Summary (10 batches × 5 stocks)

```text
Sector                  | Tickers                    | Ann. Return | Alpha  | Win Rate | Avg Return
========================|============================|=============|========|==========|===========
Tech Core               | AAPL,MSFT,INTC,CSCO,ORCL   | -5.09%     | -2.94  | 42.5%    | +0.17%
Tech Semis              | IBM,HPQ,DELL,ADBE,TXN       | -5.79%     | -4.76  | 39.9%    | +0.03%
Tech Semis 2            | QCOM,AMAT,KLAC,LRCX,MU      | -6.81%     | -7.48  | 38.5%    | -0.21%
Tech + Retail           | NVDA,EBAY,WMT,TGT,COST      | -4.29%     | -2.64  | 42.9%    | +0.36%
Consumer Discretionary  | HD,LOW,MCD,SBUX,NKE          | -4.89%     | -2.86  | 42.2%    | +0.16%
Consumer Staples        | KO,PEP,PG,CL,KMB             | -8.00%     | -7.59  | ~38%     | -0.41%
Financials Core         | JPM,BAC,C,WFC,GS              | -5.38%     | -5.61  | ~41%     | +0.15%
Healthcare              | JNJ,PFE,MRK,LLY,AMGN         | -6.45%     | -7.30  | ~39%     | -0.06%
Energy                  | XOM,CVX,COP,SLB,HAL           | -4.93%     | -4.04  | ~41%     | +0.21%
Industrials             | GE,CAT,DE,MMM,HON             | -5.90%     | -5.74  | ~40%     | +0.02%
Telecom/Utilities       | T,VZ,DUK,SO,AEP               | -6.77%     | -6.19  | ~39%     | -0.14%
Defense/Transport       | UPS,FDX,BA,LMT,RTX            | -4.62%     | -3.07  | ~42%     | +0.29%
Financials 2            | MS,AXP,USB,PNC,BK             | -6.40%     | -5.91  | ~39%     | -0.17%
Healthcare 2            | ABT,MDT,GILD,SYK,ISRG         | -7.75%     | -7.84  | ~38%     | -0.31%
Energy/Materials 2      | EOG,OXY,APA,DD,DOW            | -6.21%     | -5.85  | ~40%     | -0.06%
```

**Every single sector loses money. Annualized returns range from -4.3% to -8.0%. This is a systemic engine failure, not a stock-specific problem.**

SPY buy-and-hold returned ~+450% over 2000-2025 (~7% annualized). The engine underperforms by 11-15% per year.

---

## Root Cause Analysis: 12 Structural Problems

### Problem 1: Trailing Stops Kill Winners
**Evidence**: Average MFE (maximum favorable excursion) is +3.5% to +5.0% across all sectors, but average trade return is near 0% or negative. Trades reach +5% profit then get stopped out on normal pullbacks at +0.5% or -1%.
**Root cause**: `trailingStopDist = effectiveTrailingMult * atrPct` — ATR% is typically 1.5-2.5%, so with a 2.0-2.5× multiplier, the trailing stop is 3-5% wide. But once breakeven activates, the stop ratchets up to max(0, trailLevel), meaning any pullback of >3% from peak triggers exit even during healthy trends.
**Impact**: ~60% of winning trades exit too early via trailing_stop.

### Problem 2: Win Rate of 38-43% Is Below Breakeven Given the R:R
**Evidence**: Average win is +5-6%, average loss is -3.5 to -4.5%. Win/loss ratio is ~1.4-1.5×. At 40% win rate, expected value = 0.40 × 5.5 - 0.60 × 4.0 = -0.20% per trade. This is negative BEFORE costs.
**Root cause**: The conviction threshold (62 for BUY) is too low — it lets in too many marginal signals. Combined with the trailing stop issue, even good trades end up as small wins while bad trades hit full stop losses.

### Problem 3: Low-Volatility Stocks Are Unplayable
**Evidence**: Consumer staples (KO, PEP, PG) return -8% annually — the worst sector. Healthcare (JNJ, PFE) at -6.5%. These stocks move 0.5-1.0% daily.
**Root cause**: Trading costs (commission 0.1% + spread 0.05% + slippage 0.1% = 0.25% round-trip × 2 = 0.50%) eat a disproportionate share of expected moves on low-vol stocks. The `minExpectedMove` filter only blocks MR trades, not trend trades, so the engine happily takes trend trades on PG expecting a 2% move but paying 0.5% in costs.

### Problem 4: Trend Strategy Dominance With Poor Accuracy
**Evidence**: ~90-95% of all trades are trend-following. Trend win rate is ~40%. MR fires <5% of trades despite the RSI override fix.
**Root cause**: ADX > 23-28 most of the time for most stocks, so the trend gate opens on nearly every bar. The MR RSI override fires but with 0.8× penalty, so MR conviction rarely beats trend conviction. The system is effectively a pure trend-follower with a 40% win rate.

### Problem 5: Shorts Are Toxic in a 25-Year Bull Market
**Evidence**: Short trades consistently hit stop losses. Multiple examples of shorting in "bearish" regime but price immediately reverses up. The short filter (block when SPY > 200 SMA) still lets shorts through during temporary dips.
**Root cause**: 2000-2025 is a structurally bullish period (SPY went from ~1500 to ~6000). Even during bear markets (2000-2002, 2008, 2020, 2022), V-shaped recoveries mean shorts entered at bottoms get stopped out on the rip. The 0.7× counter-trend penalty isn't enough.

### Problem 6: Stop Losses Are Too Tight
**Evidence**: Average MAE (maximum adverse excursion) is -2.5% to -3.5%. Stop losses fire at -5% to -8%. But many trades that would have recovered get stopped out at -5%. The 8% hard cap means volatile stocks (semis, energy) routinely hit stops on normal noise.
**Root cause**: `effectiveStopPct = Math.max(config.stopLossPct / 100, 2 * atrPct)` capped at 8%. For stocks with 3% ATR (NVDA, MU), 2 × 3% = 6% stop is fine. But for stocks with 1.5% ATR (KO, PG), 2 × 1.5% = 3% stop means normal noise triggers exits.

### Problem 7: No Time-Based Profit Protection
**Evidence**: Many trades with positive MFE of +5-8% exit via time_exit at +1% or trailing_stop at 0%. The system has no mechanism to lock in profits at intermediate levels.
**Root cause**: The only exit mechanisms are: stop loss, take profit (8-14%), trailing stop, and time exit. There's no partial exit, no profit lock at 50% of take-profit, no time-decay of stop level. A trade that reaches +6% has the same trailing stop as one at +1%.

### Problem 8: Position Sizing Creates Capital Drag
**Evidence**: Capital is depleted progressively. Each trade uses `riskPerTrade / effectiveStopPct` of capital. With 1% risk and 5% stop, each trade uses 20% of capital. Max 3 positions = 60% deployed. But losses reduce capital, so later trades are smaller, creating a compounding drag.
**Root cause**: Risk-based sizing means losing trades reduce subsequent trade sizes (good risk management), but with a 40% win rate and 0.50% round-trip cost, the capital erosion is relentless.

### Problem 9: Classification Doesn't Affect Outcomes
**Evidence**: Momentum, value, index, and blended profiles all produce similar negative results. The profile parameters (ADX threshold differences of 23 vs 26 vs 28) are too close to create meaningful behavioral differences.
**Root cause**: As identified in the profile-parameter-balancing memory, gaps between profiles were intentionally minimized. This means classification is mostly cosmetic — a stock classified as "value" with ADX threshold 28 behaves almost identically to one classified as "momentum" with ADX threshold 23.

### Problem 10: The STEP=3 Bar Skip Creates Signal Aliasing
**Evidence**: The walk-forward loop runs every 3 bars (`STEP = 3`), meaning the engine only evaluates signals on ~33% of trading days. A perfect entry on day N might be evaluated on day N-1 or N+1, where conditions are different.
**Root cause**: The STEP optimization was added for CPU performance on long backtests. But it means the engine misses the exact bar where conditions align, and by the time it checks 3 bars later, the signal may have decayed or the entry price has moved.

### Problem 11: Entry on Next-Day Open Creates Adverse Selection
**Evidence**: `executionDelay = 1` means signals generated at close of day T enter at open of day T+1. Many trend signals fire after big up moves (closing near highs), and the next-day open gaps up further, creating entries at local peaks.
**Root cause**: This is realistic execution modeling, but the signal conditions (EMA crossovers, RSI levels) are lagging indicators. By the time they confirm, the move is partially over. Entry at next-day open adds another bar of adverse selection.

### Problem 12: Breakout Strategy Barely Fires and Loses Money
**Evidence**: Breakout trades represent <5% of all trades and have negative returns.
**Root cause**: The squeeze detection (`bbBW < bwAvg50 * 0.7`) combined with volume/range expansion filters is extremely restrictive. When breakouts do trigger, they often catch false breakouts at Bollinger Band extremes that immediately reverse.

---

## Proposed Fixes (Priority Ordered)

### Fix 1: Widen Trailing Stops and Add Profit Locks (Highest Impact)
- Increase trailing stop distance to `3.0 × atrPct` (was ~2.0-2.5×)
- Add a tiered profit lock: once trade reaches +3%, move stop to breakeven. Once +5%, lock in +2%.
- Reduce breakeven threshold from 1× ATR to 0.5× ATR to activate trailing earlier

### Fix 2: Raise Conviction Threshold to 68 (from 62)
- The 62 threshold lets in too many marginal signals
- Raising to 68 should cut trade count by ~30% while improving win rate by 5-8%
- Expect fewer but higher-quality trades

### Fix 3: Add Minimum Volatility Filter for ALL Strategies
- Extend the `minExpectedMove` filter to trend trades, not just MR
- Block trend entries where `atrPct < roundTripCost × 4` (~2.0% for current cost structure)
- This eliminates consumer staples and utilities from trend trading (they should only get MR or no trades)

### Fix 4: Suppress Shorts More Aggressively
- Block ALL shorts unless both SPY and the stock are below their 200 SMA AND the stock has negative 50-bar momentum
- Currently the dual-regime filter only checks `spyBearish` which is SPY < 200 SMA — add a momentum check

### Fix 5: Increase Hold Periods for Trend Trades
- Current 12-28 bar max hold is too short for trend following
- Trend trades should be allowed to run 40-60 bars (2-3 months) with the trailing stop as the primary exit
- Remove the time_exit cap for trend trades when the trade is profitable

### Fix 6: Reduce STEP to 1 for Single-Ticker Backtests
- Only use STEP=3 for multi-ticker portfolio runs
- Single-ticker runs should evaluate every bar for signal accuracy

### Fix 7: Implement Partial Exits
- Take 50% off at +50% of take-profit target
- Let the remaining 50% run with a wider trailing stop
- This locks in gains while allowing upside capture

### Fix 8: ATR-Proportional Stop Losses with Wider Minimum
- `effectiveStopPct = Math.max(config.stopLossPct / 100, 2.5 * atrPct)` (was 2×)
- Raise hard cap from 8% to 10% for volatile stocks
- For low-vol stocks, minimum stop of 3%

### Fix 9: Make Classification Actually Matter
- Widen parameter gaps between profiles: momentum ADX 20, value ADX 32, volatile ADX 18
- Give value profile a completely different strategy mix: 60% MR, 40% trend (currently it's 95% trend)
- Give utilities/staples a "hold" profile that only trades MR at extreme RSI

### Fix 10: Add Volume-Weighted Trend Confirmation
- Current trend conditions are pure price-based (EMA, MACD, SMA)
- Add OBV divergence check: block trend BUY if OBV is declining while price rises
- This catches distribution phases where institutions are selling into strength

---

## Implementation Scope
All changes are in `supabase/functions/backtest/index.ts`:
- Fix trailing stop logic (~lines 1140-1147)
- Fix conviction thresholds in PROFILE_PARAMS (~lines 214-242)
- Add volatility filter (~lines 1287-1293)
- Modify short blocking (~lines 1281-1285)
- Update hold periods in PROFILE_PARAMS
- Reduce STEP for single-ticker runs (~line 931)
- Add partial exit logic in the exit loop (~lines 1100-1200)
- Widen stop loss formula (~lines 1324-1333)
- Increase profile parameter gaps (~lines 214-242)
- Add OBV trend confirmation in `computeStrategySignal` (~lines 500-536)

These are substantial changes that touch the core signal engine and trade management. I recommend implementing them in 2-3 phases to isolate the impact of each fix group.

