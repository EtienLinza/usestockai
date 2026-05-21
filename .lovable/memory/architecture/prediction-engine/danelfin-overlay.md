---
name: Danelfin AI Score Overlay
description: Danelfin AI Score used as supporting conviction factor, never a hard gate; nightly refresh, neutral-on-miss
type: feature
---

Danelfin AI Score (1–10) is layered into the conviction calculation as a **supporting factor**. It never blocks a signal and never acts as a gate.

**Source**: `apirest.danelfin.com/ranking?ticker=...` via `supabase/functions/_shared/danelfin.ts` (`getAiScore`, `loadDanelfinScores`, `upsertDanelfinScores`, `isDanelfinConfigured`). Secret: `DANELFIN_API_KEY`.

**Storage**: `public.danelfin_scores` (PK `ticker, as_of`). Public read RLS. Server-only writes via `refresh-danelfin-scores`.

**Refresh**: `refresh-danelfin-scores` edge function, cron `refresh-danelfin-scores-nightly` at 02:30 UTC weekdays. Free-tier safe: throttled ~1 req/sec, hard cap 300 tickers, exits early after 3 consecutive 401/402/429. Universe = `scan_universe_log.sample_tickers` ∪ `watchlist` ∪ open `virtual_positions`. Writes `cron_heartbeat` with `ok` / `degraded` / `empty` / `skipped`.

**Factor formula** (in `_shared/signal-engine-v2.ts` `evaluateSignal`, only when `sig.confidence > 0`):
- Long:  `delta = round((aiScore - 5) * 1.5)`  → range -6 … +8
- Short: `delta = -round((aiScore - 5) * 1.5)`
- Missing / null / NaN → `0` (neutral, never blocks).

Delta is applied to `sig.confidence` (clamped 0..100) and mirrored into `sig.consensusScore` so the threshold re-check downstream still gates correctly. Engine returns `danelfinDelta` and `danelfinScore` so callers can persist them.

**Persistence**:
- `signal_outcomes.contributing_rules.danelfin` = delta, `.danelfin_score` = raw score. Read by `calibrate-weights` to measure incremental edge.
- `autotrade_log.reason` inherits engine's reasoning string which appends ` | danelfinΔ=±N` when non-zero.

**Scanner wiring**: `scan-orchestrator` calls `loadDanelfinScores(survivors)` once per run and forwards the map to every `scan-worker` invocation under `body.danelfinScores`. Workers and `market-scanner` (legacy path) both pass `danelfin` into `evaluateSignal`. Autotrader pre-loads once per scan and passes through `runEntryDecision` → `evaluateSignal`.

**UI**: `TradingTab` shows an `AI {n}` badge with a `HoverCard` displaying technical / fundamental / sentiment / low-risk sub-scores and the `as_of` date. Hidden when score is missing.

**Backtest**: free-tier has no historical scores, so backtest currently runs with delta=0 (no-op). Going forward the nightly cron accumulates rows and the engine can read them per `as_of` once history exists.

**Constraints (free tier)**:
- US stocks only (crypto / non-US passes through as missing).
- Current scores only — no historical lookups.
- Throttle to ≤1 req/sec; ≤300 tickers/night.

**Hard rule**: the Danelfin overlay must remain a supporting factor. Do NOT introduce a hard gate, minimum-score floor, or veto based on it. The adaptive weighting loop is the only mechanism that should change its effective influence.
