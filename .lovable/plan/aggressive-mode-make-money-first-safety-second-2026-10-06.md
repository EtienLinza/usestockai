# Aggressive Mode: make money first, safety second

Goal: get the paper account invested most of the time (target 70–95%) with real position sizes, and let winners run, while keeping a few true disaster guards.

## What changes for you

1. **Bigger trades.** Every buy that passes starts at 8% of the account (up from 4%), and the best-scoring ones (85+) go up to 12%. No more 1-share trades.
2. **More trades.** The minimum score to buy drops from 70 to 62. The "skip near earnings" window shrinks from 3 days to 1 day. The "only the top slice of today's picks" filter keeps twice as many names.
3. **Fresh ideas all day.** The market-wide scan runs more often during market hours, and new picks stay valid until the end of the next trading day instead of expiring too early to be used.
4. **Let winners run.** The profit-taking ceiling rises toward +25% for strong trends; the trailing stop only kicks in once a trade is clearly up.
5. **Fewer soft blocks.** Several "maybe risky" checks (volatility ceiling, reversal pre-check, correlation, extra conviction penalties) stop blocking trades outright and instead just nudge the size down a little.
6. **One switch.** A new "Aggressive" risk setting in Settings, turned on for your account. You can switch back to the current careful behavior at any time.

## Safety guards that stay

- Hard stop on every trade (capped so a single trade can't lose more than ~8%).
- Kill switch, daily loss limit, market-hours-only entries, bad-quote rejection.
- Max 15% of the account in one stock, max ~100% total invested (no borrowing).
- Drawdown brake: if the account falls 12% from its peak, sizes halve until it recovers.

## Order of work

1. Add the Aggressive setting and its numbers in one place.
2. Sizing: new floor, conviction-based top-up, remove stacked shrink factors in Aggressive mode.
3. Entry gates: lower score floor, 1-day earnings window, wider rank cut, soft-score conversions.
4. Exits: wider profit ceiling, later trailing stop.
5. Scanner cadence and signal lifetime.
6. Settings toggle, then run a live scan and confirm entries and sizes in the trade log.

## Technical details

- New `risk_profile = 'aggressive'` value on `autotrade_settings` (additive migration, default unchanged); baseline added to `RISK_PROFILE_BASELINES` in `_shared/adaptive-context.ts`.
- `autotrader-scan/index.ts`: `MIN_ENTRY_FRAC` becomes profile-driven (0.08; 0.12 for conviction ≥85); in aggressive mode skip `edgeMult`, `convEdgeMult`, `riskBudgetMult`, slippage shrink; keep gap cap only as a 15% single-name ceiling. ATR ceiling, reversal envelope, correlation gate and meta-labeler become multiplicative size haircuts (floor 0.6x) instead of hard blocks. Heat cap raised 6% → 10% NAV; CVaR cap 2% → 4%; CDaR hard block replaced by 12% drawdown half-size brake.
- Earnings blackout 72h → 24h; `applyCrossSectionalGate` keep fraction doubled; `min_conviction` floor clamp lowered to 60.
- `_shared/adaptive-exits.ts`: TP ceiling clamp up to 25% for momentum profile; trailing arm at +1R instead of +0.5R.
- `scan-orchestrator`: live signal `expires_at` = next session close; cron cadence increased during market hours (frequency and cost confirmed before scheduling).
- Settings page: add Aggressive option to the risk profile selector.
- Requires backend running to deploy functions and apply the migration.
