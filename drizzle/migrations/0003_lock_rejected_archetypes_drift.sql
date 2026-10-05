DROP POLICY IF EXISTS "authenticated_read_rejected_signals" ON public.rejected_signals;
DROP POLICY IF EXISTS "authenticated_read_archetypes" ON public.user_archetypes;
DROP POLICY IF EXISTS "authenticated_read_drift" ON public.drift_detections;
REVOKE SELECT ON public.rejected_signals FROM authenticated, anon;
REVOKE SELECT ON public.user_archetypes FROM authenticated, anon;
REVOKE SELECT ON public.drift_detections FROM authenticated, anon;
GRANT ALL ON public.rejected_signals TO service_role;
GRANT ALL ON public.user_archetypes TO service_role;
GRANT ALL ON public.drift_detections TO service_role;