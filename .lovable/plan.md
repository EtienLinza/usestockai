## What actually happened on BEAM

From `autotrade_log` + `virtual_positions`:

- Entry 2026-07-08 @ **$36.89**, 75 sh, conviction 72, `trend` strategy / `momentum` profile
- **entry_atr = $2.595 → ATR% = 7.03%** of price (extremely high for a `momentum` bucket)
- `hard_stop_price = $33.18` → **10.07% risk** (≈1.43×ATR, clamped by structural swing/EMA anchor from a much wider 3.0×ATR = 21%)
- Peak only $37.50 (+1.65%) → trailing stop never left the hard stop
- 2026-07-10 exit @ **$33.00** — price gapped *through* $33.18 → realized **-10.54% / -$291.75**

Three gaps in the current logic allowed this:

1. **No ATR%-of-price ceiling at entry.** A 7% ATR name entered the `momentum` bucket where `hardStopATRMult = 3.0`. Sizing was risk-parity-capped in dollars, but the *stop distance* was allowed to be huge in percent.
2. **No absolute cap on stop-distance-as-% of price.** `stopDist = min(atr*mult, structural)` — but both can be 8–15% on high-vol names. When price gaps through, the realized loss ≈ stopDist + slippage.
3. **No overnight-gap protection for high-ATR longs that haven't proven themselves.** BEAM held overnight with unrealized ≈ 0, then gapped. Nothing in the pipeline trims or tightens for that state.

Portfolio-heat cap (6% NAV) and risk-parity sizing did their jobs (only $291 of a $2,767 position) — but the *entry itself* shouldn't have been sized full given the volatility profile.

## Fix — three layered guards in `supabase/functions/autotrader-scan/index.ts`

All changes are inside the entry pipeline / exit pipeline of the autotrader; no schema, no UI.

### 1. ATR% entry ceiling (profile-scoped)

Before computing shares, reject entries where `atrPct` exceeds a profile ceiling:

```text
momentum : atrPct ≤ 5.0%    (BEAM at 7.03% → REJECT)
trend    : atrPct ≤ 6.0%
value    : atrPct ≤ 4.0%
volatile : atrPct ≤ 9.0%
index    : atrPct ≤ 3.0%
```

Override: allow entry if `conviction ≥ 85` **and** `atrPct ≤ ceiling × 1.4` (rare high-conviction volatile setups still pass, with reduced sizing from guard #2).

Logged as `BLOCKED` with reason `ATR% X.X% exceeds <profile> ceiling Y.Y%`.

### 2. Absolute hard-stop distance cap (profile-scoped)

After the existing structural/ATR stop calc, clamp:

```text
maxStopPct = { momentum: 0.06, trend: 0.07, value: 0.05, volatile: 0.10, index: 0.04 }
stopDist   = min(stopDist, currentPrice * maxStopPct)
```

Then require `stopDist ≥ 0.6 × ATR` (existing `minDist` stays as lower bound). If the ceiling forces `stopDist < minDist`, reject the entry (`Stop-cap collision: ATR too wide for profile`). This is the direct BEAM prevention — its 10.07% stop would have been capped to 6% (or the entry rejected as stop-cap collision).

Because risk-parity sizing divides by `stopDist`, a tighter cap automatically shrinks shares — worst-case gap loss stays bounded.

### 3. Overnight-gap trim for un-proven high-ATR longs

New exit rule evaluated in `processUser` before the existing T1 hard-stop check, only during the last ~15 min of RTH:

```text
IF position.entry_atr / entry_price > 0.05
AND bars_held ≥ 1                            (has held ≥ one session already)
AND peak_price / entry_price < 1 + 0.5*R_pct (never reached +0.5R)
AND unrealized_pnl_pct ≥ -0.01               (not already in trouble)
THEN partial-exit 33% of remaining shares, reason "Overnight-gap trim: high-ATR sliver, unproven"
```

Uses the existing partial-exit plumbing (same code path as R1/R2 rungs) so accounting, logs, and cooldowns stay consistent.

## Verification

- `bunx tsgo --noEmit` after edits
- Manual dry-run: simulate the BEAM setup (`atrPct = 0.0703`, profile=momentum) and confirm guard #1 rejects it; simulate a `volatile` profile with same numbers and confirm guard #2 caps stopDist to 10%
- Query `autotrade_log` after next scan window: expect zero `Hard stop hit` exits > 7% for `momentum`/`trend`

## Not doing (out of scope)

- No biotech/sector-specific catalyst filter (would need a sector-classification table); the ATR%-ceiling captures most of that risk indirectly
- No changes to `signal-engine-v2.ts` PROFILE_PARAMS constants — the caps are enforced at the autotrader entry layer so backtest/scan math stays untouched
- No UI changes
