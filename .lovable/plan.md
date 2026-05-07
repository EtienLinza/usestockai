## Goal

Let big winners run. Today the autotrader force-exits at the hard take-profit ceiling (`takeProfitPct × 1.5`) and on 3-of-5 peak signals — even when the trend is still strongly intact. Add a **"runner mode"** that overrides those exits when a position is clearly still in a healthy uptrend, and only releases when the move actually breaks down.

## Where this lives

`supabase/functions/autotrader-scan/index.ts` → `runWinExit()`. No DB changes, no UI changes, no new positions table fields.

## What "running it dry" means (objective gates)

Runner mode activates **only** when the position is meaningfully profitable AND momentum is still alive. We require **all** of:

1. **Profitable enough to be a real winner** — `pnlPct >= max(profile.takeProfitPct × 1.5, 12%)`. (Below the existing ceiling we don't even consider it; we already have peak detection.)
2. **Trend intact** — close > 20-EMA > 50-SMA (long) / inverse for short. Confirms the structure that made it a winner is still standing.
3. **Higher highs holding** — current price is within 1.5 × ATR of the all-time `peak_price`. We're not in a deep pullback.
4. **No exhaustion** — RSI is **not** > 80 with bearish RSI divergence (long), and the volume-climax + MACD-rollover signals are **not both** firing.
5. **Thesis still alive** — for `trend` strategy, `liveWeeklyAlloc` direction still matches entry; for `breakout`, price still > breakout level (entry × 1.02 long); for `mean_reversion`, runner mode does **not** apply (MR thesis is mean-revert, not "ride a trend").

If all 5 hold → **runner mode active**. The hard ceiling and the 3-of-5 peak rule are both **suppressed**. Trailing stop continues to ratchet (tightened — see below) and is the **only** exit path while runner mode is on.

## Tighter trail while running

Once runner mode kicks in, replace `profile.trailingStopATRMult` with a tighter Chandelier-style trail: `peak − 2.5 × ATR` (or `profile.trailingStopATRMult`, whichever is tighter). This locks in gains as the move extends and is the "ran it dry" exit — when the trend finally breaks, the trail catches it.

## Exit conditions while in runner mode

Runner mode releases (i.e., normal exit logic resumes for that scan) the moment **any** of:
- Trailing-stop hit → `FULL_EXIT` with reason "Runner trailing-stop hit (+X%)"
- Trend structure breaks (close < 50-SMA on long) → `FULL_EXIT` with reason "Runner trend break (close lost 50-SMA)"
- 4-of-5 peak signals fire (stricter than the normal 3-of-5) → `FULL_EXIT` with reason "Runner exhaustion (4/5 peak signals)"

Loss-exit logic (`runLossExit`) still runs first and is unaffected — hard stop and thesis invalidation always win.

## Code shape

Inside `runWinExit`, after the trailing/peak update and **before** the hard-ceiling check at line 334, compute `runnerActive` from the 5 gates above. If `runnerActive`:

- Tighten `trailing` to `max(trailing, newPeak − 2.5 × ATR)` (long) / inverse for short.
- If `trailingHit` (using the tightened trail) → `FULL_EXIT`.
- If trend-break or 4-of-5 peak signals → `FULL_EXIT`.
- Otherwise → `HOLD` with reason `runner-mode (+X%, peak Y)`, persisting `trailing` and `newPeak`.
- **Skip** the existing hard-ceiling and 3-of-5 blocks for this position this scan.

If `!runnerActive` → existing logic runs unchanged.

## What does NOT change

- `runLossExit` — untouched.
- Hard stop, ATR stop, time stop — untouched.
- Peak/trailing ratchet math — same formulas, just applied with a tighter mult while runner is active.
- Manual-position handling — runner mode applies to every position the autotrader manages (which now includes manual buys, per the previous change).
- DB schema — no new columns. `peak_price` and `trailing_stop_price` already exist and are sufficient.

## Verification

1. Pick an open position with > 15% profit and clean uptrend (close > 20-EMA > 50-SMA, near peak). Run autotrader-scan → expect `HOLD` with `reason` containing "runner-mode" instead of `FULL_EXIT` at the ceiling.
2. Simulate a trend break (or wait for one) → expect `FULL_EXIT` with reason "Runner trend break" or "Runner trailing-stop hit".
3. Position with > 15% profit but RSI > 80 + bearish divergence → runner mode does NOT activate, normal peak detection fires.
4. Mean-reversion winner at +20% → runner mode does NOT apply, normal ceiling fires.