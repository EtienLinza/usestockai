DROP POLICY IF EXISTS "gate_adjustments readable by authenticated" ON public.gate_adjustments;
DROP POLICY IF EXISTS "Anyone authenticated can read shadow predictions" ON public.shadow_predictions;
REVOKE SELECT ON public.gate_adjustments FROM anon, authenticated;
REVOKE SELECT ON public.shadow_predictions FROM anon, authenticated;
GRANT ALL ON public.gate_adjustments TO service_role;
GRANT ALL ON public.shadow_predictions TO service_role;