# Money-Leak Repair Plan

Verified against the live book and code before writing. Three fix waves, in dollar order.

## Wave 1 — Stop the live bleed (biggest, immediate)

Confirmed open book right now: 20 open positions, 16 of them 71–93 days old.

Live stops wider than −15% (uncapped downside sitting in the book):

| Ticker | Stop distance | Age |
|---|---|---|
| ESOA | −19.2% | 73d |
| BELFB | −17.6% | 86d |
| ACLS | −16.4% | 93d |
| GLW | −15.4% | 93d |

Plus three manual positions with **no stop at all**: ADTN, ROST, TWST.

Actions:
1. One-off data fix: retro-clamp every open stop to the current regime-scaled cap (~−8% max) using each position's live price and ATR, so the pre-fix book obeys the same rule new entries do.
2. Give the three manual positions a stop (same cap logic) instead of leaving them uncapped.
3. Add an age-based force-close in the scanner that also applies to positions opened *before* the time-stop existed — the current 1.5× maxHold rule never reaches them. Rule: any position past 2× maxHold (or >60 days with no maxHold recorded) closes on the next scan.
4. Skip scans when markets are closed (weekends/holidays) — currently burning compute every 5 minutes on Sundays.

## Wave 2 — Repair the learning loop

Verified breakages:
- `signal_outcomes`: 358 rows, **0** with `meta_score` — the exit writer simply never writes the column, so the meta-labeler can never be scored against realized results.
- `rejected_signals`: 5,780 rows, **0** labeled; only 321 have an `entry_price`. The labeler requires a price, so ~94% of rejections are unlabelable by construction. `evaluate-rejections` therefore never has input.
- `entry_feature_snapshot`: NULL on all 33 entries in the last 30 days (latest entry Aug 5). The snapshot-writing code is present in the current source, so this needs a post-deploy verification on the next real entry rather than a blind rewrite.
- Downstream consequences: `model_versions` and `adaptive_signal_params` are empty (no champion/challenger, no promoted thresholds), `train-exit-meta` reports insufficient sample, 14/17 users sit at the default conviction floor.

Actions:
1. Carry `meta_score` (and the ensemble/champion score) through from entry into the `signal_outcomes` row at exit; backfill it where the entry snapshot still holds it.
2. Always stamp an `entry_price` on rejection rows at the point of rejection (use the last close the worker already has) so the nightly labeler can price them.
3. One-off backfill: price the historical rejections that do have a price, and mark the priceless ones abandoned so the queue stops looking stuck.
4. Add a coverage assertion to the nightly watchdog: alert when snapshot coverage, meta_score coverage, or rejection labeling falls below 80% instead of silently reporting "nothing to label".

## Wave 3 — Decouple sizing from mis-calibrated conviction

Conviction is non-monotonic: the 80–89 bucket is −$4,326 at 21% win rate while 70–79 is +$1,449 at 62%. Sizing scales with conviction, so the worst bucket gets the most money. Notional spread confirms it: EVMT $16.3k at conviction 71, DELL $2.3k at conviction 94.

Actions:
1. Replace raw conviction in the sizing multiplier with a **realized-expectancy weight**: bucket conviction into deciles, look up trailing realized expectancy per bucket, and size on that. A bucket with negative trailing expectancy gets minimum size regardless of its score.
2. Hard-cap single-position notional as a percentage of NAV so no one name can be 5× the next largest again.
3. Keep it adaptive — once calibration is monotonic again (Wave 2 restores the training data), the expectancy weights converge back to conviction on their own.

## Not doing yet

- Danelfin (0 rows since Aug 6) and EPS revisions (degraded since Jun 23) are offline feeds; both are secondary inputs. Worth a separate diagnostic pass after the waves above — they don't cost money directly, they just remove a tiebreaker.
- Earnings-blackout tuning: blocked 373 entries in 14 days, but whether that over-blocks can't be judged until rejection labeling works (Wave 2).

## Technical notes

- Files touched: `supabase/functions/autotrader-scan/index.ts` (stop clamp on open book, age force-close, meta_score on exit write, sizing weight), `supabase/functions/scan-worker/index.ts` (rejection entry_price), `supabase/functions/label-rejected-signals/index.ts` (abandon path), `supabase/functions/calibrate-weights/index.ts` (coverage watchdog), scan cadence gating in `scan-orchestrator`.
- Data fixes (stop retro-clamp, rejection backfill, meta_score backfill) run as data updates, not schema migrations.
- No schema changes required — every column needed already exists.
