
-- Finnhub data cache: shared across all edge-function cold starts
CREATE TABLE IF NOT EXISTS public.finnhub_cache (
  cache_key text PRIMARY KEY,
  category text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finnhub_cache_expires ON public.finnhub_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_finnhub_cache_category ON public.finnhub_cache (category);

GRANT ALL ON public.finnhub_cache TO service_role;

ALTER TABLE public.finnhub_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No client access to finnhub_cache"
  ON public.finnhub_cache
  FOR SELECT
  TO anon, authenticated
  USING (false);

-- Atomic price-alert trigger: claim an unfired alert in a single statement so
-- two concurrent crons can never double-fire the same notification.
CREATE OR REPLACE FUNCTION public.claim_price_alert(_alert_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  did_claim boolean;
BEGIN
  UPDATE public.price_alerts
    SET is_triggered = true,
        triggered_at = now()
    WHERE id = _alert_id
      AND COALESCE(is_triggered, false) = false
  RETURNING true INTO did_claim;
  RETURN COALESCE(did_claim, false);
END;
$$;
