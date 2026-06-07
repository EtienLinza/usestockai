---
name: CDaR Circuit Breaker (idea #13)
description: 30-day Conditional Drawdown-at-Risk (α=0.95) breaker layered on top of the peak-to-current MTM breaker — graduated tightening + hard block
type: feature
---

`autotrader-scan/index.ts` now computes **CDaR_0.95** alongside the existing peak-to-current 30-day drawdown.

CDaR construction (from `virtual_portfolio_log.total_value` over the last 30 days):
1. Build the per-bar drawdown series `dd_t = (runningPeak − value_t) / runningPeak × 100`.
2. Sort descending, take the worst `ceil(N × (1−α)) = ceil(N × 0.05)` observations (≥1 sample, requires ≥5 NAV points).
3. CDaR = mean of that tail.

Thresholds (constants `CDAR_*` at the top of the file):
- **≥12% — hard block** in `runEntryDecision` (independent of `adaptive_mode`, same priority as the existing `ROLLING_DD_HARD_BLOCK_PCT` peak-to-current 10% rule).
- **≥8% — `+5 conv, NAV×0.5`** (Layer 3c, adaptive only).
- **≥5% — `+2 conv, NAV×0.85`** (Layer 3c, adaptive only).

Why CDaR on top of peak-to-current:
- Peak-to-current is a *single observation* — silently misses books that bled 2% × 15 days because the latest snapshot rallied half-back.
- CDaR averages the worst tail of the path → triggers on **persistent slow bleeds** before the snapshot does.

`current_cdar_pct` is added to `AutotradeSettings` and surfaced via `BLOCKED` reason strings + the `adjustments[]` jsonb on `autotrader_state` (no new DB column — the figure appears in adjustment strings like `CDaR 8.3%: +5 conv, NAV×0.5`).
