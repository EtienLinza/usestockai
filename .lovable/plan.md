# Production Punch-List — Backtest, Dashboard, AutoTrader, UI

Grouped by area so we can ship in independent PRs. Each item lists the file(s) touched and the exact change.

## 1. Signal engine bugs (`supabase/functions/_shared/signal-engine-v2.ts`)

These are the root cause of the broken backtest sliders, Monte Carlo, and misclassifications.

1. **Parameter override plumbing** — add an optional `paramOverrides?: Partial<ProfileParams>` arg to `evaluateSignal` and merge it on top of `cls.blendedParams || PROFILE_PARAMS[cls.classification]`. Thread the same override through `computeStrategySignal` so `buyThreshold` / `shortThreshold` actually move when the backtester sweeps them.
2. **Tracker cache pollution** — `signalTrackerCache` persists across runs. Call `clearTrackerCache()` at the top of every backtest run *and* every Monte Carlo iteration (`supabase/functions/backtest/index.ts`). Optionally accept an injected `Map` so concurrent runs are isolated.
3. **Higher-Highs uses `close` instead of `high`** (line ~220). Swap both `close.slice(...)` calls in `classifyStock` to `high.slice(...)`.
4. **Volume z-score leak** (line ~551 + post-signal block). Slice `volume.slice(n - 21, n - 1)` so the current bar isn't in its own baseline. Re-validate `sig.confidence` against `buyThreshold`/`shortThreshold` **after** the volume adjustment and downgrade to HOLD if it drops below; also mirror the confidence change into `sig.consensusScore` so the decision engine sees the same number.

## 2. Backtest engine (`supabase/functions/backtest/index.ts`, `src/pages/Backtest.tsx`)

5. **Parameter sensitivity** — pass the swept threshold into `evaluateSignal` via the new `paramOverrides`. Verify rows differ by >0% before returning; if they don't, set `parameterSensitivityVaried = false` and surface the warning we already render.
6. **Monte Carlo distribution** — confirm each of the 200 sims (a) calls `clearTrackerCache()`, (b) reshuffles the trade-return array (bootstrap, not a single static seed), and (c) computes percentiles from the resulting equity distribution. Add a unit guard: if `p5 === p50 === p95`, throw a "degenerate distribution" error so it surfaces in logs.
7. **Monthly-return heatmap anomalies** — audit the per-month aggregation: clamp single-trade monthly returns, divide cumulative P&L by *starting* equity for that month (not running equity), and skip months with zero trades instead of carrying forward stale values.

## 3. Dashboard math (`src/components/dashboard/TradingTab.tsx`, `src/pages/Dashboard.tsx`)

8. **Profit Factor includes unrealized P&L.** Today it only sums closed trades. Change `profitFactor` useMemo to fold `getUnrealizedPnL(pos)` for every open position into the gross-profit / gross-loss buckets.
9. **Equity-curve Y-axis** — replace the hardcoded domain with `domain={[min * 0.95, max * 1.1]}` driven by the actual series so the curve fills the chart.

## 4. AutoTrader logic (`supabase/functions/autotrader-scan/index.ts`)

10. **Capital rotation when 8/8 full** — when all slots are taken and the scanner surfaces a signal with `confidence > 85`, compare it to the worst-performing open position (by unrealized P&L %). If the new signal beats it by a configurable margin (default 15 conviction points), close that position and open the new one. Add a per-day rotation cap (e.g. 3) to prevent churn.
11. **Emergency Stop modes** (`src/pages/Settings.tsx` + autotrader) — replace the single boolean with `emergency_mode: 'off' | 'freeze_entries' | 'liquidate'`. `freeze_entries` keeps stop-losses / take-profits running; `liquidate` market-sells every open virtual position immediately, then freezes entries.

## 5. Risk & UI polish

12. **Default risk enforcement to enabled** — flip `portfolio_caps.enabled` default to `true` in the seeding trigger and in `Settings.tsx` initial state, and add an onboarding prompt.
13. **Max NAV formatting** — wrap the displayed value in `.toFixed(1)` in `Settings.tsx` (and any other place showing `effective_max_nav_exposure_pct`).
14. **Synthetic ticker filter** (`src/components/WatchlistSuggestions.tsx` + add server validation) — before suggesting a ticker, call a small `validate-ticker` edge function (or reuse `fetch-stock-price`) that confirms Yahoo returns a real quote with non-null `regularMarketPrice`. Drop any ticker that fails.

## Technical details

- **Override merge order in `evaluateSignal`**: `{ ...PROFILE_PARAMS[base], ...cls.blendedParams, ...paramOverrides }` so blended classification stays the baseline and the backtester is the highest-priority override.
- **Tracker isolation**: simplest path is `evaluateSignal(..., trackerCache?: Map<string, SignalState>)` defaulting to the module-level one; backtester passes a fresh map per run.
- **Profit Factor with unrealized**:
  ```ts
  const grossWins = closedWins + openPositions.filter(p => getUnrealizedPnL(p) > 0).reduce(sum, 0);
  const grossLoss = closedLosses + Math.abs(openPositions.filter(p => getUnrealizedPnL(p) < 0).reduce(sum, 0));
  ```
- **Equity domain**: Recharts `<YAxis domain={[dataMin => dataMin * 0.95, dataMax => dataMax * 1.1]} />`.
- **Capital rotation**: needs a DB column `virtual_positions.opened_by_rotation` to avoid loops; rotation skips positions opened <30 min ago.
- **Liquidate mode**: reuse the existing `check-sell-alerts` exit path so accounting stays consistent.

## Suggested order

1. Signal-engine bug fixes (1–4) — unblocks the backtester.
2. Backtest engine wiring (5–7) — proves the fixes.
3. Dashboard math (8–9) — quick wins, no backend risk.
4. UI polish (12–14) — cheap, ship alongside.
5. AutoTrader rotation + emergency modes (10–11) — biggest behavioral change, ship last with explicit user warning.

Want me to start with the signal-engine block (items 1–4) or jump straight to the AutoTrader rotation/emergency logic?
