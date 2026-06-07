---
name: Correctness Fixes (M-2, P-2, P-8)
description: Sample-variance volatility, null-signal-id outcome dedupe, and timezone-correct autopilot scan cadence
type: feature
---

Three correctness fixes from the audit.

**M-2 — sample variance in `calculateVolatility`**: switched from population variance (÷n) to Bessel-corrected sample variance (÷n−1). At a 20-bar window the old formula underestimated vol by ~2.5% on average, which leaked through the SPY-vol scalar and systematically over-sized positions by the same factor. Applies to every caller (signal-engine, market-scanner, backtest).

**P-2 — null `signal_id` outcome dedupe**: `signal_outcomes` upserts in both `scan-orchestrator` and `market-scanner` now drop rows whose `signal_id` resolved to null before calling the upsert. The unique partial index is on `signal_id WHERE status='open'`, so rows with null IDs couldn't dedupe — retries after partial writes silently created brand-new "open" rows and corrupted the calibration win-rate.

**P-8 — `algoScanIntervalMinutes` uses real ET**: replaced `(utcHour - 4) mod 24` with `Intl.DateTimeFormat({ timeZone: "America/New_York" })` so cadence aligns with the cash session in EDT *and* EST. The old hardcode was off by an hour for ~5 months/year (Nov→Mar), bunching the "open" 5-minute cadence into 8 a.m. ET instead of 9.
