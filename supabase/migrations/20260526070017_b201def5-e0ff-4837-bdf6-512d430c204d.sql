REVOKE EXECUTE ON FUNCTION public.get_user_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO service_role;