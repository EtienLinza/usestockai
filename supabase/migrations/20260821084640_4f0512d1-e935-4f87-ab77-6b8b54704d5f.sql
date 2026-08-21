CREATE TABLE public.ticker_fetch_failures (
  ticker text NOT NULL PRIMARY KEY,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_failure_at timestamp with time zone NOT NULL DEFAULT now(),
  quarantined_until timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.ticker_fetch_failures TO service_role;

ALTER TABLE public.ticker_fetch_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages ticker fetch failures"
ON public.ticker_fetch_failures
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_ticker_fetch_failures_quarantine
  ON public.ticker_fetch_failures (quarantined_until);

CREATE TRIGGER trg_ticker_fetch_failures_updated_at
BEFORE UPDATE ON public.ticker_fetch_failures
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();