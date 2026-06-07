-- ── P-4: dedupe + guarantee no concurrent open positions per (user, ticker) ──
-- Step 1: remove accidental duplicates that match exactly (race-condition signature)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, ticker, entry_price, shares
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.virtual_positions
  WHERE status = 'open'
)
DELETE FROM public.virtual_positions vp
USING ranked r
WHERE vp.id = r.id
  AND r.rn > 1;

-- Step 2: partial unique index — codifies the "no concurrent exposure" rule.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_position_per_user_ticker
  ON public.virtual_positions (user_id, ticker)
  WHERE status = 'open';