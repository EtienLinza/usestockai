DROP POLICY IF EXISTS "Authenticated can view strategy weights" ON public.strategy_weights;

CREATE POLICY "Block client reads on strategy_weights"
ON public.strategy_weights
AS RESTRICTIVE
FOR SELECT
TO anon, authenticated
USING (false);