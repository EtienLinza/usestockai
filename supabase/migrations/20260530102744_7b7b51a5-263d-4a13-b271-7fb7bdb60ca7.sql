-- Deduplicate open signal_outcomes: keep newest per signal_id, mark older ones as 'stale'
UPDATE public.signal_outcomes so
SET status = 'stale', updated_at = now()
WHERE so.status = 'open'
  AND so.signal_id IS NOT NULL
  AND so.id NOT IN (
    SELECT DISTINCT ON (signal_id) id
    FROM public.signal_outcomes
    WHERE status = 'open' AND signal_id IS NOT NULL
    ORDER BY signal_id, entry_date DESC, created_at DESC
  );

-- Unique partial index so we can upsert open signal_outcomes safely
CREATE UNIQUE INDEX IF NOT EXISTS signal_outcomes_signal_id_open_uniq
  ON public.signal_outcomes(signal_id)
  WHERE signal_id IS NOT NULL AND status = 'open';

-- Atomic backtest quota
CREATE OR REPLACE FUNCTION public.increment_backtest_usage(
  _user_id uuid,
  _month_key text,
  _limit int
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count int;
BEGIN
  INSERT INTO public.usage_counters (user_id, month_key, backtests_run)
  VALUES (_user_id, _month_key, 1)
  ON CONFLICT (user_id, month_key) DO NOTHING
  RETURNING backtests_run INTO new_count;

  IF new_count IS NOT NULL THEN
    RETURN new_count;
  END IF;

  UPDATE public.usage_counters
    SET backtests_run = backtests_run + 1,
        updated_at = now()
    WHERE user_id = _user_id
      AND month_key = _month_key
      AND backtests_run < _limit
    RETURNING backtests_run INTO new_count;

  IF new_count IS NULL THEN
    RETURN -1;
  END IF;
  RETURN new_count;
END;
$$;

-- Ensure unique constraint exists for ON CONFLICT to work
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_counters_user_month_uniq'
  ) THEN
    ALTER TABLE public.usage_counters
      ADD CONSTRAINT usage_counters_user_month_uniq UNIQUE (user_id, month_key);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.increment_backtest_usage(uuid, text, int) TO authenticated, service_role;