

# Background Scanning + Per-User Sell Alerts

## Current State
- Market scanning already runs automatically via 6 pg_cron jobs (every 15 min during market hours, batches 0-2)
- But `checkSells` is hardcoded to `false` in all cron jobs — sell alerts only fire when a user manually clicks "Scan Market"
- Sell alerts are ephemeral (stored in React state only, lost on page reload)

## Plan

### 1. Create `sell_alerts` table (migration)
Persistent per-user sell alerts so they survive page reloads and work without user action:
```sql
CREATE TABLE public.sell_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  reason text NOT NULL,
  current_price numeric NOT NULL,
  position_id uuid REFERENCES public.virtual_positions(id) ON DELETE CASCADE,
  is_dismissed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.sell_alerts ENABLE ROW LEVEL SECURITY;
-- Users can only see/manage their own alerts
CREATE POLICY "Users can view own sell alerts" ON public.sell_alerts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own sell alerts" ON public.sell_alerts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sell alerts" ON public.sell_alerts FOR DELETE TO authenticated USING (auth.uid() = user_id);
-- Service role inserts via edge function (no INSERT policy needed for authenticated)
ALTER PUBLICATION supabase_realtime ADD TABLE public.sell_alerts;
```

### 2. Create `check-sell-alerts` edge function
A new lightweight function that:
- Queries ALL users with open positions (using service role)
- For each user's open positions, fetches current prices and checks hard stop (-8%), take profit (+15%), and weekly reversal
- Upserts triggered alerts into `sell_alerts` table (avoids duplicates per position+reason)
- Logs portfolio snapshots for each user
- No user-facing auth needed — runs from cron with service role

### 3. Add cron job for sell alert checking
Schedule `check-sell-alerts` to run every 15 minutes during market hours (matching scanner cadence), staggered 7 minutes after scanner runs so prices are fresh.

### 4. Update `market-scanner` edge function
- Remove the `checkSells` / `userId` logic entirely — sell checking is now a separate concern
- Simplify to only scan for signals (its core job)

### 5. Update Dashboard (`src/pages/Dashboard.tsx`)
- Load sell alerts from `sell_alerts` table on mount (instead of only from scan response)
- Subscribe to realtime `sell_alerts` changes so new alerts appear instantly
- "Dismiss" button on alerts updates `is_dismissed = true` instead of removing from state
- Remove `checkSells` param from manual scan — scan only refreshes signals
- Keep manual "Scan Market" button but label it as supplemental ("signals auto-refresh every 15 min")
- Show "Auto-scanning active" indicator in header when cron is running (based on `lastScanTime` freshness)

### 6. Update `config.toml`
Add the new function:
```toml
[functions.check-sell-alerts]
verify_jwt = false
```

## Files Changed
1. **Migration** — create `sell_alerts` table + RLS + realtime
2. **Create `supabase/functions/check-sell-alerts/index.ts`** — background sell alert checker for all users
3. **Edit `supabase/functions/market-scanner/index.ts`** — remove sell-check logic (lines 659-727)
4. **Edit `src/pages/Dashboard.tsx`** — load/subscribe to `sell_alerts` from DB, remove ephemeral sell alert state, add dismiss functionality, show auto-scan status
5. **`supabase/config.toml`** is auto-managed

## Architecture After Change

```text
Every 15 min (cron):
  market-scanner batch 0 → signals to live_signals table
  market-scanner batch 1 → signals to live_signals table  
  market-scanner batch 2 → signals to live_signals table

Every 15 min +7 min offset (cron):
  check-sell-alerts → queries ALL users' open positions
                    → writes to sell_alerts table
                    → logs portfolio snapshots

Dashboard (realtime):
  ← subscribes to live_signals (signals appear automatically)
  ← subscribes to sell_alerts (sell alerts appear automatically)
  Manual scan button still available for on-demand refresh
```

