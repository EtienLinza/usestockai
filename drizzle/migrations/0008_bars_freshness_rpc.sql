CREATE OR REPLACE FUNCTION public.bars_freshness(_tickers text[])
RETURNS TABLE(ticker text, as_of date, updated_at timestamptz, last_close numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (c.ticker) c.ticker, c.as_of, c.updated_at,
    ((c.bars->'close')->>(jsonb_array_length(c.bars->'close') - 1))::numeric
  FROM public.ticker_bars_cache c
  WHERE c.ticker = ANY(_tickers[1:50]) AND jsonb_typeof(c.bars->'close') = 'array'
  ORDER BY c.ticker, c.as_of DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.bars_freshness(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bars_freshness(text[]) TO authenticated;