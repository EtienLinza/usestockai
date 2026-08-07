# Adaptive Position Cap — Full Upgrade

## Where it stands today (verified)

The position cap is only *partially* adaptive. In `computeEffectiveSettings` (shared live + backtest), adaptive mode gets: NAV-based base (`nav/12500`, capped by profile), and crude step bumps — calm VIX +1, elevated −1, crisis hard-capped at 3, big drawdowns −2. In manual "advanced mode" the number you set is used verbatim with zero adaptation. The July incident showed the failure mode: 8/8 slots clogged by stale losers while good signals were blocked.

## Changes

### 1. Continuous regime scaling (replaces step bumps)
The engine already computes a continuous `regimeScore` (0.6×VIX + 0.4×SPY trend) to scale NAV exposure — the position cap will ride the same score:

```text
maxPos = round(base × (0.5 + 0.5 × regimeScore))
calm bull market → full base slots
choppy/elevated  → ~60-80% of base
crisis VIX       → hard cap 3 (unchanged safety rail)
```

### 2. Hot/cold streak feedback — the cap learns
New per-user trailing stats (30d window, min 8 closed trades, computed from the same `virtual_positions` query pattern the scan already runs):

- **Hot streak** (win rate ≥ 55% AND positive avg P&L): +1 to +2 slots, up to the profile ceiling. When the book is working, let it run wider.
- **Cold streak** (negative trailing expectancy): −1 to −2 slots, floor of 2. Bleeding shrinks capacity automatically, recovers as the record improves.

Every adjustment is logged to the existing `adjustments` reason strings, so the Settings "effective" panel shows exactly why the cap moved.

### 3. Manual mode becomes a ceiling (per your choice)
Advanced-mode users keep their number as the maximum, but it now *shrinks* in danger: crisis VIX cap, rolling drawdown ≥8% (−2), CDaR/7d-loss tightening. It never expands above what was set.

### 4. Backtest parity (non-negotiable project rule)
`backtest-sim.ts` builds its per-day adaptive context from simulated closed trades with the same streak fields, so the backtest breathes identically to live.

### 5. Settings UI copy
Relabel the manual input to "Max positions (ceiling)" and note it shrinks automatically in crises. The existing "effective max positions" display needs no change.

## Technical details

- **Files**: `supabase/functions/_shared/adaptive-context.ts` (core math + constants), `supabase/functions/autotrader-scan/index.ts` (populate new streak fields on the adaptive context), `supabase/functions/_shared/backtest-sim.ts` (parity), `src/pages/Settings.tsx` (label copy).
- **New constants**: `POS_STREAK_LOOKBACK_DAYS=30`, `POS_STREAK_MIN_SAMPLES=8`, `POS_HOT_WIN_RATE=0.55`, adaptive floor 2, clamp stays [1, 20].
- **No new tables, columns, or secrets** — `autotrader_state.effective_max_positions` already stores and displays the breathing value.
- Rotation triggers at `>= max_positions`, so it automatically respects the breathing cap with no changes.
- Deploy `autotrader-scan` and verify the next scan's `autotrader_state` reason string reflects the new math.

## What this does NOT do
- Never exceeds 20 positions or your set ceiling; never drops below 1-2 slots.
- Doesn't change *which* signals enter — only how many slots exist at a given moment.
