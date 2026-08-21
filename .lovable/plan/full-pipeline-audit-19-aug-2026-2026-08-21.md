# Full Pipeline Audit — 19 Aug 2026

Everything below was verified against live data this session (job heartbeats, scan runs, trade log, rejection table, bar cache). Findings are ordered by how much money/intelligence they are costing.

## What is actually healthy

- `scan-orchestrator` completes cleanly every 15 min (~42s, no worker rate-limit errors since the concurrency change).
- `autotrader-scan` runs clean: `users=1 entries=0 exits=0 errors=0` — no crashes left.
- Trading resumed: 3 automated entries on 19 Aug, 2 full exits, 7 open positions.
- Explanations are being written to `live_signals` again.
- Nightly learning crons all fire on schedule.

## Finding 1 — The scanner sees half a universe, and it's yesterday's data

Every scan today returned the identical `survivors=2438 / 6066`, `signals_found=5`. That number never moves because the pre-screen reads `ticker_bars_cache`, and 5,006 of 5,078 fresh rows are stamped `as_of = 2026-08-18`. Only 72 rows are from today.

Consequences:
- The pre-screen's "today's gap > 6%" and "intraday range > 10%" rejects are evaluated on yesterday's bar, so today's actual gappers are not filtered and yesterday's are still excluded.
- ~988 tickers have no cache row at all and get forwarded blind to workers, which fetch them live from Yahoo — the exact path that caused throttling.
- Signal count is frozen at 5 per run, so the cross-sectional gate is picking from a stale, shrunken pool.

## Finding 2 — `prefetch-bars` has never converged

Latest heartbeat: `degraded — wrote=2 failed=398 remaining=744`. The rotating offset is time-derived (`now / 10min * 400`), so consecutive runs keep landing on the same permanently-unfetchable tail (delisted/foreign/<200-bar symbols). It burns its entire 400-ticker budget on names that can never succeed, and the ~744 genuinely-stale names never get written.

## Finding 3 — Counterfactual learning is dead

`rejected_signals`: 7,727 rows total, **3,394 unlabeled**, and **zero of the 1,197 rows created in the last 7 days have been labeled**. Worse: 1,351 `earnings_blackout` rows have `entry_price = NULL` and can never be labeled at all.

This is the root cause of the conviction inversion never fixing itself. The calibrator has no counterfactual evidence about what the gates rejected, so it cannot learn that the 80–89 bucket is inverted. Downstream symptoms confirm the starvation:

- `tune-signal-thresholds`: 43 samples, 0 buckets, 0 promoted
- `train-exit-meta`: insufficient sample (40/60)
- `calibrate-weights`: samples=28, ensemble=skip

## Finding 4 — Danelfin factor contributes nothing

`refresh-danelfin-scores` heartbeat: `degraded — attempted=40/233 upserted=0 (early exit)`. Autotrader logs `Danelfin coverage 1/10`. The overlay is wired in but is effectively a no-op on ~90% of candidates. (EPS revisions by contrast are healthy: 50/77 upserted, coverage 9/10.)

## Finding 5 — Four crons are silently dead

Last successful run:

```text
market-scanner      2026-05-15
roll-calibration    2026-05-07
check-sell-alerts   2026-05-06
check-price-alerts  2026-04-26
```

`check-price-alerts` being dead means the user-facing price-alert feature has not fired in ~4 months. `roll-calibration` dead means the calibration snapshot history the UI reads is 3 months stale.

## Finding 6 — The entry funnel is choking on near-miss vol rejects

Last 48h: 1,082 HOLD, 105 BLOCKED, 3 ENTRY. Blocked reasons:

```text
47x  ATR% 6.65% > adaptive momentum ceiling 6.52%
32x  Earnings blackout: report in ~1 trading day
 5x  ATR% 7.01% > adaptive momentum ceiling 6.46%
```

47 identical rejections is one ticker re-evaluated every scan and rejected by a 0.13-point margin. That is not risk control, it's a rounding error deciding trades, and it burns a scan slot every cycle.

---

# Proposed fix order

## Wave 1 — Restore data freshness (unblocks everything else)

1. Rewrite the `prefetch-bars` rotation to be failure-aware: persist a per-ticker failure counter and skip symbols with 3+ consecutive misses for 30 days, instead of a blind time-based offset. Budget then lands on fetchable names.
2. Add a market-close prefetch pass so `ticker_bars_cache` carries the current session's bar before the next morning's scans, making the pre-screen gap/range checks operate on the right day.
3. Make the orchestrator log (and heartbeat) cache age, so a stale cache becomes visible instead of silently freezing `survivors` at a constant.

## Wave 2 — Repair the learning loop

4. Backfill `entry_price` on rejection rows at write time in `scan-worker` (the price is in scope when the blackout gate fires) so no rejection is born unlabelable.
5. Change `label-rejected-signals` to work newest-first with a maturity filter rather than oldest-first, so recent rejections — the ones calibration needs — are labeled before the ancient backlog.
6. Drop or archive the 1,351 permanently-unlabelable `earnings_blackout` rows so they stop consuming label budget.

## Wave 3 — Feeds and dead jobs

7. Diagnose the `refresh-danelfin-scores` early exit (401/402/429 tripwire) and either fix the credential/throttle or formally retire the factor rather than leaving it at 10% coverage.
8. Re-enable or delete the four dead crons. `check-price-alerts` should be re-enabled — it's a shipped user feature.

## Wave 4 — Entry funnel

9. Add a hysteresis band to the adaptive ATR ceiling (e.g. re-reject silently for N scans once a ticker fails by <0.5 points) so near-miss names stop spamming the block log every cycle.
10. Re-examine the cross-sectional cutoff of 90 against the frozen 5-signal pool — once Wave 1 restores the real candidate pool, this gate should be re-tuned rather than left at a value calibrated on stale data.

## Technical notes

- Files touched: `supabase/functions/prefetch-bars/index.ts`, `scan-orchestrator/index.ts`, `scan-worker/index.ts`, `label-rejected-signals/index.ts`, `refresh-danelfin-scores/index.ts`, `_shared/bars-cache.ts`.
- New migration needed for the prefetch failure-counter table and for re-scheduling/removing the dead cron entries.
- No changes to signal math, model weights, or gate thresholds in Waves 1–3 — those waves are purely data-availability repairs so that any later threshold change is made on honest data.
