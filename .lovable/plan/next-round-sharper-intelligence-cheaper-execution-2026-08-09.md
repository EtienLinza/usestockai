# Next round: sharper intelligence, cheaper execution

WS1–WS4 plus the time stop and the outcome-write watchdog are done. Here are the highest-leverage things left, ordered by expected payoff per unit of risk. Nothing here needs new infrastructure — everything rides the nightly jobs and the scan pipeline that already exist.

## 1. Cross-sectional ranking instead of absolute floors (biggest win)

Today a name enters when its conviction clears a floor. That means in a hot tape everything clears and the book fills with mediocre trades; in a cold tape nothing clears and capital sits idle.

Change the gate to a relative one: score every candidate in the scan, then take only the top slice of the day's distribution (e.g. top 15% by blended conviction × ensemble probability), still subject to a hard minimum. The scanner already produces the full candidate list in one pass, so this is a ranking step, not extra compute.

Expected effect: fewer marginal entries in euphoric tape, and the engine stops going dark in quiet tape because "good relative to today" always exists.

## 2. Learn from rejections, not just fills

Rejected candidates are already recorded with a reason and a feature snapshot. Nothing currently checks whether the rejections were *right*. Add a nightly pass that prices what each rejected signal would have done over its horizon, then reports per-reason hit rates: if `earnings_blackout` or `correlation_gate` is systematically blocking winners, the gate's parameters get nudged (clamped, holdout-validated — same discipline as the threshold tuner).

This is the only mechanism that can make the filters *looser* where they're too strict. Every learning loop we have right now can only tighten.

## 3. Exit-side meta-labeling ("should I still be in this?")

Exits are currently geometric — stop, trail, target, time. Add a per-bar model that re-scores an open position on the same features it was entered with, plus what's happened since (drawdown from peak, days held, regime shift, whether the entry thesis indicator flipped). When the re-score collapses, exit early instead of waiting for the stop.

Trains on the same `signal_outcomes` data with a different label: "was holding one more day profitable?"

## 4. Fill realism in the live sizing path

The Almgren–Chriss slippage model exists and shapes size. Close the loop: log intended price vs realized price on every fill, then compare realized slippage to the model's prediction nightly and recalibrate the impact coefficients per liquidity bucket. Without this the cost model is an assumption forever.

## 5. Regime-conditioned strategy allocation

Strategy tilts are learned globally with a regime cell fallback. Push further: give each strategy its own capital share that breathes with regime confidence, so mean-reversion gets starved in a trending tape rather than merely down-weighted at the signal level.

## 6. Cheap wins

- **Correlation gate on the candidate set, not just the book** — two highly correlated names entering in the same scan currently pass independently.
- **Overnight-gap-aware exit** — positions with earnings or an outsized implied move inside the hold horizon get trimmed, not just blocked at entry.
- **Explanation caching** — the LLM explainer runs on top-20 signals every scan; cache by (ticker, side, conviction bucket, day) to cut gateway spend.

## Technical notes

- New nightly job: `evaluate-rejections` (prices rejected snapshots, writes per-reason accuracy, proposes clamped gate deltas). Runs alongside the existing tuners.
- Ranking gate: a percentile pass in `scan-orchestrator` after workers return, plus the same resolver in `backtest-sim.ts` so simulated and live behaviour stay identical.
- Exit meta-labeler: new shared module mirroring `meta-labeler.ts`, consumed in both exit passes.
- Slippage recalibration: add intended/realized price columns to the fill log, then fit coefficients in `calibrate-weights`.
- No new tables beyond the fill-log columns and a rejection-accuracy table.

## Suggested order

1 (ranking gate) → 2 (rejection learning) → 3 (exit meta-labeler) → 4/5/6 as follow-ups.
