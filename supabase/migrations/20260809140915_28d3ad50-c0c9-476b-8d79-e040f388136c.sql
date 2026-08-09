CREATE TABLE public.rejection_accuracy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at timestamptz NOT NULL DEFAULT now(),
  window_days integer NOT NULL DEFAULT 90,
  rejection_reason text NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  would_win_rate numeric,
  avg_return_pct numeric,
  hit_target_rate numeric,
  hit_stop_rate numeric,
  verdict text NOT NULL DEFAULT 'ok',
  notes jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.rejection_accuracy TO authenticated;
GRANT ALL ON public.rejection_accuracy TO service_role;
ALTER TABLE public.rejection_accuracy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rejection_accuracy readable by authenticated"
  ON public.rejection_accuracy FOR SELECT TO authenticated USING (true);

CREATE TABLE public.gate_adjustments (
  gate_key text PRIMARY KEY,
  delta numeric NOT NULL DEFAULT 0,
  min_delta numeric NOT NULL DEFAULT -5,
  max_delta numeric NOT NULL DEFAULT 5,
  sample_size integer NOT NULL DEFAULT 0,
  rationale text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gate_adjustments TO authenticated;
GRANT ALL ON public.gate_adjustments TO service_role;
ALTER TABLE public.gate_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate_adjustments readable by authenticated"
  ON public.gate_adjustments FOR SELECT TO authenticated USING (true);