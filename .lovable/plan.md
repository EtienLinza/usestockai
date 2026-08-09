# Close the learning-loop gap

## What I found when I looked closer

Two corrections to what I said earlier, both from reading the actual rows:

**The FTRE "duplicate entries" were not duplicates.** The four rows are partial-exit bookkeeping — each extra row closes in the same second it opens, with an exit reason like "partial: Overnight-gap trim". There is also a live unique index (`uniq_open_position_per_user_ticker`) that already prevents two open positions on the same ticker for one user. There is no stacking bug to fix. I was wrong; nothing to do here.

**The snapshot gap is real, but the cause is not yet confirmed.** All 20 open positions and all 6 opened in the last 7 days have an empty `entry_feature_snapshot`, and no closed trade in the last 30 days carries a `meta_score`. However, the entry-writing code currently in the project does include the snapshot on the insert. The most likely explanation is that the snapshot fix was written after the last entry was taken (most recent entry: 5 Aug; the file was last changed today), so no trade has run through the fixed path yet — but that is a hypothesis, not something I have confirmed. The first step below verifies it before anything is changed.

## Why this matters

Every adaptive improvement — the ensemble models, meta-labeling, conviction calibration, bucket-scaled sizing — trains on these snapshots. While they are empty, those systems are running on stale data and cannot improve regardless of how good the logic is.

## Plan

**1. Confirm the cause (no code changes)**

Trigger a scan against the live function and inspect what it writes. Three possible outcomes:

- Snapshot is written correctly on a fresh entry → the fix already works and was simply never exercised. Skip to step 3.
- Scan produces no entry candidate → force the check by tracing the value through a dry run and logging it, rather than waiting for market conditions.
- Snapshot still empty → the value is being lost somewhere between the decision and the insert; trace and fix that specific point.

**2. Fix only what step 1 identifies**

No speculative edits. If a fix is needed it lands in the autotrader scan function, at whichever point the trace shows the value dropping.

**3. Add a guard so this can never fail silently again**

Two additions:
- Log a warning at entry time whenever a position is written without a snapshot, so the gap is visible in function logs immediately rather than being discovered weeks later in the data.
- Extend the existing feedback watchdog to flag when the share of recent entries carrying a snapshot drops below a threshold.

**4. Decide on the historical gap**

The 20 currently-open positions have no snapshot and cannot be given a true one retroactively — the features were never captured at their entry moment. Options: leave them out of training (clean but loses 20 samples), or reconstruct approximate features from historical bars and mark them as reconstructed so the trainer can down-weight them. Recommendation: leave them out. Approximate features on a small sample risk teaching the model something wrong, which is worse than a smaller dataset.

## Technical detail

- `virtual_positions.entry_feature_snapshot` is populated from `e.featureSnapshot` in `executeEntry`; the value originates at the `kind: "ENTER"` return in `evaluateSignal`, built by `buildEntryFeatureSnapshot` plus `_meta_score`.
- `signal_outcomes.meta_score` is read out of the position's snapshot at exit time (`_meta_score` key), so an empty snapshot at entry guarantees a null meta score at exit. Fixing the entry side fixes both.
- The unique partial index on `(user_id, ticker) WHERE status = 'open'` is already in place; no migration is needed.
- No database schema changes in this plan.

## Expectations

This restores the data feed the adaptive systems depend on. It does not itself improve returns — the improvement comes later, once enough snapshot-carrying trades close for calibration and the ensemble to retrain on real data. Realistically that needs 40-60 closed trades before the effect is measurable.
