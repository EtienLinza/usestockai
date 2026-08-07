---
name: Adaptive Position-Slot Budget
description: Max-positions cap is fully adaptive — continuous regimeScore scaling + hot/cold streak feedback; manual advanced-mode setting is a ceiling that only shrinks
type: feature
---

The position cap breathes like NAV exposure. All math lives in `computeEffectiveSettings` (`_shared/adaptive-context.ts`) — the single source for live + backtest.

- **Continuous regime scaling**: `maxPos = max(POS_FLOOR_ADAPTIVE=2, round(posBase × (0.5 + 0.5 × regimeScore)))` — rides the same regimeScore as NAV exposure. Replaced the old stepwise VIX ±1 slot bumps (calm/elevated no longer touch slots; crisis still hard-caps at 3).
- **Streak feedback**: ctx carries `recentWinRate` / `recentAvgPnlPct` / `recentClosedCount` (trailing `POS_STREAK_LOOKBACK_DAYS=30`, needs `POS_STREAK_MIN_SAMPLES=8`). Hot (WR ≥ `POS_HOT_WIN_RATE=0.55` and positive expectancy) → +1/+2 slots capped at profile baseline; cold (negative expectancy) → −1/−2, floor 2. Expansion runs BEFORE safety shrinkers so crisis/drawdown/CDaR always win.
- **Manual (advanced) mode**: user setting is a ceiling — safety-only shrink (crisis → 3, 30d dd ≥8% → −2, 7d loss ≤−5% or high CDaR → −1), never expands.
- **Callers**: `autotrader-scan` derives streak stats from one 30d `virtual_positions` query (pnl + exit_date; 7d P&L filtered client-side from the same rows). `backtest-sim` filters `state.closedTrades` by 30-cal-day cutoff each stepDay — parity is mandatory.
- Effective value + reasons already persist to `autotrader_state` and render in Settings; rotation triggers off `eff.max_positions` so it respects the breathing cap automatically.
