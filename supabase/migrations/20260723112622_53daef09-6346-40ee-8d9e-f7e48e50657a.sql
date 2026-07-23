
CREATE TABLE IF NOT EXISTS public.shadow_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version_id UUID NOT NULL REFERENCES public.model_versions(id) ON DELETE CASCADE,
  signal_outcome_id UUID REFERENCES public.signal_outcomes(id) ON DELETE SET NULL,
  ticker TEXT,
  strategy TEXT,
  regime TEXT,
  raw_conviction NUMERIC,
  calibrated_conviction NUMERIC,
  would_enter BOOLEAN,
  realized_pnl_pct NUMERIC,
  outcome_win BOOLEAN,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shadow_predictions_model_idx ON public.shadow_predictions(model_version_id);
CREATE INDEX IF NOT EXISTS shadow_predictions_resolved_idx ON public.shadow_predictions(resolved_at);

GRANT SELECT ON public.shadow_predictions TO authenticated;
GRANT ALL ON public.shadow_predictions TO service_role;

ALTER TABLE public.shadow_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read shadow predictions"
  ON public.shadow_predictions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages shadow predictions"
  ON public.shadow_predictions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- One champion per model_kind
CREATE UNIQUE INDEX IF NOT EXISTS model_versions_one_champion_per_kind
  ON public.model_versions(model_kind) WHERE status = 'champion';

-- Helpful lookups
CREATE INDEX IF NOT EXISTS model_versions_kind_status_idx
  ON public.model_versions(model_kind, status, created_at DESC);
