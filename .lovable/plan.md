# Adaptive Aggressive Mode: every number learns, inside hard walls

Goal: replace the fixed Aggressive numbers with values the engine recalculates from your own results and the market's mood. Each number has a hard outer wall it can never cross.

## What changes for you

1. **Trade size breathes.** The starting size (now fixed at 8%, or 12% for top picks) moves up when recent trades are winning and the market is calm, and down when trades are losing or the market is jumpy.
2. **Buy score adjusts itself.** The minimum score (now 62) rises in a rough market and drops when lower-scored picks have been making money.
3. **Per-stock and total limits follow the market.** The single-stock cap (15%), the "money at risk" cap (10%) and the bad-day loss cap (4%) loosen in calm markets and tighten in stressed ones.
4. **Profit targets learn.** The profit ceiling (25%) and the point where the trailing stop starts follow how far your winners actually ran.
5. **Size cuts get learned weights.** The "nudges" for risky setups (correlation, high volatility, drawdown) become stronger or weaker depending on whether those warnings actually predicted losses.
6. **You can see why.** Every trade in the log shows which numbers were used and why; Settings shows tonight's values next to their walls.

## Hard walls (never adaptive)

- Single stock: 5% min, 20% max.
- Total invested: never above 100% (no borrowing).
- Max loss on one trade: about 8%.
- Drawdown brake: past 15% from peak, sizes halve no matter what.
- Kill switch, daily loss limit, market-hours-only entries, bad-quote rejection.
- Needs at least 20 closed trades before any number moves off its starting value; at most a small step per night.

## How it adapts

```text
Nightly (once):  your last 60 days of trades + market mood
                 -> new band for each number (clamped, small step)
Every trade:     band + live market mood + that trade's score
                 -> final number used, written to the log
```

## Order of work

1. New nightly tuner that writes tonight's values and the reasons.
2. The live autotrader reads tonight's values instead of fixed numbers; falls back to today's numbers if none exist.
3. Per-trade scaling by score and live market mood.
4. Trade log and Settings show the values used.
5. Confirm with a live scan after the open.

## Technical details

- New table `adaptive_risk_params` (user_id, computed_at, params jsonb, bounds jsonb, reasons jsonb, sample_size, is_active); service_role write, owner read; GRANTs + RLS in the same migration.
- New edge function `tune-risk-params` (verify_jwt=false, cron-secret auth), nightly 04:00 UTC — one job, once a day. Inputs: `virtual_positions` (60d), `signal_outcomes`, `autotrader_state` VIX/SPY, `rejected_signals` counterfactuals for haircut weights. Bounded per-user loop, single-flight lease row, no AI calls.
- Tuned keys: `min_entry_frac`, `top_entry_frac`, `single_name_cap`, `heat_cap_pct`, `cvar_cap_pct`, `min_conviction`, `tp_ceiling_pct`, `trail_arm_r`, `haircut_corr`, `haircut_atr`, `haircut_dd`, `haircut_floor`. Bounds and max nightly step in a new `_shared/adaptive-risk.ts` (single source; backtest imports the same file).
- Live modulation in `autotrader-scan`: value × f(regimeScore) × g(conviction), then clamped to the hard wall. Replace `AGGR_*` constants with `resolveRiskParams()`; existing constants become the cold-start defaults.
- `autotrade_log.reason` gets the used values appended; `autotrader_state.adjustments` stores the band. Settings shows a read-only "Adaptive limits" panel.
- Requires the backend to be running to apply the migration, deploy, and schedule.
