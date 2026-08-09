-- 1) audit_log: clients may no longer write their own entries
DROP POLICY IF EXISTS "Users insert own audit" ON public.audit_log;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

-- 2) profiles: block self-service subscription tier escalation
CREATE OR REPLACE FUNCTION public.prevent_profile_tier_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
     OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  NEW.subscription_tier := OLD.subscription_tier;
  NEW.tier_updated_at := OLD.tier_updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_tier_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_tier_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_tier_escalation();