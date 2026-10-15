CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  ticker text,
  link text,
  digest_key text,
  digest_count integer NOT NULL DEFAULT 1,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE UNIQUE INDEX uniq_notifications_digest ON public.notifications(user_id, digest_key) WHERE digest_key IS NOT NULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

CREATE OR REPLACE FUNCTION public.notify_user(_user uuid, _category text, _kind text, _title text, _body text, _ticker text, _link text, _digest text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _digest IS NULL THEN
    INSERT INTO public.notifications(user_id, category, kind, title, body, ticker, link)
    VALUES (_user, _category, _kind, _title, _body, _ticker, _link);
  ELSE
    INSERT INTO public.notifications(user_id, category, kind, title, body, ticker, link, digest_key)
    VALUES (_user, _category, _kind, _title, _body, _ticker, _link, _digest)
    ON CONFLICT (user_id, digest_key) WHERE digest_key IS NOT NULL
    DO UPDATE SET digest_count = notifications.digest_count + 1,
      title = EXCLUDED.title, body = EXCLUDED.body, read_at = NULL, updated_at = now();
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.notify_user(uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_notify_autotrade_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE px text := CASE WHEN NEW.price IS NULL THEN '' ELSE ' at $' || round(NEW.price::numeric, 2) END;
BEGIN
  IF NEW.action = 'ENTRY' THEN
    PERFORM notify_user(NEW.user_id, 'trades', 'buy', 'Bought ' || COALESCE(NEW.shares::int::text,'') || ' ' || NEW.ticker || px, NEW.reason, NEW.ticker, '/stock/' || NEW.ticker);
  ELSIF NEW.action IN ('FULL_EXIT','EXIT') THEN
    PERFORM notify_user(NEW.user_id, 'trades', 'sell', 'Sold ' || NEW.ticker || px || COALESCE(' (' || round(NEW.pnl_pct*100,1) || '%)',''), NEW.reason, NEW.ticker, '/stock/' || NEW.ticker);
  ELSIF NEW.action = 'PARTIAL_EXIT' THEN
    PERFORM notify_user(NEW.user_id, 'trades', 'trim', 'Trimmed ' || COALESCE(NEW.shares::int::text,'') || ' ' || NEW.ticker || px, NEW.reason, NEW.ticker, '/stock/' || NEW.ticker);
  ELSIF NEW.action = 'BLOCKED' THEN
    PERFORM notify_user(NEW.user_id, 'skipped', 'blocked', 'Skipped ' || NEW.ticker, NEW.reason, NEW.ticker, '/autotrader-log');
  ELSIF NEW.action = 'AUTO_ADD' THEN
    PERFORM notify_user(NEW.user_id, 'watchlist', 'auto_add', NEW.ticker || ' added to your watchlist', NEW.reason, NEW.ticker, '/watchlist');
  ELSIF NEW.action = 'HOLD' THEN
    PERFORM notify_user(NEW.user_id, 'activity', 'scan', 'Autotrader checked your positions', 'Latest: ' || NEW.ticker || ' held — ' || COALESCE(left(NEW.reason, 140),''), NULL, '/autotrader-log',
      'hold-' || to_char(date_trunc('hour', NEW.created_at), 'YYYYMMDDHH24'));
  ELSE
    PERFORM notify_user(NEW.user_id, 'activity', lower(NEW.action), NEW.action || ' ' || NEW.ticker, NEW.reason, NEW.ticker, '/autotrader-log');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER notify_autotrade_log AFTER INSERT ON public.autotrade_log FOR EACH ROW EXECUTE FUNCTION public.trg_notify_autotrade_log();

CREATE OR REPLACE FUNCTION public.trg_notify_price_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_user(NEW.user_id, 'alerts', 'alert_created', 'Price alert set: ' || NEW.ticker || ' ' || NEW.direction || ' $' || round(NEW.target_price,2), NULL, NEW.ticker, '/stock/' || NEW.ticker);
  ELSIF COALESCE(NEW.is_triggered,false) AND NOT COALESCE(OLD.is_triggered,false) THEN
    PERFORM notify_user(NEW.user_id, 'alerts', 'price_alert', NEW.ticker || ' crossed ' || NEW.direction || ' $' || round(NEW.target_price,2), NULL, NEW.ticker, '/stock/' || NEW.ticker);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER notify_price_alert AFTER INSERT OR UPDATE ON public.price_alerts FOR EACH ROW EXECUTE FUNCTION public.trg_notify_price_alert();

CREATE OR REPLACE FUNCTION public.trg_notify_sell_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reason NOT LIKE '🤖 AutoTrader closed:%' THEN
    PERFORM notify_user(NEW.user_id, 'alerts', 'exit_signal', 'Exit signal: ' || NEW.ticker, NEW.reason, NEW.ticker, '/stock/' || NEW.ticker);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER notify_sell_alert AFTER INSERT ON public.sell_alerts FOR EACH ROW EXECUTE FUNCTION public.trg_notify_sell_alert();

CREATE OR REPLACE FUNCTION public.trg_notify_watchlist() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.source <> 'auto' THEN
    PERFORM notify_user(NEW.user_id, 'watchlist', 'added', NEW.ticker || ' added to your watchlist', NULL, NEW.ticker, '/watchlist');
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM notify_user(OLD.user_id, 'watchlist', 'removed', OLD.ticker || ' removed from your watchlist', NULL, OLD.ticker, '/watchlist');
  END IF;
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER notify_watchlist AFTER INSERT OR DELETE ON public.watchlist FOR EACH ROW EXECUTE FUNCTION public.trg_notify_watchlist();

CREATE OR REPLACE FUNCTION public.trg_notify_risk_params() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify_user(NEW.user_id, 'system', 'risk_update', 'Adaptive limits recalculated', COALESCE(NEW.reasons->>0, 'Based on ' || NEW.sample_size || ' closed trades'), NULL, '/settings');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER notify_risk_params AFTER INSERT OR UPDATE ON public.adaptive_risk_params FOR EACH ROW EXECUTE FUNCTION public.trg_notify_risk_params();

CREATE OR REPLACE FUNCTION public.trg_notify_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.enabled IS DISTINCT FROM OLD.enabled THEN
    PERFORM notify_user(NEW.user_id, 'system', 'autotrader', 'Autotrader ' || CASE WHEN NEW.enabled THEN 'turned on' ELSE 'turned off' END, NULL, NULL, '/settings');
  END IF;
  IF NEW.kill_switch IS DISTINCT FROM OLD.kill_switch THEN
    PERFORM notify_user(NEW.user_id, 'system', 'kill_switch', 'Kill switch ' || CASE WHEN NEW.kill_switch THEN 'activated' ELSE 'released' END, NULL, NULL, '/settings');
  END IF;
  IF NEW.risk_profile IS DISTINCT FROM OLD.risk_profile THEN
    PERFORM notify_user(NEW.user_id, 'system', 'risk_profile', 'Risk profile changed to ' || NEW.risk_profile, NULL, NULL, '/settings');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER notify_settings AFTER UPDATE ON public.autotrade_settings FOR EACH ROW EXECUTE FUNCTION public.trg_notify_settings();

CREATE OR REPLACE FUNCTION public.trg_notify_subscription() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM notify_user(NEW.user_id, 'system', 'billing', 'Subscription ' || NEW.status, NULL, NULL, '/settings');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER notify_subscription AFTER INSERT OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.trg_notify_subscription();

-- Seed with the last 7 days of meaningful activity.
INSERT INTO public.notifications(user_id, category, kind, title, body, ticker, link, created_at, read_at)
SELECT user_id,
  CASE WHEN action IN ('ENTRY','FULL_EXIT','PARTIAL_EXIT') THEN 'trades' WHEN action='AUTO_ADD' THEN 'watchlist' ELSE 'skipped' END,
  lower(action),
  CASE action WHEN 'ENTRY' THEN 'Bought ' WHEN 'FULL_EXIT' THEN 'Sold ' WHEN 'PARTIAL_EXIT' THEN 'Trimmed ' WHEN 'AUTO_ADD' THEN 'Watchlist added ' ELSE 'Skipped ' END || ticker,
  reason, ticker, '/stock/' || ticker, created_at, now()
FROM public.autotrade_log WHERE action <> 'HOLD' AND created_at > now() - interval '7 days';