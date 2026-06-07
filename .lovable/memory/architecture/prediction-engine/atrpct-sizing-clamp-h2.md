---
name: ATR% Sizing Clamp (H-2)
description: Clamp atrPct in volScalar denominator to [0.5%, 6%] to fix sub-$5 stocks sizing to ~zero
type: feature
---

# H-2: atrPct heuristic killing sizing for sub-$5 stocks

## Problem
`computePositionSize()` used raw `atrPct = ATR/price` as the denominator of the
vol scalar (`targetVol / atrPct`). For low-priced names (e.g. $3 stock with
$0.30 ATR), atrPct ≈ 10%, which collapses the scalar to ~0.10 and zeros the
position. Tick discreteness inflates ATR% for penny names — this is a numerical
artifact, not a real risk signal.

## Fix
Clamp atrPct used in the scalar to `[0.005, 0.06]` (`Math.min(0.06, Math.max(0.005, atrPct))`).
- 0.5% floor prevents divide-by-tiny ballooning for ultra-quiet names.
- 6% ceiling (~95% annualized) prevents sub-$5 names from being sized to zero.
  Anything above 6% is a circuit-breaker / shock case, handled elsewhere
  (CDaR breaker, regime gates), not a sizing question.

Raw `atrPct` is still used for shock detection, ATR stops, etc. — only the
volScalar denominator is clamped.

## File
- `supabase/functions/_shared/signal-engine-v2.ts` → `computePositionSize()`
