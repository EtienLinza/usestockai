ALTER TABLE public.signal_outcomes
  ADD COLUMN IF NOT EXISTS macro_score numeric,
  ADD COLUMN IF NOT EXISTS macro_label text,
  ADD COLUMN IF NOT EXISTS weights_id uuid REFERENCES public.strategy_weights(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_macro_label ON public.signal_outcomes(macro_label) WHERE macro_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_weights_id ON public.signal_outcomes(weights_id) WHERE weights_id IS NOT NULL;