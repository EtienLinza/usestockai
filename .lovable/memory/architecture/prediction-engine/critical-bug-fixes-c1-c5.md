---
name: Algorithm Critical Bug Fixes (C-1…C-5)
description: Five critical correctness bugs fixed in the autotrader algorithm — discovery cache, cooldown persistence, dynamic NAV sizing, macro filter NaN guard, and multi-batch SPY context.
type: feature
---

The autotrader scan pipeline had five silent correctness bugs found in the deep audit. All five are now fixed.

**C-1 — Discovery cache**: `scan_universe_log` now stores `all_tickers` (jsonb). `scan-orchestrator` reuses the most-recent universe row when within `DISCOVERY_TTL_MS` instead of always re-fetching GitHub + 12 Yahoo screener endpoints.

**C-2 — Persisted cooldown**: New table `signal_cooldown` (ticker PK + cooldown_bars_remaining + last_decision). `signal-engine-v2.ts` exposes `primeTrackerCacheFromDB()` and `persistTrackerCacheToDB()`. All three scan callers (autotrader-scan, scan-worker, market-scanner) prime at start and persist at end so `cooldownBarsRemaining` survives edge-function cold starts.

**C-3 — Dynamic NAV sizing**: `runEntryDecision` in autotrader-scan now takes an optional `currentNav` parameter and uses it in `targetDollars = navForSizing * cappedFrac`. `processUser` queries cumulative realized PnL from all closed positions and computes `currentNav = max(starting_nav * 0.1, starting_nav + cumulativeRealizedPnl + unrealizedToday)`. Falls back to `starting_nav` if missing.

**C-4 — Macro filter NaN guard**: `macroPermitsEntry()` no longer uses `safeGet(sma, spyPrice)` as the fallback (which silently made `spyPrice < s50` false). Now does an explicit `Number.isFinite` check on the SMAs and logs a warning when the macro filter is bypassed due to insufficient data.

**C-5 — Multi-batch SPY context**: `market-scanner` no longer truncates `spyContext.spyClose` to the last 30 bars when forwarding to the next batch. The full ~252-bar series (<3 KB payload) is passed through so `macroPermitsEntry`'s 200-bar requirement is met in every batch.

**Migration**: `signal_cooldown` table is RLS-protected (read-only to authenticated users; writes via service role only). `scan_universe_log.all_tickers` jsonb column added.
