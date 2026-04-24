## What changes

The AutoTrader Settings page currently exposes 7 knobs at all times, with a fixed 10-min cron schedule baked into Postgres. We'll restructure it so:

1. **By default, the algorithm runs on autopilot** — no sliders shown, the engine picks every threshold and a sensible scan cadence on its own.
2. **An "Advanced mode" toggle** reveals all controls, including a new **Scan Interval** control.
3. **Scan interval becomes user-customisable** (5 / 10 / 15 / 30 / 60 minutes).

The Portfolio Risk Caps section above stays as-is (already separate from AutoTrader).

---

## User-facing flow

```text
Settings → AutoTrader card
┌──────────────────────────────────────────────┐
│  ⚙ Enable AutoTrader            [ON/OFF]    │
│  📄 Paper mode                  [ON/OFF]    │
│  🧠 Advanced mode               [OFF]   ←── │
│                                              │
│  When Advanced is OFF:                       │
│  ┌────────────────────────────────────────┐ │
│  │ Algorithm picks all thresholds and     │ │
│  │ adapts scan cadence to volatility.     │ │
│  │ Last scan: 4 min ago · Next: in 6 min  │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  When Advanced is ON:                        │
│  ▸ Scan interval         [5/10/15/30/60 min]│
│  ▸ Min conviction        [50──95]            │
│  ▸ Max open positions    [1──20]             │
│  ▸ Max NAV exposure      [20%──100%]         │
│  ▸ Max single-name %     [5%──50%]           │
│  ▸ Daily loss kill-switch[1%──10%]           │
└──────────────────────────────────────────────┘
```

In **non-advanced mode**, the saved values in the DB are ignored at scan-time; the engine reads `advanced_mode = false` and substitutes its own dynamic values:

| Knob | Algo default in non-advanced mode |
|------|-----------------------------------|
| `min_conviction` | 72 floor, but raised to 78 when SPY macro is bearish |
| `max_positions` | `clamp(round(starting_nav / 12 500), 4, 12)` |
| `max_nav_exposure_pct` | 60% in bear macro, 80% in bull |
| `max_single_name_pct` | `min(20, kellyFraction × 100)` per signal |
| `daily_loss_limit_pct` | 3% (hardcoded safety floor) |
| `scan_interval_minutes` | dynamic: 5 in high VIX / open-half-hour, 10 normally, 15 in slow afternoon |

---

## Schema changes (single migration)

```sql
ALTER TABLE public.autotrade_settings
  ADD COLUMN advanced_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN scan_interval_minutes integer NOT NULL DEFAULT 10
    CHECK (scan_interval_minutes IN (5, 10, 15, 30, 60)),
  ADD COLUMN last_scan_at timestamptz,
  ADD COLUMN next_scan_at timestamptz;
```

No data migration needed — every existing row gets `advanced_mode = false` (autopilot) and `scan_interval_minutes = 10` (current behaviour).

---

## Cron strategy

Keep the existing `pg_cron` job firing **every 5 minutes** (the smallest user-selectable interval). The edge function itself becomes the gate:

```text
autotrader-scan invoked (every 5 min)
  └─ for each enabled user:
       ├─ if now() < user.next_scan_at → skip
       ├─ run scan
       └─ update last_scan_at = now()
                  next_scan_at = now() + interval (advanced ? user.scan_interval : algoScanInterval(macro))
```

This means we don't touch user-specific data in `pg_cron` (which would be a remix-unsafe pattern), and every user gets their own personal cadence enforced server-side.

---

## Files touched

**Migration (new):**
- `supabase/migrations/<ts>_autotrader_advanced_mode.sql` — adds the 4 columns above.

**Edge function:**
- `supabase/functions/autotrader-scan/index.ts`
  - Read new columns into the `Settings` type.
  - Add `resolveEffectiveSettings(settings, macro)` that returns the algo-decided values when `advanced_mode = false`.
  - Add `algoScanInterval(macro)` returning 5/10/15 based on SPY 5-bar realised vol + time-of-day (NY).
  - Per-user gate on `next_scan_at`; update both timestamps after each successful scan.
  - Pass `effectiveSettings` (not raw `settings`) into `runEntryDecision`.

**Cron schedule:**
- Update the `pg_cron` job from `*/10` to `*/5` during market hours via the insert tool (data op, not migration).

**Frontend:**
- `src/pages/Settings.tsx`
  - Add `advanced_mode` + `scan_interval_minutes` to the `AutoTradeSettings` interface and defaults.
  - Add an "Advanced mode" `Switch` row directly under the Paper-mode switch.
  - Wrap the 5 existing `CapSlider`s in `{bot.advanced_mode && (...)}`.
  - Add a new `Select` for scan interval (5/10/15/30/60) — only when advanced.
  - When non-advanced, render a small status card showing "Last scan · Next scan" using `last_scan_at` / `next_scan_at`.
  - Update the upsert payload to include the two new fields.

---

## What stays the same

- All exit logic (peak detection, hard stop, time stop, thesis invalidation) — unchanged.
- Portfolio Risk Caps section — untouched.
- Paper mode — still on by default; live broker is still out of scope.
- The unified `evaluateSignal()` engine — no algo changes.

---

## Why this is safe

- Autopilot defaults are strictly *more conservative* than current hardcoded ones (e.g., 72 conviction floor vs 70, exposure auto-throttles in bear macro).
- Existing users keep current behaviour because the column defaults are equivalent (`scan_interval_minutes = 10`, plus autopilot picks the same 70-conviction-style numbers in normal markets).
- The cron change from `*/10` to `*/5` only adds extra "is it time yet?" checks; no extra scans actually run unless a user has selected the 5-min interval.
