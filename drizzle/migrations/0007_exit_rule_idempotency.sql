CREATE TABLE public.position_rule_fires (
  campaign_id uuid NOT NULL,
  rule_id text NOT NULL,
  bar_date date NOT NULL,
  position_id uuid,
  user_id uuid NOT NULL,
  shares numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, rule_id, bar_date)
);
GRANT SELECT ON public.position_rule_fires TO authenticated;
GRANT ALL ON public.position_rule_fires TO service_role;
ALTER TABLE public.position_rule_fires ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own rule fires" ON public.position_rule_fires FOR SELECT TO authenticated USING (auth.uid() = user_id);
ALTER TABLE public.virtual_positions ADD COLUMN IF NOT EXISTS exit_cause text;
UPDATE public.virtual_positions SET exit_cause = CASE
  WHEN stop_slippage_pct IS NULL THEN NULL
  WHEN stop_slippage_pct >= 1.5 THEN 'gap_through'
  WHEN stop_slippage_pct >= 0.3 THEN 'slippage'
  ELSE 'clean' END
WHERE status = 'closed';