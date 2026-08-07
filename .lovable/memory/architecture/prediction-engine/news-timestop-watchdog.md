---
name: News Sentiment, Stale Time-Stop & Outcome Watchdog
description: WS4 headline sentiment as a ±5 conviction delta, 1.5x stale time-stop for red positions, and a leak detector comparing closed positions to signal_outcomes rows
type: feature
---

Three closing items of the Self-Improving Engine v2 roadmap.

**WS4 — News sentiment (supporting factor only)**
`_shared/news-sentiment-loader.ts` reads `news_sentiment_cache` (rows ≤12h old) for the whole entry watchlist in one batched query — no API spend during a scan. `newsConvictionDelta(news, side)` returns `(score/100) × confidence × 5`, clamped ±5, sign-flipped for shorts, and **0** when the row is missing, stale, or confidence < 0.25. Applied in `runEntryDecision` after the meta/reversal deltas. It can never block an entry. `news_sentiment_score` and `news_confidence` land in `buildEntryFeatureSnapshot`, so the nightly ensemble trainer decides whether the factor actually pays; if not, it down-weights itself.

Deliberately **not** mirrored into `scan-worker` — the autotrader re-evaluates every candidate at entry, so applying the delta in both places would double-count it.

**Gap 1 — Stale time-stop**
`STALE_HOLD_MULT = 1.5` in `autotrader-scan`. At `barsHeld >= maxHold`: green → take the profit (unchanged); red → hold through a grace window, then force-close at `ceil(maxHold × 1.5)` regardless of P&L ("freeing the slot"). This reverses the old "never sell red on time" rule that let 16 dead positions clog the book for weeks, but fires late enough that it can't pre-empt normal mean reversion.

**Gap 2 — Outcome-write leak detector**
The `learning-loop` watchdog in `calibrate-weights` now compares closed `virtual_positions` (7d) against closed `signal_outcomes` (7d). Leak = `positions ≥ 5 && missing > max(2, 20% of positions)` — tolerant of manual closes and partial exits. A leak writes a `critical` row to `drift_detections` (`drift_kind='pipeline'`, `metric='outcome_write_gap'`) and flips the heartbeat to `degraded` so SystemHealth shows red. The original "0 outcomes while autotraders enabled" starvation check remains.
