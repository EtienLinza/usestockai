
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL,
  product_id text NOT NULL,
  price_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_id ON public.subscriptions(stripe_subscription_id);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own subscription"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "No client inserts on subscriptions"
  ON public.subscriptions AS RESTRICTIVE FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "No client updates on subscriptions"
  ON public.subscriptions AS RESTRICTIVE FOR UPDATE
  TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "No client deletes on subscriptions"
  ON public.subscriptions AS RESTRICTIVE FOR DELETE
  TO anon, authenticated
  USING (false);

CREATE OR REPLACE FUNCTION public.has_active_subscription(user_uuid uuid, check_env text DEFAULT 'live')
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = user_uuid
      AND environment = check_env
      AND (
        (status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.tier_from_price_id(_price_id text)
RETURNS public.subscription_tier
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _price_id IN ('pro_monthly','pro_yearly') THEN 'pro'::public.subscription_tier
    WHEN _price_id IN ('elite_monthly','elite_yearly') THEN 'elite'::public.subscription_tier
    ELSE 'free'::public.subscription_tier
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_tier_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_tier public.subscription_tier;
  is_active boolean;
BEGIN
  is_active := (NEW.status IN ('active','trialing','past_due'))
            OR (NEW.status = 'canceled' AND NEW.current_period_end IS NOT NULL AND NEW.current_period_end > now());

  IF is_active THEN
    new_tier := public.tier_from_price_id(NEW.price_id);
  ELSE
    new_tier := 'free'::public.subscription_tier;
  END IF;

  UPDATE public.profiles
  SET subscription_tier = new_tier,
      tier_updated_at = now(),
      updated_at = now()
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_profile_tier
AFTER INSERT OR UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_tier_from_subscription();

CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
