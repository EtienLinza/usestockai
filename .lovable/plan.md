## Goal

Three cleanups:
1. Remove the **Scan Universe** page/route/nav entry.
2. Remove the **Rolling Calibration** feature end-to-end (page, nav, edge function, table, cron, UI components).
3. Make the **autotrader's exit brain** also auto-close **manual positions** (not just its own).

---

## 1. Remove Scan Universe tab

- Delete `src/pages/ScanUniverse.tsx`.
- Remove the `Scan Universe` entry in `src/components/Navbar.tsx` (line ~43) and the `Layers` import if unused.
- Remove the route + import in `src/App.tsx` (lines 17, 44).
- Keep the `scan_universe_log` table (still written by `market-scanner` and useful as background telemetry). No DB change.

## 2. Remove Rolling Calibration fully

Frontend
- Delete `src/pages/Calibration.tsx`.
- Delete `src/components/calibration/ForecastEvolution.tsx` (and the empty `calibration/` dir).
- Remove the `Calibration` route + import in `src/App.tsx` (lines 14, 41).
- Remove the `Calibration` nav entry in `src/components/Navbar.tsx` (line 41) and the `Brain` icon if unused.

Backend
- Delete edge function `supabase/functions/roll-calibration/` (call `delete_edge_functions`).
- Remove its block from `supabase/config.toml`.
- Migration:
  - `DROP TABLE public.calibration_snapshots;`
  - `SELECT cron.unschedule('<roll-calibration job name>');` (look up the actual name in the existing cron migration first).

Note: `calibration-stats` edge function is a different thing (used elsewhere). Confirm before touching — current plan leaves it alone.

## 3. Autotrader sell logic for manual buys

Today: `autotrader-scan` runs **only for users with `autotrade_settings.enabled = true`** and only manages positions where `opened_by = 'autotrader'` for entries; on exits it actually evaluates **all** open positions for the user (no `opened_by` filter on the exit path — verified in `processUser`). The duplicate brain lives in `check-sell-alerts`, which posts non-actionable alerts for manual positions.

Change:
- **Decouple exit-management from `enabled`.** Split the scan into two phases per user:
  - **Exits phase** runs for every user that has any open `virtual_positions`, regardless of `enabled` / `kill_switch=false`. Uses the existing `runWinExit` + `runLossExit` and **executes the close** (writes `status='closed'`, fills exit fields, logs to `autotrade_log` with `action='EXIT'` and a `reason` like "Manual position auto-closed: …").
  - **Entries phase** continues to require `enabled = true` (unchanged).
- `kill_switch = true` still freezes automated exits (current behavior preserved for safety).
- For manual-position closes, also insert a `sell_alerts` row so the user gets a notification of what was auto-sold (UX continuity with today's notifications).
- **Delete `check-sell-alerts/`** edge function and unschedule its cron job in a migration. Remove its config block from `supabase/config.toml`. The autotrader brain is now the single source of exit truth.
- Cron: `autotrader-scan` already runs on its own schedule. Confirm it ticks frequently enough (current default `scan_interval_minutes = 10`, with adaptive overrides) — that matches or beats the prior 15-minute `check-sell-alerts` cadence, so manual exits get checked at least as often.

### User-visible behavior after change
- Open a manual buy → autotrader watches it on every scan → when any of T1–T6 fires, it closes the position and notifies you (instead of just posting an alert you had to action yourself).
- Users who never enable the autotrader still get **automatic exits** on manual positions, because exits are now decoupled from `enabled`. (If you'd rather gate this behind a separate toggle like `auto_exit_manual_positions`, say so and I'll add it — default plan is "always on for safety".)

## Verification

1. After deploy, open `/scan-universe` and `/calibration` → 404.
2. Run `autotrader-scan` manually with a test user that has `enabled=false` + 1 open manual position whose hard stop is already hit → confirm the position flips to `closed`, an `autotrade_log` EXIT row appears, and a `sell_alerts` row is inserted.
3. `select * from cron.job` shows no `roll-calibration` or `check-sell-alerts` jobs.
4. `calibration_snapshots` table is gone; no console errors on dashboard.

## Out of scope

- No changes to entry logic, conviction math, or signal engine.
- `calibration-stats` edge function (separate utility) is left alone.
- `scan_universe_log` table kept (cheap telemetry, no UI now).