# Why conviction is broken, why we're making less — and the fix

## What the data actually says

I queried the live tables before writing this. Two separate problems, both confirmed.

### Problem 1: conviction can't be calibrated because it's learning from 27 trades

The active calibration row (`strategy_weights`, computed 2026-08-09) has `sample_size = 27`. Its own notes say it out loud:

- Ensemble: `skipped: true — insufficient labelled feature snapshots (27)`
- Isotonic curve: empty (`__isotonic: []`)
- Every bucket is under the minimum sample count, so only the 80-89 bucket got any adjustment at all (−8)
- `regime_prob_row_count: 0` — every trade is tagged regime `unknown`, so per-regime calibration can never form
- One single strategy exists (`trend`), expectancy −2.34%, and it is currently **benched**

Meanwhile there is a huge unused training set sitting right there:

| Source | Rows | Labeled |
|---|---|---|
| Closed trades (`signal_outcomes`) | 41 | 41 |
| Rejected signals (`rejected_signals`) | 5,780 | **58** |
| Shadow predictions (champion/challenger) | — | **0 resolved** |
| `meta_score` populated anywhere | — | **0** |

5,459 of those rejections are `earnings_blackout` and have never been counterfactually labeled. The meta-labeler score is NULL on 100% of rows, so blending it into conviction is blending a zero. Champion/challenger has never scored a single resolved prediction.

So conviction isn't "anti-predictive" — it's **unmeasured**. The 90s bucket looking bad is 9 trades. You cannot flip a curve you have no data to fit.

### Problem 2: the engine only makes money on trims, and gives it all back on the runner

Closed positions since Jul 1, grouped by what actually happened:

| Bucket | n | Total P&L |
|---|---|---|
| Partial trims (R-ladder, peak detect, gap trims) | ~25 | **+$2,100** |
| Runner left after a partial | 14 | **−$263** (avg −$19) |
| Positions never trimmed | 27 | **−$1,215** (avg −$45) |
| Hard stops (Jul onward) | 7 | **−$2,640** |

The R-ladder trims 41-50% at +1R and then moves the trail to breakeven. The remaining half then exits at breakeven, on average slightly negative. **Every dollar of profit comes from the first trim; the runner contributes nothing.** On top of that, overnight-gap trims are firing on day 0 at 33-37% of the position, before the trade has had a chance to work.

That is exactly the avg-win collapse (+9.6% → +2.8%). We didn't lose edge — we amputated the right tail and kept paying for hard stops.

## The plan

### Wave 1 — Give the model something to learn from (this is what "flips" conviction)

1. **Backfill the rejection counterfactuals.** Run the labeler across the full 5,780-row backlog in chunked batches, including `earnings_blackout` (its 5,459 rows are the single largest labeled dataset we can create). Target: 3,000+ labeled rows within a day.
2. **Train conviction on rejections + fills, not fills only.** Rejected-but-would-have-won rows are the negative-selection signal the curve is missing. Weight fills higher, but stop discarding 99% of the evidence.
3. **Fix regime tagging at write time.** Every outcome writing `regime = unknown` is why per-regime calibration has 0 rows. Persist the regime and regime probabilities on entry so buckets become conditional instead of one global blob.
4. **Populate `meta_score` on entry** and stop blending a NULL into `effectiveConviction`. Until it's actually written, the blend must be a no-op rather than a silent zero.
5. **Resolve shadow predictions** in the nightly job so champion/challenger produces a real comparison instead of 0 rows.
6. **Replace bucket-adjust with isotonic** once the labeled set clears ~300 rows, so conviction becomes monotone by construction rather than by luck.

### Wave 2 — Stop sizing off a curve we don't trust yet

7. Freeze edge-scaled sizing at a flat 1.0x until conviction is monotone across at least 3 consecutive nightly fits with n ≥ 200. Right now sizing amplifies noise.
8. Keep the loss caps exactly as they are — they work.

### Wave 3 — Restore the win tail

9. **Stop trimming on day 0.** Overnight-gap trims require the position to have survived at least 2 bars, or a genuine gap-risk trigger — not "ATR is 5% and it's unproven after 1 bar".
10. **Trail the runner wider, not to breakeven.** After rung 1, the remaining half should trail at the regime-adaptive ATR multiple (currently only used pre-trim), not snap to entry. Breakeven trailing is what converts a +1R winner into a $0 trade.
11. **Add rung 3.** Currently the ladder stops at +2R; let a third of the position ride to a peak-detection or trail exit so the +13% and +23.9% moves we already caught actually pay full size.
12. **Attack the hard-stop bleed at the source.** Stops are −$2.6k since July across 7 trades. Gate entries on the same conviction-vs-realized table once it's trustworthy, rather than tightening stops further.

### Unblock first

Zero entries since Aug 5 (2,493 HOLDs, 0 ENTRYs). The only strategy in the system, `trend`, is benched by the expectancy circuit breaker on a 27-trade sample, and the regime floor was raised to 75. Waves 1-3 can't be measured while nothing trades. First change: require a minimum sample size before the circuit breaker is allowed to bench the only active strategy, and let the floor fall back to default when the sample is below threshold.

## Technical notes

- `supabase/functions/label-rejected-signals/index.ts` — add backlog mode with chunked cursor and time budget; include `earnings_blackout`.
- `supabase/functions/calibrate-weights/index.ts` — merge rejection counterfactuals into the fit set; enable isotonic at the new sample size; gate the expectancy circuit breaker on `MIN_SAMPLES_STRATEGY`.
- `supabase/functions/autotrader-scan/index.ts` — persist `regime`/`regime_probs`/`meta_score` at entry; no-op the meta blend when NULL; exit-ladder changes (min-bars on gap trims, ATR trail instead of breakeven after rung 1, rung 3).
- `supabase/functions/manage-models/index.ts` — resolve shadow predictions nightly.
- Sizing scalar clamp lives in the adaptive-context sizing path; pin to 1.0 behind a flag until monotonicity holds.

## Expected outcome

- Labeled training rows: 41 → 3,000+
- Conviction: measurable and monotone-by-construction rather than a 27-sample coin flip
- Avg win: +2.8% → +6% target, with the −4.3% loss cap untouched
- Trading resumes instead of 2,493 consecutive HOLDs
