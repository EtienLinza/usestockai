# Fix the leaks, fix the loss tail, fix rotation — plus a full-engine money sweep

Verified against the live book before writing this plan (89 closed positions, 20 open).

## What the data actually says

| Metric | Value |
|---|---|
| Closed positions | 89 |
| Win rate | 73% (65 wins) |
| Avg win / avg loss | +8.60% / −7.46% |
| Net P&L | +$4,902 |
| Hard-stop exits | 15 trades, **−$6,259** |
| Rotation-opened trades | 2, **−$371** |

The engine is profitable in spite of the loss tail, not because of the entries. Two silent data leaks are also starving the learners.

## Confirmed problems (each verified by query)

**A. Learning-loop leaks — the models are training on a fraction of reality**
- `signal_outcomes` holds 42 non-open rows vs 89 closed positions; 7 tickers have no outcome row at all. Every nightly learner (calibration, meta-labeler, exit tuner, threshold tuner, user models) sees less than half the book.
- `entry_feature_snapshot` is **NULL on all 33 positions opened in the last 30 days**. The WS1 ensemble has zero fresh training rows despite the column existing.

**B. The loss tail is where all the money goes**
- Stop placement: older trades carried absurd stop distances (UAMY stop −27.7% from entry, ARTV −17.0%, ADAG −12.5%). Recent trades sit at 4–6%, so the regime-scaled ceiling is working now — but it needs a hard per-trade dollar-risk assertion so this can never regress.
- Gap-through-stop still bites: PACS filled 9.5% below its stop, DSGN 17.0% below, ADAG 7.3%, AAPU 4.8%. The gap cap sizes for a 95th-percentile gap; these were beyond it.
- Weekly P&L has been negative in 3 of the last 4 weeks (−445, −974) — the recent cohort is the sick one.

**C. Rotation is net-negative by construction**
- It only displaces **green** positions (`pnlPct > 0`) and never a red one, so it systematically harvests winners early and leaves losers to run to their stop — the exact opposite of the intent.
- `opened_by_rotation` positions are permanently immune to being rotated out, creating untouchable slots.
- Incumbent is ranked by raw P&L% only — no account of remaining edge, R-progress, time held, or the candidate's meta score.

## What I'll build

### 1. Close both leaks (priority 1)
- Make outcome writing atomic with the exit: every terminal close in `executeExit` writes/upserts its `signal_outcomes` row in the same code path, including exits that today bypass it (rotation closes, earnings-blackout closes, time stops, stale-sliver harvests).
- Backfill the missing closed positions into `signal_outcomes` so the learners get the full 89-trade history.
- Fix `entry_feature_snapshot` persistence in `executeEntry` so the snapshot built at decision time is actually stored, and backfill is not possible here — instead add a startup assertion + heartbeat that flags if snapshots stop landing.
- Extend the existing learning-loop watchdog to alert on snapshot coverage, not just outcome coverage.

### 2. Loss-tail work
- Hard dollar-risk assertion at entry: reject any entry whose `|entry − hard_stop| × shares` exceeds the per-trade risk budget, regardless of what the ATR math produced. Log the rejection so it is auditable.
- Widen gap protection: use a worse percentile (99th) for names whose realized gap distribution is fat-tailed, and refuse entry outright when even a minimum-size position can't respect the NAV gap cap.
- Stop-distance sanity cap tied to price level so sub-$20 / high-ATR names can't inherit a 25% stop.
- Winner side: let the R-ladder run its second rung further on names where the exit-meta grid says recovery odds are still high, instead of trimming at a fixed give-back.

### 3. Rotation rework
- Rank incumbents by a composite "remaining edge" score (R-progress vs bars held, current conviction re-score, meta score, distance to stop) rather than raw P&L%.
- Allow displacing **red** positions when the incumbent's thesis is broken (negative R-progress past half its max hold) — the current green-only rule is inverted.
- Drop the permanent immunity for rotation-opened positions; replace it with the same min-age gate everything else uses.
- Require the candidate to beat the incumbent on the composite score, not just conviction delta, and log the full comparison for post-hoc audit.

### 4. Full money sweep (runs alongside)
A systematic pass over the whole path — universe discovery, pre-screen, signal engine, conviction assembly, every gate, sizing, entry, every exit branch, and all nightly jobs — hunting for anything that loses money or leaves money on the table. Each finding gets logged with the query that proves it, classified as bleed / missed-gain / dead-code, and either fixed in this pass or listed for the next one. Known candidates already spotted: cost-side slippage estimates never compared against realized fills, `market-scanner` still present alongside the orchestrator path, and gate adjustments that may never be re-read by the live scan.

## Technical notes

- Main files: `supabase/functions/autotrader-scan/index.ts` (exit/entry/rotation), `_shared/adaptive-context.ts` (gap + risk primitives), `_shared/exit-meta.ts`, `calibrate-weights/index.ts` (watchdog).
- The backfill of `signal_outcomes` is a data write via the insert path, not a schema migration. No new tables are needed; existing columns cover everything.
- Sweep findings are recorded in project memory so the next session starts from the audit, not from scratch.
