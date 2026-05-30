CREATE OR REPLACE FUNCTION public.constituents_as_of(_index_name text, _as_of date)
RETURNS TABLE(ticker text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ticker
  FROM public.historical_constituents
  WHERE index_name = _index_name
    AND effective_from <= _as_of
    AND (effective_to IS NULL OR effective_to > _as_of);
$$;