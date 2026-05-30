
REVOKE EXECUTE ON FUNCTION public.claim_price_alert(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_price_alert(uuid) TO service_role;
