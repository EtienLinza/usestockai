---
name: Short-Interest Velocity Overlay
description: ±6-point supporting conviction delta from 30-day SI velocity; mirrors EPS-revision overlay on a different fundamental axis
type: feature
---
**Module:** `_shared/short-interest.ts` exports `getShortInterest`, `loadShortInterestMap`, `upsertShortInterest`, `shortInterestConvictionDelta`.

**Data:** `short_interest_history(ticker, report_date, si_pct_float, days_to_cover, velocity_30d)`. Refreshed nightly by `refresh-short-interest` cron (03:00 UTC weekdays) via Finnhub `/stock/short-interest`. Free-tier safe — 1.1s throttle, 300 ticker cap per run, fail-streak early-exit at 5.

**Velocity:** `(latest_si_pct - prev_si_pct) / |prev_si_pct|` over ~30-day SI settle cycle.

**Conviction delta (long side; short side inverts):**
| Condition | Δ |
|---|---|
| velocity ≥ +0.20                                            | −4 to −6 (rising SI = yellow flag) |
| velocity ≤ −0.30 AND days_to_cover ≥ 3 AND strategy=breakout | +4 to +6 (squeeze fuel) |
| velocity ≤ −0.30 (other strategies)                          | +2 to +4 |
| otherwise / missing                                          | 0 (neutral)  |

**Wiring:** Applied in `autotrader-scan` AFTER `evaluateSignal` returns (not inside the engine, to keep the backtest deterministic). `sig.conviction` is bumped by the delta; persisted to `live_signals.si_velocity` and `signal_outcomes.si_velocity` for closed-loop calibration.

**Cron schedule:** Added to `supabase/config.toml`; pg_cron job posts `x-cron-secret` header. Heartbeat goes to `cron_heartbeat(job_name='refresh-short-interest')`.
