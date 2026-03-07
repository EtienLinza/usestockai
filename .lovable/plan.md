

# Why 917 Trades is Still the Same Problem

## Root Cause: Conviction Formula Has a Hardcoded Floor

The previous fix added a conviction threshold filter at 60. But the conviction formulas **start at 55**:

```
Trend:    55 + (adxVal-25)*0.8 + |macdH|*10 + score*5   → minimum = 55+0+0+15 = 70
MR:       50 + (30-rsi)*1.5 + |deviation|*200 + score*5  → minimum ≈ 65
Breakout: 55 + volRatio*10 + ...                          → minimum ≈ 65
```

Since every signal has conviction ≥ 65, a threshold of 60 filters **nothing**. That's why you went from 932 → 917 trades (1.6% reduction).

## The Fix: Rebuild Conviction on a 0-100 Scale

Replace the formulas so conviction = 0 means barely qualifying signal, 100 means perfect setup. No hardcoded floor.

**File: `supabase/functions/backtest/index.ts`**

### New Conviction Formulas (lines ~312-380)

**Trend conviction** (0-100 scale):
- Base = `score * 20` (3/4 = 60, 4/4 = 80)
- ADX bonus: `(adxVal - ADX_THRESH) * 0.5` (capped at +15)
- MACD momentum: `min(|macdH| * 5, 10)`
- RSI sweetspot bonus: +5 if RSI 40-60 for BUY, 40-55 for SHORT
- Total capped at 100

So a 3/4 signal = 60 base + small bonuses ≈ 65-75. A marginal signal = 60. Default threshold of 65 would filter ~30% of signals.

**Mean Reversion conviction** (0-100 scale):
- Base = `score * 18` (3/5 = 54, 4/5 = 72, 5/5 = 90)
- RSI extremity bonus: `min(|rsi - 50| * 0.3, 10)`
- Deviation bonus: `min(|smaDeviation| * 100, 10)`

**Breakout conviction** (0-100 scale):
- Base = 50 (squeeze is binary)
- Volume bonus: `min((volRatio - 1) * 20, 25)`
- Range expansion bonus: `min((range / ATR - 1) * 20, 25)`

### New Default Thresholds

- `buyThreshold` default: **65** (from 60) — filters out the weakest ~30% of trend/breakout signals
- `shortThreshold` default: **65** (from 60) — same for shorts

With these changes, adjusting thresholds from 50 to 90 will produce meaningfully different trade counts (roughly 1200 → 300 trades).

### Expected Results

| Threshold | Est. Trades | What Gets Filtered |
|-----------|-------------|-------------------|
| 50 | ~1200 | Nothing — all signals pass |
| 65 | ~600-700 | Marginal 3-condition signals |
| 75 | ~350-450 | Only strong multi-condition signals |
| 85 | ~150-200 | Only the best setups |

This is the minimum change needed to make thresholds actually control trade frequency.

