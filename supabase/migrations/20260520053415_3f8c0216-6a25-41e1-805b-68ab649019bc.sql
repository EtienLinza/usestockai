CREATE TABLE IF NOT EXISTS public.danelfin_scores (
  ticker text NOT NULL,
  as_of date NOT NULL,
  ai_score integer NOT NULL,
  technical integer,
  fundamental integer,
  sentiment integer,
  low_risk integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, as_of)
);

CREATE INDEX IF NOT EXISTS idx_danelfin_scores_asof ON public.danelfin_scores (as_of DESC);
CREATE INDEX IF NOT EXISTS idx_danelfin_scores_ticker ON public.danelfin_scores (ticker);

ALTER TABLE public.danelfin_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No client access to danelfin_scores"
  ON public.danelfin_scores
  FOR SELECT
  TO anon, authenticated
  USING (false);