# Adaptive Constants Sweep — Phase 1 shipped, 2/3 queued

## What shipped (Phase 1 — autotrader-scan)

Every one of these was previously a hard-coded literal; all now scale with
market regime, VIX-stress, ATR%, and calibrated conviction floors. Hard
safety rails (portfolio heat cap 6%, hard stop never widens, earnings ≤3d
blackout, single-name & sector caps) intentionally left fixed.

| Constant                       | Before      | After (adaptive on)                                        |
|--------------------------------|-------------|------------------------------------------------------------|
| `CORR_THRESHOLD`               | 0.75 fixed  | 0.60–0.80 by marketRegime, tightened by `macro.stressed`   |
| `MIN_PROFIT_FOR_PEAK`          | 0.06 fixed  | `clamp(3 × atrPct, 0.03, 0.12)` per position               |
| `MIN_RISK_PCT` / `MAX_RISK_PCT`| 0.30% / 0.60%| Regime-scaled window; bear_vol shrinks to 0.20%/0.45%, bull_quiet expands to 0.35%/0.70% |
| `MAX_ENTRIES_PER_SCAN`         | 2 fixed     | 1 (bear_vol) → 4 (bull_quiet); −1 when `current_drawdown_pct ≥ 5` |
| `HIGH_CONVICTION_ROTATION_FLOOR`| 85 fixed   | `max(85, settings.min_conviction + 15) + 5 if bear_volatile` |
| `MIN_POSITION_AGE_MS`          | 30 min fixed| Scaled by SPY 20-bar realized vol (0.5×–2× band)          |

All three correlation-gate call sites (fresh entry, add-on, intra-scan
stacking) now source the same `adaptiveCorrThreshold(marketRegime, vixReg)`
helper so behavior stays consistent across the pipeline.

Typechecked via `deno check autotrader-scan/index.ts` — clean.

## Phase 2 — signal-engine-v2 + scan-worker (queued)

Highest-leverage remaining hard-coded thresholds:

- `TARGET_VOL = 0.015` in `chooseSignal` (line 934) — should scale with regime.
- Divergence bonus/penalty: `divBonusBase = 6`, `divPenaltyMult = 0.85` (843–845)
  — could scale with ATR% (bigger effect on high-vol names).
- Trend/MR/BO conviction sub-scoring RSI bands (35–75, 25–60, 40–60, 40–55)
  — regime-shift by ±5 in trending vs choppy tapes.
- `hhWindow = 20` breakout lookback (251) — could scale with ATR% (shorter
  window on volatile names).
- Confidence bump `regime.includes("strong") → +3` (942) — could scale with
  strategy tilt magnitude from calibration.
- `TOP_N_EXPLAIN = 20` in scan-worker — could scale with total signal count.

## Phase 3 — backtester (queued)

- Sharpe/Sortino annualization already correct (√252 confirmed).
- Bar-cooldown, ATR multipliers, trend-guard SMA windows (200/50) — evaluate
  whether adaptive windows outperform on regime-shift historicals.
- Monte-Carlo shuffle count (1000) — could scale with sample size.
- Walk-forward train/test split (60d/5d) — could adapt to realized volatility
  cluster length.

Each of Phase 2 and Phase 3 deserves its own turn with focused diffs and a
backtest A/B run before shipping, given how much these constants affect
signal generation and historical claims.
