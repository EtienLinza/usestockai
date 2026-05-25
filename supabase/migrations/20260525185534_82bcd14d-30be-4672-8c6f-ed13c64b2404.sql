
DO $$ BEGIN
  CREATE TYPE public.subscription_tier AS ENUM ('free', 'pro', 'elite');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier public.subscription_tier NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS tier_updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.profiles
SET subscription_tier = 'elite', tier_updated_at = now()
WHERE lower(email) = 'etien.linza@icloud.com';
