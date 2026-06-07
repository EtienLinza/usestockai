---
name: Portfolio Heat Cap (6% NAV)
description: Total open R-risk across positions capped at 6% NAV; new entries blocked when projected heat exceeds cap
type: feature
---

# Portfolio Heat Cap — Phase 4

## Rule
Σ |entry − hard_stop_price| × shares across all open positions ≤ 6% of `starting_nav`.

This is the "total portfolio heat" rule from institutional risk management:
no matter how many concurrent positions or how confident, the worst-case
loss-if-every-stop-hits-today is bounded.

## Implementation
- Pre-pass: compute `openRiskDollars` from `positions[]` using `inferHardStopPrice()` (handles legacy null-stop positions via H-7 fallback chain).
- Per-candidate: `candidateRisk = |price − hardStop| × (candidateDollars / price)`. If `(openRisk + candidateRisk) / starting_nav > 6%`, block the entry.
- Block runs even when sector/beta caps are disabled or in warn mode — heat is a non-negotiable safety rail.
- `openRiskDollars` updates intra-scan after each successful entry so stacking respects the cap.

## File
- `supabase/functions/autotrader-scan/index.ts` → portfolio heat block before `executeEntry`
