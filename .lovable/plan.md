

# Institutional-Grade Backtesting Upgrade

## Current State Assessment

The existing engine (790 lines backend, 547 lines frontend) covers ~40% of the checklist. Key gaps:

**Critical bugs first:**
- **Lookahead bias**: Line 398 uses `close[i]` as entry price — same bar as signal. Must use `close[i+1]` (next-bar execution).

**Missing from backend:** Trade duration, MAE/MFE per trade, VaR/CVaR, exposure metrics, CAGR/time-to-double, MAPE, avg win/loss ratio, noise injection robustness, delayed execution robustness, parameter sensitivity, stress testing (crisis detection), rolling Sharpe/volatility series, signal quality (precision/recall/F1), alpha/beta decomposition, Ulcer Index, liquidity constraints.

**Missing from frontend:** Trade return distribution histogram, monthly performance heatmap, rolling Sharpe chart, CSV export, enhanced trade stats cards, parameter sensitivity results, stress test results, robustness results.

## Implementation Plan

### Backend (`supabase/functions/backtest/index.ts`)

**1. Fix lookahead bias**
Change entry execution from `close[i]` to `close[i+1]` (next-bar open proxy).

**2. Expand Trade interface**
Add `duration` (days), `mae` (max adverse excursion during trade), `mfe` (max favorable excursion during trade) — computed during the SL/TP simulation loop which already iterates through bars.

**3. Expand `computeMetrics` output**
Add these computed from trade data:
- `avgWin`, `avgLoss`, `winLossRatio`
- `avgTradeDuration`, `medianTradeDuration`, `maxTradeDuration`
- `avgMAE`, `avgMFE`
- `valueAtRisk` (5th percentile of trade returns)
- `conditionalVaR` (mean of returns below VaR)
- `ulcerIndex` (RMS of drawdowns)
- `marketExposure` (bars in trade / total bars)
- `longExposure`, `shortExposure`
- `cagr`, `timeToDouble`
- `mape` (mean absolute percentage error)
- `signalPrecision`, `signalRecall`, `signalF1`
- `alpha`, `beta` (vs SPY benchmark regression)
- `portfolioTurnover`
- `stabilityScore` (std dev of period returns)
- `rollingSharpe` array (20-trade rolling window)
- `rollingVolatility` array
- `tradeDistribution` (histogram buckets of return %)
- `monthlyReturns` (year×month matrix for heatmap)

**4. Add parameter sensitivity test**
Run the backtest 5 times with slightly varied parameters (RSI thresholds, buy/short thresholds ±10), return performance delta. Small delta = stable = not overfit.

**5. Add noise injection robustness**
Run one additional pass with ±0.5% random noise added to prices. Compare returns — big drop = fragile strategy.

**6. Add delayed execution robustness**
Run one pass executing at `t+2` instead of `t+1`. Compare returns.

**7. Add stress testing**
Identify crisis periods in the data (drawdown > 15% in SPY over 30 days). Report strategy performance specifically during those windows.

**8. Add liquidity constraint flag**
If volume data available, flag trades where position size > 2% of daily volume.

### Frontend (`src/pages/Backtest.tsx`)

**9. Enhanced metrics section**
Add cards for: Avg Win, Avg Loss, Win/Loss Ratio, CAGR, VaR, CVaR, Market Exposure, Ulcer Index, Alpha, Beta, Stability Score.

**10. Trade distribution histogram**
BarChart of return % buckets (-10 to +10% in 1% increments).

**11. Monthly performance heatmap**
Grid colored by monthly returns (green positive, red negative).

**12. Rolling Sharpe chart**
LineChart of rolling Sharpe over time.

**13. Robustness results card**
Show noise injection and delayed execution impact as a pass/fail with percentage impact.

**14. Parameter sensitivity card**
Show results of varied parameters as a small table.

**15. Stress test results**
Table of detected crisis periods with strategy performance during each.

**16. CSV export button**
Client-side CSV generation from trade log + metrics using Blob download.

**17. Enhanced trade log**
Add duration, MAE, MFE columns.

### Scope

- Backend: ~1400 lines total (add ~600 lines of metrics/robustness logic)
- Frontend: ~850 lines total (add ~300 lines of new visualizations)
- No new files needed — all changes in existing `backtest/index.ts` and `Backtest.tsx`

