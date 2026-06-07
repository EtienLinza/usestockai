---
name: EPS Revision Overlay
description: EPS estimate revision momentum used as supporting conviction factor (-8…+8 delta); nightly Finnhub refresh, neutral-on-miss
type: feature
---

EPS estimate-revision momentum is layered into conviction as a **supporting fundamental factor**, parallel to the Danelfin AI Score overlay. It never blocks a signal and never acts as a gate.

**Source:** Finnhub `/stock/earnings` endpoint via `_shared/eps-revisions.ts` (`getEpsRevision`, `loadEpsRevisions`, `upsertEpsRevisions`, `isEpsRevisionsConfigured`). Uses the existing `FINNHUB_API_KEY` secret.

**Methodology (free-tier safe):**
- Pull last 4 quarterly EPS estimates per ticker.
- Compute revision score = `clamp(((current − one-quarter-back) / |one-quarter-back|) * 50, -10, +10)`, rounded to 1 decimal.
- Stored in `public.eps_revisions(ticker, as_of, current_estimate, estimate_30d_ago, estimate_90d_ago, revision_score)`. Public read RLS, server-only writes.

**Refresh:** `refresh-eps-revisions` edge function, cron `refresh-eps-revisions-nightly` at 02:45 UTC weekdays. Throttled ~1 req/sec, hard cap 300 tickers, exits after 5 consecutive failures. Universe = `scan_universe_log.sample_tickers` ∪ `watchlist` ∪ open `virtual_positions`. Writes `cron_heartbeat` with `ok`/`degraded`/`empty`/`skipped`.

**Factor formula** (in `_shared/signal-engine-v2.ts` `evaluateSignal`, applied **after** Danelfin delta, only when `sig.confidence > 0`):
- Long:  `delta = round(revisionScore * 0.8)` → range −8 … +8
- Short: `delta = -round(revisionScore * 0.8)`
- Missing/null/NaN/crypto → `0` (neutral, never blocks).

Delta is applied to `sig.confidence` (clamped 0..100) and mirrored into `sig.consensusScore` so the downstream threshold re-check still gates correctly. Engine returns `epsRevisionDelta` and `epsRevisionScore` so callers can persist them.

**Persistence:** `signal_outcomes.contributing_rules.eps_revision` = delta, `.eps_revision_score` = raw score. Read by `calibrate-weights` to measure incremental edge. Engine reasoning string appends ` | epsΔ=±N` when non-zero.

**Scanner wiring:**
- `scan-orchestrator` calls `loadEpsRevisions(survivors)` once per run and forwards `epsRevisionScores` to every `scan-worker`.
- `market-scanner` (legacy path) pre-loads once per batch and passes through.
- `autotrader-scan` pre-loads once per scan and threads through `runEntryDecision` → `evaluateSignal`.

**Backtest:** free tier has no historical estimates, so backtest currently runs with delta=0 (no-op). Going forward the nightly cron accumulates history.

**Hard rule:** EPS revision overlay must remain a supporting factor. Do NOT introduce a hard gate, minimum-score floor, or veto based on it. The adaptive weighting loop is the only mechanism that should change its effective influence.
