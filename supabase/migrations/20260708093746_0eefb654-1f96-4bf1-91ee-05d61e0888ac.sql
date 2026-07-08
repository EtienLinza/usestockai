
ALTER TABLE public.virtual_positions
  ADD COLUMN IF NOT EXISTS add_on_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_add_on_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_shares NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_trim_price NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_trim_shares NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reentry_deadline TIMESTAMPTZ;

-- Backfill original_shares for existing open positions (best-effort snapshot)
UPDATE public.virtual_positions
SET original_shares = shares
WHERE status = 'open' AND original_shares IS NULL;
