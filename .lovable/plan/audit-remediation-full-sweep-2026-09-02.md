# Audit Remediation — Full Sweep

Verified against the codebase before planning: the short-stop bug and forced-close bug are real but live in an orphaned file; the stop/take-profit sliders are genuinely dead controls; ESLint reports 217 problems (201 errors); every edge function has `verify_jwt = false`.

## Phase 1 — Release blockers

**Delete the dead simulator.** `supabase/functions/_shared/backtest-sim.ts` is imported by nothing (leftover from the removed portfolio backtest). It carries BT-001 (short positions stop at price 0 because `trail` initialises to 0) and BT-003 (forced close uses each ticker's last bar). Deleting removes both bugs and ~700 lines of dead code. The stale reference in `adaptive-context.ts`'s header comment gets cleaned up too.

**Fix the Max Stop / Take Profit sliders.** Decision: make them real overrides rather than deleting them — users expect risk controls, and clamping is a small, safe change. The engine keeps its adaptive ATR exits but clamps them: stop distance never exceeds the chosen Max Stop %, and the profit ladder's final target caps at the chosen Take Profit %. The results panel states which exit model ran and whether a clamp bound the trade.

**Lock down model-internals tables.** Decision: full lockdown with a narrow public surface. `strategy_weights`, `shadow_predictions`, `model_versions`, `model_health_reports`, `market_memory`, `drift_detections`, `adaptive_signal_params`, `adaptive_exit_params`, `rejection_accuracy`, `gate_adjustments` lose their `USING (true)` read policies. Any page that currently reads them (System Health, Performance) moves to sanitised read-only views exposing only aggregate health — no coefficients, thresholds, or champion/challenger state.

**Dependencies.** Run the dependency scanner, regenerate a single canonical lockfile, remove the stray lockfiles so a clean install is reproducible, and upgrade the flagged packages (React Router, PostCSS, Vite, supabase-js) in one pass with a build + preview regression check.

## Phase 2 — Hardening

- **Billing idempotency**: a `stripe_events` table keyed on event id with a unique constraint; the webhook records the event first and returns 200 on replays. Before mutating entitlement it verifies the `userId` in metadata maps to a real profile, the Stripe customer matches the stored one, and the price is in the allowed catalog. Rejections are logged without payload contents.
- **Edge-function auth registry**: one shared wrapper declaring each function's mode (public / user / cron-admin) and applying the matching gate, plus a contract test that calls every function unauthenticated and asserts the expected status. CORS moves from `*` to an origin allowlist for user-authenticated endpoints.
- **Elite backtest guardrails**: unlimited quota stays, but per-user concurrency of 1, a global concurrent cap, an absolute date-span limit, and cost/duration logging per user get added.
- **Training-job pagination**: keyset pagination and checkpoints in `train-user-models`, `train-meta-labeler`, `train-exit-meta`; each run records sample window, row count, and truncation status so a fit on incomplete data is visible instead of silent.

## Phase 3 — Quality, tests, performance

- **Tests**: Vitest for frontend, Deno tests for edge shared modules. Golden fixtures for indicators, long/short accounting, cost model, metrics, and quota RPC behaviour; property tests (flat series can't be profitable after costs; long and short of the same move are opposite; wider stops can't trigger earlier).
- **Lint to zero**: typed parsers (Zod) at network/database/Stripe boundaries instead of `any`, structured logging in place of empty catches, deliberate hook-dependency fixes in `Watchlist.tsx`, `AddToWatchlistButton.tsx`, `WatchlistSuggestions.tsx`, and shared constants split out of component files.
- **Bundle**: route-level dynamic imports plus manual chunks for charting and export, targeting the 676 kB main and 384 kB chart chunks. No raising of the warning limit.

## Notes

- The backend is currently paused; database migrations and edge-function work in Phases 1–2 apply once it is running. Frontend, deletion, lint, tests, and bundle work proceed regardless.
- Phase 3 is large; it will be delivered in batches rather than one pass.
