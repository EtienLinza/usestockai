
# Add-On & Re-Entry Engine ("Buy More" / Double-Down)

Extend the autotrader so that, on top of the existing single-shot entry, it can:
1. **Pyramid** into an open winner when the engine re-fires a high-conviction BUY.
2. **Re-buy trimmed size** after R1/R2 partials when the setup is still valid.

Both behaviours are fully adaptive — size, trigger threshold, cooldown, and re-entry window are all derived from the same conviction / ATR / regime / heat inputs the engine already uses, so nothing is hard-coded.

---

## 1. New position state (DB)

Add columns to `virtual_positions` so the algo can reason about scale-ins:

- `add_on_count int default 0` — how many pyramids executed
- `last_add_on_at timestamptz` — for adaptive cooldown
- `original_shares numeric` — snapshot at first entry, used as the pyramid base
- `partial_trim_price numeric` — VWAP of shares removed at R1/R2 (null until trimmed)
- `partial_trim_shares numeric default 0` — how many shares are eligible to re-buy
- `reentry_deadline timestamptz` — computed at trim time from ATR/regime; null means no active re-entry window

No change to existing exit/stop logic — everything above is additive.

## 2. Signal path (autotrader-scan, entries mode)

Today `runEntryDecision` short-circuits if a position is already open. Replace that early-return with a router:

```text
if no open position     → existing entry flow
elif partial_trim_shares > 0 and now < reentry_deadline → try RE_ENTRY
else                     → try ADD_ON
```

Both paths reuse `evaluateSignal` + all current gates (meta-label, correlation, sector cap, heat cap, ADWIN, earnings blackout, market regime). Nothing bypasses safety.

### Add-on rule (pyramid)
Fires only when **all** are true:
- New signal is BUY, same direction as open position.
- `conviction ≥ dynamicAddFloor` where floor = `max(regimeFloor + 8, 78)` — meaningfully higher than the base entry floor so we only pyramid on conviction upgrades.
- Current unrealized P/L > 0 (only add to winners).
- ADX / trend still intact per the strategy that opened the trade.
- `add_on_count < maxAdds` where `maxAdds = round(conviction / 30) - 1` → conviction 60→1, 90→2, 100→2 (adaptive, no hard-coded 2).
- Adaptive cooldown elapsed: `cooldownBars = ceil(atrPct * 100)` (calmer stocks = shorter cooldown, volatile = longer).

### Re-entry rule (after R1/R2)
Fires only when:
- `partial_trim_shares > 0` and `now < reentry_deadline`.
- New BUY signal same direction, conviction ≥ regimeFloor + 3.
- Price condition (adaptive, in this preference order):
  1. `price ≤ trim_price * (1 − 0.5 * atrPct)` → preferred "buy the dip"
  2. `price ≤ trim_price * (1 + 0.25 * atrPct) AND conviction ≥ 80` → same-price / small-premium re-buy allowed on strong conviction
- Reuses meta-label + correlation gates.

### Re-entry window
Set at the moment R1/R2 fires inside `processExits`:
```
reentry_deadline = now + clamp(round(3 / atrPct), 1, 10) trading days
```
Low-vol name (atrPct 0.01) → ~10 days; high-vol (atrPct 0.05) → ~1 day. Purely parameter-driven.

## 3. Sizing (conviction × risk × heat)

Reuse existing `computePositionSize` with three modifiers:

- **Add-on dollars** = `baseSize × addScale`, where `addScale = (conviction − 60) / 40` clamped to `[0.25, 1.5]`. Conviction 70 → 0.25×, 80 → 0.5×, 90 → 0.75×, 100 → 1.0×; if `realKelly` sample ≥30 and edge is strong, allowed up to 1.5×.
- **Re-entry dollars** = `min(trim_notional, computePositionSize output)` — never re-buy more than what was trimmed.
- **All sizes are then clamped** by the existing pre-pass: single-name cap, sector cap, correlation gate, and the 6% portfolio heat cap. If any cap would be breached, size is scaled down; if that pushes it below the min-notional, the add is skipped (logged as `ADD_BLOCKED_HEAT` / `ADD_BLOCKED_SECTOR` / etc.). This is how the user's "depends on stock parameters" preference is honoured — the guardrails already scale with risk, we just plug pyramids into the same pre-pass.

## 4. Stops & exits after an add

- Recompute weighted-average entry across original + adds.
- **Hard stop stays at the original** (never widen risk on a pyramid — this is the one non-negotiable rule; without it, add-ons blow up the R-model).
- Trailing stop / R1 / R2 recompute off the new weighted entry.
- On re-entry after R1/R2, restore R1/R2 targets on the re-bought slice only, so the trimmed profits stay banked.

## 5. Logging & UX

- New `autotrade_log` action types: `ADD_ON`, `RE_ENTRY`, `ADD_BLOCKED_*`.
- Include `add_on_count`, `dynamic_add_floor`, `reentry_reason` in the log payload.
- `AutotraderLog.tsx` gets two new badge variants and the position card shows "×2" / "×3" pips when pyramided.
- No dashboard behaviour changes beyond that; virtual-position math already reads from the same table.

---

## Technical section

**Files:**
- `supabase/migrations/<new>.sql` — add 5 columns to `virtual_positions`.
- `supabase/functions/autotrader-scan/index.ts`:
  - New `runAddOnDecision(pos, signal, ctx)` and `runReEntryDecision(pos, signal, ctx)` helpers.
  - `runEntryDecision` router switch (see §2).
  - `processExits` writes `partial_trim_price`, `partial_trim_shares`, `reentry_deadline` when R1/R2 fires.
  - Weighted-entry recompute on successful add.
- `supabase/functions/_shared/signal-engine-v2.ts`: expose small helper `computeAddOnSize(baseSize, conviction, realizedEdge)` so backtest can reuse identical math later.
- `src/pages/AutotraderLog.tsx`: badge/label additions.
- `src/integrations/supabase/types.ts` — regenerated automatically after migration.

**Sharding:** add-on / re-entry evaluation runs inside the existing `mode=entries` shards; each open position that gets a fresh signal counts as one unit toward `MAX_ENTRY_TICKERS_PER_INVOCATION`, so CPU budget stays bounded.

**Backtest parity:** add-on math lives in `_shared/signal-engine-v2.ts`; the backtester can adopt it in a follow-up without diverging.

**Safety invariants preserved:** hard stop never widens, 6% heat cap, single-name cap, sector cap, correlation gate, meta-label SKIP, ADWIN drift halt, earnings blackout — all still gate every add.
