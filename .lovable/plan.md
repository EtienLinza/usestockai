

# Diagnosis: Three Structural Bugs Across XOM, MSFT, JPM

## Backtest Results Summary

| Metric | XOM | MSFT | JPM |
|--------|-----|------|-----|
| Total Return | -0.25% | **-4.9%** | +4.99% |
| Sharpe | 0.15 | **-1.24** | 0.56 |
| Win Rate | 37.5% | **29.6%** | 46.7% |
| Classification | momentum | momentum | momentum |
| Trend Trades | 38/40 | 43/44 | 44/45 |
| MR Trades | 2 | 1 | 1 |

## Problem 1: Everything Is "Momentum" — Classification Threshold Too Low

The classification rule is `trendScore > 0.5 → momentum`. Over any 4-6 year window (2019-2025), most stocks spend >50% of time in bullish MA alignment simply because the market was mostly bullish. XOM's `trendPersistence` is 0.559, JPM's is 0.617, MSFT's is 0.582 — all barely above 0.5, yet all get the full momentum profile.

**Consequence**: XOM (a cyclical energy stock) and JPM (a cyclical financial) get the momentum profile with +10 trend conviction bonus, 28-bar hold times, and 2.5× ATR trailing stops. These are completely wrong for stocks that mean-revert within sectors.

**Fix**: Raise the momentum threshold from 0.5 to **0.6** and use a wider blending zone (0.5-0.6). Stocks with trendScore 0.5-0.6 get a blend of momentum/value/index based on their meanReversionRate. This ensures only genuinely persistent trending stocks (like AAPL, NVDA) get the pure momentum profile.

## Problem 2: Conviction Inflation — Everything Hits 90-100

The trend conviction formula:
- 4 conditions × 20 = 80 base
- + ADX bonus: up to 15
- + MACD bonus: up to 10
- + RSI bonus: 5
- + Profile bonus: 10 (momentum)
- = **Max 120, capped to 100**

Even a mediocre signal with 3/4 conditions (60) + bonuses easily reaches 85+. MSFT shows `confidence: 100` on trades that lose 5%+. The system can't distinguish strong from weak signals.

**Fix**: Scale down the conviction formula:
- Base: conditions × **15** (was 20) — max 60 from conditions
- ADX bonus: cap at **10** (was 15)
- MACD bonus: cap at **8** (was 10)
- RSI bonus: keep at 5
- Profile bonus: **max 5** for trend (was 10)
- New max: 60 + 10 + 8 + 5 + 5 = **88** — impossible to hit 100 without exceptional confluence

## Problem 3: Mean Reversion Never Fires — Trend Monopoly

The momentum profile sets `adxThreshold: 23`, meaning MR only activates when ADX < 23. But most of the time ADX is 25-40 for these stocks, so the trend strategy takes every trade. Over 6 years, XOM got 38 trend trades and only 2 MR trades. For a cyclical stock, this is backwards.

Additionally, the momentum profile gives trend a +10 conviction bonus while giving MR +0. Even when MR conditions are met, trend conviction almost always wins the selection.

**Fix**: 
- Give the value and index profiles a **higher ADX threshold** (28-30) so MR fires more often for stocks that shouldn't be purely trend-following
- For the blended profiles (which XOM/JPM should now get), the ADX threshold will naturally interpolate to ~26-28
- Give MR a baseline conviction bonus of **5** in value profiles (was 12, which was too aggressive)

## Changes: 1 file (`supabase/functions/backtest/index.ts`)

### In `classifyStock` (~line 345):
- Change momentum threshold from `trendScore > 0.5` to `trendScore > 0.6`
- Widen blend zone: trendScore 0.5-0.6 blends momentum with value/index based on meanReversionRate
- Below 0.5 with meanReversionRate > 0.40 (was 0.45) → value classification

### In `PROFILE_PARAMS` (~line 214):
- momentum: `trendConvictionBonus: 5` (was 10)
- value: `adxThreshold: 28` (was 24), `mrConvictionBonus: 8` (was 12)  
- index: `adxThreshold: 26` (was 23)

### In trend conviction formula (~line 523):
- Base: `trendBuyScore * 15` (was 20)
- ADX bonus cap: `10` (was 15)
- MACD bonus cap: `8` (was 10)
- Same changes for short conviction

### In MR conviction formula (~line 566):
- Base: `mrBuyScore * 16` (was 18) — prevent MR from overshooting too

## Expected Impact
- XOM/JPM should classify as **value or blended** instead of momentum
- MSFT should classify as **blended momentum** (trendScore ~0.58)
- Conviction scores should spread across 62-88 instead of clustering at 85-100
- MR strategy should fire 10-15× per backtest for value/cyclical stocks
- Overall: fewer but higher-quality trades, better win rate

