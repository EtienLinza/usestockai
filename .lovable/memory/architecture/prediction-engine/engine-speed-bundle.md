---
name: Engine speed bundle
description: Three latency optimizations applied to the autotrader/scan engine — fire-and-forget log inserts, CVaR base/marginal caching, rolling-window indicators. No math changes.
type: feature
---

## Optimization 1 — Fire-and-forget gate-loop log inserts
`autotrader-scan/index.ts` queues every in-loop `autotrade_log` insert into a
`logInserts: Promise<unknown>[]` via the `queueLog()` helper and drains them
with `Promise.allSettled(logInserts)` after the loop. Removes 9 awaited
round-trips per candidate (≈50-200ms each).

## Optimization 2 — CVaR base + marginal split
`_shared/portfolio-cvar.ts` now exports:
- `computePortfolioCvarBase(positions, opts)` — pre-draws shared `Float64Array`
  uniforms and computes the open book's per-path P&L once per scan.
- `computePortfolioCvarMarginal(base, candidate, nav)` — O(B·H) per candidate.

Per-candidate cost drops from O(B·N·H) to O(B·H). The autotrader builds the
base lazily, marks it dirty after a rotation close or a successful entry, and
rebuilds only on the next gate evaluation. Same RNG seed across candidates →
consistent comparisons.

`computePortfolioCvar` (one-shot form) is retained for backtests and ad-hoc
callers that don't loop.

## Optimization 3 — Rolling-window indicators
`_shared/indicators.ts` rewrites three hot indicators to O(N) running-sum form
with identical math:
- `calculateSMA` — running sum.
- `calculateBollingerBands` — running sum + running sum-of-squares
  (population variance, matches legacy ÷period).
- `calculateVolatility` — same incremental form on simple returns,
  Bessel-corrected (÷(period-1)).

EMA/RSI/ATR/Wilder were already incremental; left as-is.

## Parity test
`_shared/indicators.test.ts` validates the rewrites against the legacy
slice/reduce reference on a 1000-bar synthetic series. SMA matches to 1e-9;
Bollinger/Volatility match to 1e-6 (sum-of-squares variant is slightly less
numerically stable than the centered form but well below any signal
threshold). Run via `supabase--test_edge_functions` with pattern "parity".
