
-- 1. Realtime channel authorization: scope subscriptions to the authenticated user.
-- Topics must be of the form "user:<auth.uid()>" so each user only receives their own row events.
-- Application code must subscribe to channels named exactly "user:" || user.id.

DROP POLICY IF EXISTS "Users can subscribe to own realtime topic" ON realtime.messages;

CREATE POLICY "Users can subscribe to own realtime topic"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() = 'user:' || auth.uid()::text
  );

-- 2. Lock down autotrade_log: block all client writes (the edge function uses the
-- service role to insert, so no client INSERT/UPDATE/DELETE should ever succeed).
-- This preserves the audit trail — users cannot erase their trading history.

CREATE POLICY "Block client inserts on autotrade_log"
  ON public.autotrade_log
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "Block client updates on autotrade_log"
  ON public.autotrade_log
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "Block client deletes on autotrade_log"
  ON public.autotrade_log
  FOR DELETE
  TO authenticated
  USING (false);

-- 3. news_sentiment_cache has RLS enabled but no policies → effectively locked
-- to the service role only, which is correct (it's a server-side cache). Add an
-- explicit deny-all SELECT policy so the linter recognizes it as intentional.

CREATE POLICY "Block client reads on news_sentiment_cache"
  ON public.news_sentiment_cache
  FOR SELECT
  TO authenticated, anon
  USING (false);
