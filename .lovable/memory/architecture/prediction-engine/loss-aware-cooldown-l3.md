---
name: Loss-Aware Cooldown (L-3)
description: Extend post-exit cooldown 1.5x for losses, 2.0x for hard-stop / regime-breaker exits to suppress revenge entries
type: feature
---

# L-3: Loss-aware cooldown multiplier

## Problem
Cooldown after `FULL_EXIT` was a flat per-profile constant (7–21d). A stop-loss
hit means the thesis broke — re-entering the same ticker on the standard
schedule ignores that signal, especially in volatile regimes where the same
catalyst can re-fire within days.

## Fix
In `executeExits` (autotrader-scan), multiply the base cooldown:
- `2.0×` if reason matches `hard_stop | stop_loss | regime_breaker | cdar` (hardest exits)
- `1.5×` if `pnl < 0` (any losing exit)
- `1.0×` otherwise (target hit / time exit / partial → full)

Per profile:
| profile  | base | loss | hard stop |
|----------|------|------|-----------|
| value    | 21d  | 32d  | 42d       |
| momentum | 14d  | 21d  | 28d       |
| volatile | 11d  | 17d  | 22d       |
| index    |  7d  | 11d  | 14d       |

## File
- `supabase/functions/autotrader-scan/index.ts` → `executeExits` FULL_EXIT branch
