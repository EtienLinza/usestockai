---
name: Pre-market scan
description: Cron-driven pre-open scan that gap-gates and tags signals as 'premarket'
type: feature
---

## Trigger
Two pg_cron jobs (`premarket-scan-edt` 13:45 UTC, `premarket-scan-est` 12:45 UTC, Mon–Fri) hit `scan-orchestrator` with `{"mode":"premarket"}`. Cron secret is read from `vault.decrypted_secrets`. Orchestrator gates internally on ET wall-clock (08:30–09:25) + NYSE holiday calendar so only one of the two fires per day.

## Logic
- `scan-worker` fetches Yahoo extended-hours quote (`fetchPremarketQuote`) for survivors and computes the overnight gap.
- Same-direction gap >4% → skip (extended). Opposite-direction gap >1% → skip (thesis broken). Same-direction gap ≥1.5% → +3 conviction.
- Signals persist with `live_signals.source = 'premarket'`. `clear-signals` preserves premarket rows ≤6h old so the staleness sweep doesn't wipe them before the open.
- `expires_at` for premarket rows = today's session close (vs 24h for live).
