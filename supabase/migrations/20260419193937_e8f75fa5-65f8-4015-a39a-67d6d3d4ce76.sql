-- Per-user portfolio gating preferences
CREATE TABLE public.portfolio_caps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  sector_max_pct NUMERIC NOT NULL DEFAULT 35,
  portfolio_beta_max NUMERIC NOT NULL DEFAULT 1.5,
  max_correlated_positions INTEGER NOT NULL DEFAULT 3,
  enforcement_mode TEXT NOT NULL DEFAULT 'warn', -- 'warn' or 'block'
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sector_max_pct_range CHECK (sector_max_pct > 0 AND sector_max_pct <= 100),
  CONSTRAINT beta_max_range CHECK (portfolio_beta_max > 0 AND portfolio_beta_max <= 5),
  CONSTRAINT correlated_range CHECK (max_correlated_positions >= 1 AND max_correlated_positions <= 20),
  CONSTRAINT enforcement_mode_valid CHECK (enforcement_mode IN ('warn','block'))
);

ALTER TABLE public.portfolio_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own portfolio caps"
  ON public.portfolio_caps FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own portfolio caps"
  ON public.portfolio_caps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own portfolio caps"
  ON public.portfolio_caps FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own portfolio caps"
  ON public.portfolio_caps FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_portfolio_caps_updated_at
  BEFORE UPDATE ON public.portfolio_caps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-seed default caps when a profile is created
CREATE OR REPLACE FUNCTION public.create_default_portfolio_caps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.portfolio_caps (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER seed_portfolio_caps_on_profile
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_default_portfolio_caps();

-- Backfill caps for any existing users
INSERT INTO public.portfolio_caps (user_id)
SELECT user_id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;