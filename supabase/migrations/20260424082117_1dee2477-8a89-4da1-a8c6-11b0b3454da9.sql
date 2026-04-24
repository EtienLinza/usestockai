
-- ============================================================================
-- AUTOTRADER SCHEMA
-- ============================================================================

-- 1. autotrade_settings: per-user opt-in + risk knobs
CREATE TABLE public.autotrade_settings (
  user_id              uuid PRIMARY KEY,
  enabled              boolean   NOT NULL DEFAULT false,
  min_conviction       integer   NOT NULL DEFAULT 70,
  max_positions        integer   NOT NULL DEFAULT 8,
  max_nav_exposure_pct numeric   NOT NULL DEFAULT 80,
  max_single_name_pct  numeric   NOT NULL DEFAULT 20,
  daily_loss_limit_pct numeric   NOT NULL DEFAULT 3,
  starting_nav         numeric   NOT NULL DEFAULT 100000,
  paper_mode           boolean   NOT NULL DEFAULT true,
  notify_on_action     boolean   NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.autotrade_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own autotrade settings"
  ON public.autotrade_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own autotrade settings"
  ON public.autotrade_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own autotrade settings"
  ON public.autotrade_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own autotrade settings"
  ON public.autotrade_settings FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER autotrade_settings_updated_at
  BEFORE UPDATE ON public.autotrade_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. autotrade_log: audit trail
CREATE TABLE public.autotrade_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  ticker      text NOT NULL,
  action      text NOT NULL CHECK (action IN ('ENTRY','PARTIAL_EXIT','FULL_EXIT','HOLD','BLOCKED','ERROR')),
  reason      text,
  price       numeric,
  shares      numeric,
  pnl_pct     numeric,
  conviction  integer,
  strategy    text,
  profile     text,
  position_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.autotrade_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own autotrade log"
  ON public.autotrade_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_autotrade_log_user_created ON public.autotrade_log (user_id, created_at DESC);

-- 3. Auto-seed autotrade_settings for new users (mirror portfolio_caps pattern)
CREATE OR REPLACE FUNCTION public.create_default_autotrade_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.autotrade_settings (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_autotrade
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_default_autotrade_settings();

-- Backfill for existing users
INSERT INTO public.autotrade_settings (user_id)
SELECT user_id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- 4. Extend virtual_positions with state the autotrader needs
ALTER TABLE public.virtual_positions
  ADD COLUMN IF NOT EXISTS peak_price            numeric,
  ADD COLUMN IF NOT EXISTS trailing_stop_price   numeric,
  ADD COLUMN IF NOT EXISTS hard_stop_price       numeric,
  ADD COLUMN IF NOT EXISTS entry_atr             numeric,
  ADD COLUMN IF NOT EXISTS entry_conviction      integer,
  ADD COLUMN IF NOT EXISTS entry_strategy        text,
  ADD COLUMN IF NOT EXISTS entry_profile         text,
  ADD COLUMN IF NOT EXISTS entry_weekly_alloc    numeric,
  ADD COLUMN IF NOT EXISTS breakout_failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opened_by             text    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS cooldown_until        timestamptz;

CREATE INDEX IF NOT EXISTS idx_virtual_positions_user_status ON public.virtual_positions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_virtual_positions_cooldown   ON public.virtual_positions (user_id, ticker, cooldown_until);
