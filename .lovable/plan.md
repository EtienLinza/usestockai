

# Fix: Classification Instability — XOM Gets All 4 Profiles Across Windows

## What the Logs Show

XOM's classification across ~80 walk-forward windows:
- **momentum**: ~35% (during 2021-2024 energy bull run, maAlign temporarily high)
- **value**: ~30% (during consolidation, meanRev spikes)
- **index**: ~15% (when neither metric is dominant)
- **volatile**: ~10% (during COVID crash, high ATR)
- **blended**: ~10%

The `trendScore` swings from **0.145 to 0.988** between windows. The `meanReversionRate` swings from **0.25 to 1.0**. Every 250 bars, XOM gets completely different strategy parameters — momentum hold times (28 bars) one window, then value hold times (14 bars) the next, then volatile hold times (6 bars). The strategy can't build any consistent edge when it keeps switching its entire parameter set.

## Root Cause

The classification window is only **250 bars** (~1 year). This is way too short for a cyclical stock like XOM. During any given year, XOM can look like a momentum stock (strong uptrend), a value stock (mean-reverting sideways), or a volatile stock (crash period). The 250-bar window captures a single regime, not the stock's inherent character.

## The Fix (1 file: `supabase/functions/backtest/index.ts`)

### 1. Use Expanding Window for Classification

Instead of a fixed 250-bar lookback, use **all available history up to the current bar** (capped at 1000 bars / ~4 years). This gives a more stable view of the stock's character since short regime shifts get averaged out by the longer history.

### 2. Add Classification Smoothing (EMA of Profiles)

Maintain a **running weighted average of the profile parameters** instead of hard-switching every 250 bars. When a new classification is computed:
- Blend the new profile into the running profile with a decay factor (e.g., 0.3 new + 0.7 old)
- This prevents sudden parameter jumps when the classification flips

### 3. Reclassify Less Frequently

Change reclassification interval from every 250 bars to every **500 bars** (~2 years). Combined with the expanding window, this means the classification is both more stable (longer lookback) and changes less often.

### 4. Log the Running Profile State

Add a log showing the smoothed profile params alongside the raw classification, so we can verify stability.

## Expected Impact

- XOM should settle into predominantly **value** classification (its long-term character)
- Temporary trend phases will nudge the params slightly toward momentum, not completely switch them
- Volatile crash periods will widen stops slightly, not completely restructure the strategy
- More consistent trade behavior → better risk-adjusted returns

