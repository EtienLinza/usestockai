ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_goal text,
  ADD COLUMN IF NOT EXISTS paywall_recommended_tier text,
  ADD COLUMN IF NOT EXISTS disclosure_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS paywall_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS winback_shown_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.product_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.product_events TO authenticated;
GRANT ALL ON public.product_events TO service_role;

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own product events"
  ON public.product_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own product events"
  ON public.product_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS product_events_user_time_idx ON public.product_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_events_event_time_idx ON public.product_events (event, created_at DESC);