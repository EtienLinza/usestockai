-- First nullify signal_id references in virtual_positions for signals being deleted
UPDATE public.virtual_positions
SET signal_id = NULL
WHERE signal_id IN (
  SELECT id FROM public.live_signals
  WHERE id NOT IN (
    SELECT DISTINCT ON (ticker) id
    FROM public.live_signals
    ORDER BY ticker, created_at DESC
  )
);

-- Now delete duplicate signals
DELETE FROM public.live_signals
WHERE id NOT IN (
  SELECT DISTINCT ON (ticker) id
  FROM public.live_signals
  ORDER BY ticker, created_at DESC
);

-- Add unique constraint
ALTER TABLE public.live_signals ADD CONSTRAINT live_signals_ticker_unique UNIQUE (ticker);