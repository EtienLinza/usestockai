---
name: High-Severity Audit Fixes (H-1, H-8)
description: Holiday-aware business-day counter and correlation gate that requires a full 60-bar overlap before applying the 0.75 threshold
type: feature
---

Two audit High-severity issues fixed in `autotrader-scan/index.ts`.

**H-1 — `businessDaysSince` honors NYSE holidays**: Was `calendar_days × 5/7`, which ignored every market holiday. Now walks day-by-day, skipping weekends and any date `isMarketHoliday` reports true. Caps at 400 iterations for safety. Result: R-progress stall and time-stop now fire on schedule around holiday weeks (Thanksgiving, Christmas, July 4, etc.) instead of 1–2 days late.

**H-8 — Correlation gate requires ≥60 bars**: `pearson()` previously returned a correlation with as few as 30 overlapping bars but the 0.75 trip threshold was calibrated on a full 60-bar window. Result: short-history tickers were noisy-rejected. Both `pearson()` and `maxCorrelationToBook`'s candidate-side check now require ≥60 bars; below that the gate is a NO-OP (allowed).

Other audit Highs (H-5 bonus pool linearity, H-6 dead realKelly path) deferred — they need calibration backtests before changing.
