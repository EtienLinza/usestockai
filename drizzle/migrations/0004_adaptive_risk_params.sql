CREATE TABLE public.adaptive_risk_params (
  user_id uuid PRIMARY KEY,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.adaptive_risk_params TO authenticated;
GRANT ALL ON public.adaptive_risk_params TO service_role;
ALTER TABLE public.adaptive_risk_params ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own adaptive risk params" ON public.adaptive_risk_params
  FOR SELECT TO authenticated USING (auth.uid() = user_id);