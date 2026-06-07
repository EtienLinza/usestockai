---
name: Open-Position Idempotency (P-4)
description: Partial unique index uniq_open_position_per_user_ticker enforces single open position per user+ticker; insert call sites translate the 23505 violation into friendly messages
type: feature
---

Closes audit gap **P-4** — no idempotency on `virtual_positions` inserts. Retry after a partial failure (network blip during autotrader entry) could create a second open row for the same (user, ticker), silently double-counting exposure and corrupting accounting.

## Schema

Migration `20260607_…` added a partial unique index:
```sql
CREATE UNIQUE INDEX uniq_open_position_per_user_ticker
  ON public.virtual_positions (user_id, ticker)
  WHERE status = 'open';
```

Closed rows are unaffected — users can still close + re-enter the same ticker, and the autotrader can still write paired closed rows on partial exits.

## Pre-clean

Migration first deleted accidental duplicates that matched exactly on `(user_id, ticker, entry_price, shares)`, keeping the earliest by `created_at`. Two known duplicate sets in production were resolved (ROST ×2, TWST ×3 for one user).

## Call-site handling

`23505` (unique_violation) is caught and converted to a friendly outcome instead of a generic insert error:
- **`autotrader-scan/executeEntry`** — logs `[entry] duplicate open suppressed for <ticker>` and returns cleanly (sibling scan already opened the position).
- **`src/pages/Dashboard.tsx#handleBuy`** — toast `"You already have an open position in <ticker>. Close it first to re-enter."`
- **`src/components/dashboard/RegisterBuyDialog.tsx`** — same message thrown.

The partial closed-row insert in `autotrader-scan` (partial-exit accounting) is unaffected because the index only enforces uniqueness on `status='open'`.
