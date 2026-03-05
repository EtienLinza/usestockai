

# Full Backtesting System

## Scope Assessment

This is a large system. The main constraint is that the current prediction engine calls Gemini AI per prediction (~2-5s each). Running hundreds of historical predictions with AI is infeasible in a single edge function (60s timeout). The solution: build a **pure-math backtester** that uses the existing indicator logic (RSI, MACD, EMA, Bollinger, consensus scoring, regime detection) without AI calls. This tests the quantitative core, which is what actually matters for backtesting.

## Architecture

```text
New Edge Function: backtest
├── Fetches 5-10 years Yahoo data for ticker(s)
├── Runs walk-forward simulation with configurable windows
├── Uses existing indicator + consensus logic (no AI)
├── Simulates trades with costs, stops, targets
├── Returns full performance report
│
New Page: /backtest
├── Configuration form (ticker, date range, strategy params)
├── Results dashboard with charts
│   ├── Equity curve (recharts)
│   ├── Drawdown curve
│   ├── Trade distribution
│   ├── Regime performance breakdown
│   └── Monte Carlo probability cone
├── Metrics cards (Sharpe, Sortino, Calmar, Win Rate, etc.)
└── Confidence calibration table
```

## Implementation Plan

### 1. New Edge Function: `supabase/functions/backtest/index.ts`

**Core engine** (reuses existing indicator functions):
- `runBacktest(config)` - main orchestrator
- Walk-forward: slides training window forward, tests on next period
- For each test period, compute indicators on training window, generate signal, simulate trade on test period
- Strategy: BUY if consensus > +30, SHORT if < -30, else HOLD
- Apply trading costs: 0.1% commission, 0.05% spread, random slippage (0.1%)
- Track equity, trades, positions

**Input config:**
```typescript
{
  tickers: string[],           // 1-5 tickers
  startYear: number,           // e.g. 2018
  endYear: number,             // e.g. 2025
  initialCapital: number,      // default 10000
  positionSizePct: number,     // default 10
  stopLossPct: number,         // default 5
  takeProfitPct: number,       // default 10
  maxPositions: number,        // default 5
  rebalanceFrequency: 'weekly' | 'monthly',
  includeMonteCarl: boolean
}
```

**Output report:**
```typescript
{
  // Walk-forward periods
  periods: { start, end, accuracy, returnPct, trades }[],
  
  // Strategy metrics
  totalTrades: number,
  winRate: number,
  avgReturn: number,
  maxDrawdown: number,
  sharpeRatio: number,
  sortinoRatio: number,
  calmarRatio: number,
  profitFactor: number,
  
  // Prediction accuracy
  directionalAccuracy: number,
  mae: number,
  rmse: number,
  
  // Regime breakdown
  regimePerformance: { regime, accuracy, avgReturn, trades }[],
  
  // Confidence calibration
  confidenceCalibration: { bucket, predictedConf, actualAccuracy, count }[],
  
  // Curves
  equityCurve: { date, value }[],
  drawdownCurve: { date, drawdown }[],
  tradeLog: { date, ticker, action, price, pnl }[],
  
  // Monte Carlo (if enabled)
  monteCarlo: { percentile5, percentile25, median, percentile75, percentile95 }
}
```

The function will fetch multi-year daily data from Yahoo, then loop through walk-forward windows computing indicators using the existing `calculateEMA`, `calculateRSI`, `calculateMACD`, `calculateSignalConsensus`, `detectRegimeEnhanced`, etc. functions (copied/shared). Each window produces a signal; trades are simulated with realistic costs.

### 2. New Page: `src/pages/Backtest.tsx`

**Configuration panel** (left side, sticky):
- Ticker input (multi-select, up to 5)
- Date range selector (start/end year)
- Capital, position size, stop loss, take profit sliders
- Max positions, rebalance frequency
- "Run Backtest" button
- Monte Carlo toggle

**Results dashboard** (right side):
- **Summary cards**: Win Rate, Sharpe, Max Drawdown, Profit Factor, Total Return, Calmar, Sortino
- **Equity Curve chart** (recharts AreaChart) with benchmark (SPY) overlay
- **Drawdown Curve** (recharts AreaChart, inverted, red)
- **Trade Distribution** (recharts BarChart - returns histogram)
- **Regime Performance** (table: regime → accuracy, return, trade count)
- **Confidence Calibration** (table: confidence bucket → predicted vs actual)
- **Walk-Forward Periods** (table: period → accuracy, return)
- **Monte Carlo** (recharts showing probability cone at 5th/25th/50th/75th/95th percentiles)
- **Trade Log** (expandable table with individual trades)

### 3. Route & Navigation Updates

- Add `/backtest` route in `App.tsx`
- Add "Backtest" nav link in `Navbar.tsx` with `BarChart3` icon
- Add config.toml entry for the new function

### 4. Key Technical Decisions

- **No AI calls in backtester** - uses pure math signals only. This is intentional: backtesting should test the quantitative model, not the AI wrapper.
- **Yahoo data limit**: fetch max 10 years daily data in chunks if needed.
- **Edge function timeout**: target < 30s. For 5-year daily data (~1250 bars) with walk-forward, the math is fast. Monte Carlo adds ~5s for 1000 shuffles.
- **Shared indicator logic**: The indicator functions will be duplicated in the backtest function (edge functions can't share code across files). This is unavoidable given Supabase edge function constraints.

### 5. Estimated Scope

- `backtest/index.ts`: ~800-1000 lines (indicator logic + simulation engine + metrics)
- `Backtest.tsx`: ~500-600 lines (config form + results dashboard + charts)
- Minor edits to `App.tsx`, `Navbar.tsx`, `config.toml`

