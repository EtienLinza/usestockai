-- Restrictive write-blocking policies for autotrader_state
CREATE POLICY "No client inserts on autotrader_state"
  ON public.autotrader_state AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "No client updates on autotrader_state"
  ON public.autotrader_state AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "No client deletes on autotrader_state"
  ON public.autotrader_state AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (false);

-- Restrictive write-blocking policies for news_sentiment_cache
CREATE POLICY "No client inserts on news_sentiment_cache"
  ON public.news_sentiment_cache AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "No client updates on news_sentiment_cache"
  ON public.news_sentiment_cache AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "No client deletes on news_sentiment_cache"
  ON public.news_sentiment_cache AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (false);