# Three-Sleeve Trading Suite

One account, one NAV, one risk budget — three engines that run independently and are allocated capital based on how well each is actually performing.

| Sleeve | Horizon | Job | Turnover |
|---|---|---|---|
| **Anchor** | Months | Compound quality, cushion the drawdowns of the other two | Very low |
| **Core** | 1-8 weeks | Today's engine, unchanged behaviour | Medium |
| **Sprint** | 1-5 days | Fast, tight-stop momentum bursts | High |

Each sleeve gets its own entry rules, exit geometry, learning loop and performance record. They share the portfolio safety rails so they can never collectively over-risk the account.

## Decisions I made on the open questions

**Conflicts — one direction per ticker, across the whole suite.** If any sleeve is long NVDA, no other sleeve may short it; the opposing entry is rejected and logged. Same-direction stacking is allowed, but the combined position across sleeves is checked against the single-name cap, so two sleeves piling into one name can't quietly build an oversized bet. Independent opposing books were rejected: they double-consume sector, heat and CVaR budget, make P&L unreadable, and pay two spreads to hold roughly nothing.

**Sprint stays on daily bars.** True intraday needs minute data and a scan every few minutes — a different data feed and several times the compute cost, which you asked to avoid. Sprint instead uses the existing daily-bar pipeline with its own aggressive parameter set: tighter entry triggers, ~1.2x ATR stops, quick profit targets, and a hard 5-day time stop. Same cost, same cadence, genuinely different behaviour. If Sprint proves out on the numbers later, intraday exit monitoring is an easy add-on.

**Anchor maximises return per unit of risk, not raw return.** It buys strong-fundamental names in confirmed uptrends: positive EPS revisions and a high Danelfin score, price above the 200-day average, ranked by a risk-adjusted score (trailing return / volatility). It sizes by inverse volatility so a quiet compounder gets more capital than a wild one, holds through normal noise with wide stops, and reviews weekly rather than every scan. Its role is ballast, so it is deliberately hard to shake out.

## Adaptive capital allocation

Each sleeve has a target NAV share that breathes with its own trailing 90-day risk-adjusted expectancy — the same mechanism the position cap already uses.

- Starting split: Anchor 45%, Core 35%, Sprint 20%
- Each sleeve's share is scaled by its performance relative to the suite average, then renormalised to 100%
- Hard floors and ceilings so no sleeve can be starved or run away: Anchor 30-60%, Core 20-50%, Sprint 5-30%
- A sleeve with negative expectancy over 90 days is benched to its floor until it recovers
- Shares move gradually (max a few points per night) so allocation never whipsaws
- Sizing inside a sleeve is unchanged — it just works against its own slice of NAV instead of the whole account

## Safety rails stay account-wide

Heat cap, portfolio CVaR, sector caps and the correlation gate are evaluated across the union of all three sleeves. Anchor also gets a reserved floor of its allocation that Sprint cannot consume, so a hot fast tape can't crowd out the safety net.

## Learning stays separate

Every outcome row is tagged with its sleeve. Calibration curves, adaptive thresholds, adaptive exits and the ensemble models all train per sleeve. A three-day scalp and a nine-month hold never end up in the same statistical bucket.

## What you'll see in the app

- Settings: master toggle plus a per-sleeve enable, current adaptive allocation with the reason for each shift, and floor/ceiling overrides
- Dashboard: per-sleeve NAV, open positions, P&L and win rate, alongside the combined account view
- Trade log: filterable by sleeve, with sleeve shown on every entry and exit

## Rollout

**Phase 1 — Plumbing.** Add sleeve tagging to positions, outcomes and logs. Everything existing becomes Core. Add the allocator with a fixed split. No behaviour change; verifies the accounting is sound.

**Phase 2 — Anchor.** Weekly screen and rebalance, wide-stop exits, its own learning loop. Enabled off a small slice first.

**Phase 3 — Sprint.** Aggressive parameter set on the existing pipeline, hard 5-day time stop, own learning loop.

**Phase 4 — Adaptive allocation.** Turn on the nightly performance-driven reallocation once each sleeve has enough closed trades to be judged fairly (roughly 30 per sleeve).

## Technical notes

- **Schema:** `sleeve` enum (`anchor` | `core` | `sprint`) added to `virtual_positions`, `signal_outcomes`, `autotrade_log`, `live_signals`, `rejected_signals`, and the adaptive parameter tables. New `sleeve_allocations` table holding each user's current share, floor, ceiling, trailing expectancy and the reason for the last shift. New `sleeve_settings` for per-sleeve enable and overrides.
- **Signal engine:** add a sleeve parameter set alongside the existing `PROFILE_PARAMS` in `_shared/signal-engine-v2.ts` — Sprint and Anchor become parameter overlays on the same evaluation path, not forked engines, so backtest and live parity is preserved.
- **Allocator:** new `_shared/sleeve-allocator.ts` computing per-sleeve shares from trailing closed trades; called by `autotrader-scan` to derive each sleeve's effective NAV before `computeEffectiveSettings` runs.
- **Anchor screen:** new nightly `anchor-screen` function using the existing `eps_revisions` and `danelfin_scores` tables plus 200-SMA trend confirmation; writes candidates as `live_signals` rows tagged `anchor`.
- **Scan pass:** `autotrader-scan` iterates sleeves in order Anchor → Core → Sprint, each against its own NAV slice, with the direction-conflict check and account-wide rails applied across the union.
- **Learning jobs:** `calibrate-weights`, `tune-signal-thresholds`, `tune-exit-params`, `train-user-models` and `train-exit-meta` all gain a sleeve dimension; existing rows backfill as `core`.
