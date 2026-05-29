
ALTER FUNCTION public.tier_from_price_id(text) SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_tier_from_subscription() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tier_from_price_id(text) FROM PUBLIC, anon, authenticated;
