
-- Tighten write blocks on autotrade_log: cover ALL roles (anon + authenticated) with a RESTRICTIVE policy.
DROP POLICY IF EXISTS "Block client inserts on autotrade_log" ON public.autotrade_log;
DROP POLICY IF EXISTS "Block client updates on autotrade_log" ON public.autotrade_log;
DROP POLICY IF EXISTS "Block client deletes on autotrade_log" ON public.autotrade_log;

CREATE POLICY "No client inserts on autotrade_log"
ON public.autotrade_log AS RESTRICTIVE FOR INSERT TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "No client updates on autotrade_log"
ON public.autotrade_log AS RESTRICTIVE FOR UPDATE TO anon, authenticated
USING (false);

CREATE POLICY "No client deletes on autotrade_log"
ON public.autotrade_log AS RESTRICTIVE FOR DELETE TO anon, authenticated
USING (false);

-- Lock strategy_weights (proprietary calibration) to authenticated users only.
DROP POLICY IF EXISTS "Anyone can view strategy weights (anon)" ON public.strategy_weights;
