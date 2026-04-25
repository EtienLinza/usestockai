-- 1. Per-user kill switch
ALTER TABLE public.autotrade_settings
  ADD COLUMN kill_switch boolean NOT NULL DEFAULT false;

-- 2. Drop the now-unused sentiment toggle
ALTER TABLE public.autotrade_settings
  DROP COLUMN use_news_sentiment;

-- 3. Global system flags table (service-role write, authed read)
CREATE TABLE public.system_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed users can read flags"
  ON public.system_flags
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies → service role only

CREATE TRIGGER update_system_flags_updated_at
  BEFORE UPDATE ON public.system_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the global kill switch row
INSERT INTO public.system_flags (key, value)
VALUES ('global_kill_switch', '{"active": false, "reason": null, "tripped_at": null}'::jsonb);