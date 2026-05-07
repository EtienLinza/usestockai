
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.create_default_autotrade_settings() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.create_default_portfolio_caps() FROM anon, authenticated, public;
