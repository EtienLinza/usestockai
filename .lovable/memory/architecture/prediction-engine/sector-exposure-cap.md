---
name: Sector Exposure Cap (autotrader)
description: Hard sector concentration block in autotrader-scan parallel to portfolio heat cap — sector ≥ sector_max_pct always blocks regardless of warn/block mode
type: feature
---

The autotrader honors `portfolio_caps.sector_max_pct` (default 35%) as a **hard block** during per-candidate evaluation in `autotrader-scan/index.ts`. Mirrors the precedent set by the portfolio-heat-cap (6% NAV): sector concentration is a non-negotiable safety rail and is **not** subject to the `enforcement_mode='warn'` toggle. The warn-mode toggle now only applies to portfolio beta.

**Mechanics:**
- Pre-pass builds `sectorDollars: Map<sector, $>` from open `virtual_positions` using `getSector()` from `_shared/finnhub.ts` (sector resolution cached).
- Per-candidate: if `(sectorDollars[sector] + candidateDollars) / starting_nav > sector_max_pct` → `action: BLOCKED` with reason `Sector cap: <sector> would reach <N>% NAV (cap <cap>%)`.
- `sectorDollars` is updated intra-scan after each successful entry so stacking respects the cap.
- Rotation closes also decrement `sectorDollars` so freshly-freed sector room is reused correctly.

**Why hard-block:** the client buy path (`portfolio-gate`) already enforces the same cap; the autotrader was the last way to bypass it. NVDA+AMD+AVGO at ρ=0.68 each pass the correlation gate independently but cluster into 3× XLK — exactly the failure mode the cap exists to prevent.

The G-5 audit gap is closed by this combination of `portfolio-gate` (client path) + autotrader sector block.
