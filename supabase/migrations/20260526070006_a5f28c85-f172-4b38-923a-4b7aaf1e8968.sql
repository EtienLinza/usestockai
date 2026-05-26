-- Add onboarding + tier selection tracking to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tier_selected_at timestamptz,
  ADD COLUMN IF NOT EXISTS trading_experience text,
  ADD COLUMN IF NOT EXISTS focus_areas text[];

-- Monthly usage counters
CREATE TABLE IF NOT EXISTS public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month_key text NOT NULL,
  backtests_run int NOT NULL DEFAULT 0,
  scans_run int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month_key)
);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own usage"
  ON public.usage_counters FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "No client writes on usage_counters insert"
  ON public.usage_counters AS RESTRICTIVE FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "No client writes on usage_counters update"
  ON public.usage_counters AS RESTRICTIVE FOR UPDATE
  TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "No client writes on usage_counters delete"
  ON public.usage_counters AS RESTRICTIVE FOR DELETE
  TO anon, authenticated
  USING (false);

CREATE TRIGGER update_usage_counters_updated_at
  BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_usage_counters_user_month
  ON public.usage_counters (user_id, month_key);

-- Upgrade waitlist
CREATE TABLE IF NOT EXISTS public.upgrade_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  requested_tier text NOT NULL,
  billing_cycle text NOT NULL DEFAULT 'monthly',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.upgrade_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own waitlist"
  ON public.upgrade_waitlist FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own waitlist"
  ON public.upgrade_waitlist FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Helper to fetch a user's tier (for edge functions with SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_user_tier(_user_id uuid)
RETURNS public.subscription_tier
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT subscription_tier FROM public.profiles WHERE user_id = _user_id),
    'free'::public.subscription_tier
  );
$$;