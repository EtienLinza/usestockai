# Ship the diagnosed fixes (Waves 1–4)

The code for all four waves is already written and typechecked in the project. Nothing is live because the hosted database is paused — deploys and data cleanups both need it running.

## Blocker

Backend is currently paused. Resume it from Cloud settings; everything below runs immediately after.

## What ships

### Wave 1 — Data freshness
- Deploy the rewritten `prefetch-bars` with failure-aware rotation: per-ticker failure counter, quarantine after 3 consecutive misses for 30 days, so the fetch budget lands on names that can actually succeed.
- Apply the pending migration that creates `ticker_fetch_failures` (with grants + RLS).
- Deploy `scan-orchestrator` + `bars-cache` cache-age reporting so stale bars show up in logs and heartbeats instead of silently freezing the survivor count.
- Run one manual `prefetch-bars` pass and confirm the same-day cache percentage climbs.

### Wave 2 — Learning loop
- Deploy `label-rejected-signals` with newest-first ordering so recent rejections get labeled before the ancient backlog.
- Backfill `entry_price` on rejection rows where it is recoverable; archive the permanently unlabelable `earnings_blackout` rows so they stop eating label budget.
- Verify unlabeled count starts dropping and that `calibrate-weights` sample count rises.

### Wave 3 — Feeds and dead crons
- Deploy `refresh-danelfin-scores` + `danelfin.ts` with the quota tripwire (aborts cleanly on 401/402/429 and reports status rather than silently early-exiting).
- Re-enable `check-price-alerts` (shipped user feature, dead ~4 months) and `roll-calibration`; formally remove the cron entries for `market-scanner` and `check-sell-alerts` if they are superseded.

### Wave 4 — Entry funnel
- Deploy `autotrader-scan` with BLOCKED-log hysteresis (same ticker + same reason suppressed for 6h) to stop near-miss ATR rejects spamming every scan cycle.

## Verification after deploy

- `scan-orchestrator` heartbeat shows a healthy same-day cache share and a survivor count that moves between runs.
- `prefetch-bars` heartbeat reports written > 0 and a shrinking remaining count.
- Rejection labeling backlog decreasing; drift/calibration jobs report non-zero samples.
- Autotrader log no longer repeats identical BLOCKED lines each scan.

## Technical notes

- Files already edited and awaiting deploy: `prefetch-bars/index.ts`, `scan-orchestrator/index.ts`, `_shared/bars-cache.ts`, `label-rejected-signals/index.ts`, `refresh-danelfin-scores/index.ts`, `_shared/danelfin.ts`, `autotrader-scan/index.ts`.
- Pending migration: `20260821084640_*.sql` (ticker_fetch_failures).
- No signal math, model weights, or gate thresholds change in this pass — these are data-availability and logging repairs so later tuning is done on honest data.
