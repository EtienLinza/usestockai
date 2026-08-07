CREATE TABLE public.adaptive_signal_params (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile text NOT NULL,
  market_regime text NOT NULL,
  status text NOT NULL DEFAULT 'shadow',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  train_expectancy numeric,
  valid_expectancy numeric,
  baseline_valid_expectancy numeric,
  improvement numeric,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.adaptive_signal_params TO authenticated;
GRANT ALL ON public.adaptive_signal_params TO service_role;

ALTER TABLE public.adaptive_signal_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view adaptive signal params"
  ON public.adaptive_signal_params FOR SELECT TO authenticated USING (true);

CREATE UNIQUE INDEX adaptive_signal_params_active_uniq
  ON public.adaptive_signal_params (profile, market_regime)
  WHERE status = 'active';

CREATE INDEX adaptive_signal_params_status_idx
  ON public.adaptive_signal_params (status, computed_at DESC);