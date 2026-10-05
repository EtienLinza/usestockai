DROP POLICY IF EXISTS "Authenticated users can view adaptive exit params" ON public.adaptive_exit_params;
DROP POLICY IF EXISTS "Authenticated users can view adaptive signal params" ON public.adaptive_signal_params;
REVOKE SELECT ON public.adaptive_exit_params FROM anon, authenticated;
REVOKE SELECT ON public.adaptive_signal_params FROM anon, authenticated;
GRANT ALL ON public.adaptive_exit_params TO service_role;
GRANT ALL ON public.adaptive_signal_params TO service_role;