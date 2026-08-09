---
name: Engine Money Sweep & Payoff Fix
description: Live-fill risk re-assertion, rotation v2 (remaining-edge ranking), and snapshot/outcome coverage watchdogs
type: feature
---

Fixes for the three measured money leaks (hard stops −$6,259; rotation-opened trades −$371 while the book made +$5,273).

## 1. Live-fill risk re-assertion (`autotrader-scan/executeEntry`)
Sizing and the stop cap were decided against the **signal** price, then `executeEntry`
re-derived the stop from the **live** quote with the original ATR multiplier and sized with
`starting_nav` — so the % stop distance and the dollar risk were both unbounded at fill time.
`EntryAction` now carries `riskBudgetDollars`, `stopCapPct`, `navForSizing`, `metaScore`, and
`executeEntry`:
- re-clamps stop distance to `stopCapPct × fillPrice`,
- sizes off `navForSizing` (current NAV) instead of `starting_nav`,
- caps shares at `riskBudgetDollars / liveStopDistance`, logging a BLOCKED row if that lands below 1 share.

## 2. Rotation v2 — remaining edge, not raw P&L
v1 only displaced **green** positions and made `opened_by_rotation` positions permanently
immune, i.e. it harvested winners early and let losers run into stops.
v2 scores every incumbent: `score = progressR − 0.6 × (barsHeld / maxHold) − 0.75 if brokenThesis`.
- Eligible: age ≥ `MIN_POSITION_AGE_MS` **and** (`brokenThesis` or `progressR < 0.5`). Real winners are untouchable.
- Rotation immunity removed — rotation-opened positions can themselves be displaced.
- Conviction hurdle halves (min 5) when the incumbent's thesis is broken.

## 3. Watchdogs (`calibrate-weights`)
- Leak detector now excludes `exit_reason LIKE 'partial:%'` rows — partial slices are accounting
  rows, never outcomes; counting them produced false "46% missing" alarms.
- New **snapshot-coverage** check: <80% of 30d autotrader entries carrying
  `entry_feature_snapshot` → critical `drift_detections` row + `learning-loop` heartbeat degraded.
  Without this the WS1 ensemble trainer goes blind silently.
