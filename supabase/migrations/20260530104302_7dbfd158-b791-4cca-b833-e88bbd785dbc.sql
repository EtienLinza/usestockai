CREATE TABLE IF NOT EXISTS public.historical_constituents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  index_name text NOT NULL DEFAULT 'SP500',
  ticker text NOT NULL,
  company text,
  sector text,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.historical_constituents TO anon, authenticated;
GRANT ALL ON public.historical_constituents TO service_role;

ALTER TABLE public.historical_constituents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read historical_constituents"
  ON public.historical_constituents FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hist_const_ticker_from
  ON public.historical_constituents(index_name, ticker, effective_from);
CREATE INDEX IF NOT EXISTS idx_hist_const_window
  ON public.historical_constituents(index_name, effective_from, effective_to);

CREATE OR REPLACE FUNCTION public.constituents_as_of(_index_name text, _as_of date)
RETURNS TABLE(ticker text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ticker
  FROM public.historical_constituents
  WHERE index_name = _index_name
    AND effective_from <= _as_of
    AND (effective_to IS NULL OR effective_to > _as_of);
$$;