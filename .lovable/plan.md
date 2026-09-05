# What's in the uploaded archive, and what to do with it

The zip is a snapshot of this same app taken on 2–3 September, with one new layer bolted on: a self-contained "quant" framework (about 750 lines of new logic plus tests, one new backend function, and three new database tables). Everything else in it is older than what is live here.

So it splits cleanly into two piles: a genuinely useful new layer worth adopting, and a set of older files that would undo recent work if copied in.

## Do not copy these back (they are regressions)

The archive predates the last two rounds of work. Copying it wholesale would:

- Undo the payment-webhook safety work — duplicate-payment protection and the customer-ownership check are simply absent in the archive's version.
- Undo the backtest exit fix — in the archive the Max Stop / Take Profit controls *replace* the adaptive volatility exits; the current code correctly uses them as ceilings and reports how often they bind.
- Delete the new shared function-protection module and its test.
- Revert the lint clean-up, the test setup, and the bundle-splitting config.
- Resurrect an unused portfolio-backtest simulator that was deliberately deleted.

Net: nothing gets copied file-by-file. Only the new quant layer is brought over, adapted to the current code.

## What is worth taking (in order of value)

**1. Decision ledger + counterfactual outcomes (highest value).**
Three new tables: experiment runs, a decision log (every candidate, allowed or blocked, with score, expected edge, proposed vs approved size, block reasons, and data provenance), and counterfactual outcomes per horizon. Today rejections are logged, but approvals aren't logged with their reasoning, and nothing ties a decision to the model version and data snapshot that produced it. This gives a permanent, queryable record of *why* each trade happened, and what would have happened otherwise.

**2. A single risk kernel with named block reasons.**
One function that takes a candidate, current portfolio state, and limits, and returns allow/deny with an explicit reason list (gross, net, single-name, sector, portfolio risk, daily loss, stale data, participation, negative edge, liquidity, uncertainty, shorts). The current autotrader has all of these checks, but scattered across a 4,300-line file. Consolidating behind one kernel makes the gate stack testable and makes "why did nothing trade today" answerable from data.

**3. Point-in-time data discipline.**
Every feature carries provenance with an "available at" timestamp, and a validator rejects any signal that used a feature not yet published at decision time. This is the single most common source of backtests that look better than live.

**4. Walk-forward splitter with purge and embargo.**
Correctly removes training rows whose outcome window overlaps validation, and embargoes rows right after the test window. Current nightly training uses simple recency windows, which leak.

**5. Probability-to-capital layer.**
Empirical-Bayes shrinkage (small samples pulled to base rate), asymmetric payoff economics net of costs, and a risk-budget allocator that never funds a negative expected edge. This overlaps with existing per-user shrinkage and slippage code, so it gets merged rather than duplicated.

**6. Research primitives (opt-in, lower priority).**
Rebound-aware momentum (contracts exposure when the market is stressed and the stock is far off its high), an uncertainty-adjusted score (penalties for model disagreement, stale data, illiquidity, high volatility), and a softmax allocator to split capital across the Anchor / Core / Sprint sleeves based on recent risk-adjusted performance with an exploration floor so a sleeve is never permanently abandoned.

**7. The archive's shadow adapter is not worth keeping as written.** It fabricates expected win/loss numbers from the confidence score and hard-codes limits on the client. Real economics must come from the backend.

## Proposed rollout

**Phase 1 — Ledger and contracts (shadow only, no behaviour change).**
Add the three tables with grants and strict access (service-role writes only), plus the contracts, risk kernel, and gateway modules. Wire the live autotrader to log every candidate decision — including the ones it approves — through the ledger. The existing gate stack still decides; the kernel runs alongside and records agreement or disagreement.

**Phase 2 — Kernel becomes authoritative.**
After a period of shadow agreement, the autotrader's scattered exposure checks are replaced by a single kernel call. Any divergence found in Phase 1 gets reconciled first. Block reasons become the source for the "no trades today" explanation on the log page.

**Phase 3 — Point-in-time enforcement and honest training.**
Attach provenance to the feature snapshots already being written, enforce availability at decision time, and switch nightly training to purged/embargoed walk-forward folds. Expect measured accuracy to drop here — that drop is the leak being removed, not a regression.

**Phase 4 — Research layers, opt-in and measured.**
Add rebound-aware exposure scaling, the uncertainty-adjusted score, and sleeve-level capital allocation behind flags, each validated against the ledger's counterfactuals before being switched on.

## Technical notes

- New shared modules: `quant-contracts.ts`, `risk-kernel.ts`, `quant-decision-gateway.ts`, `quant-core.ts`, `walk-forward.ts`, `innovation-layers.ts`, all pure and Deno-testable, plus the archive's test files.
- Deduplication required: `shrinkProbability` overlaps `user-models.shrink`; cost handling overlaps `slippage-model`; risk-budget logic overlaps `portfolio-cvar` and `adaptive-context`. One implementation each, per the existing single-source-of-truth rule.
- The `quant-decision` edge function is added to the auth registry as a user/cron endpoint rather than keeping its bespoke inline auth, and its CORS uses the shared allowlist.
- Migration adapted: keep RLS enabled with no client policies, but state grants explicitly for `service_role` per project convention.
- The backend is currently paused, so migrations and function deploys land when it resumes; the pure modules and their tests can ship immediately.
