
-- Allow AUTO_ADD / AUTO_REMOVE in autotrade_log.action
ALTER TABLE public.autotrade_log
  DROP CONSTRAINT IF EXISTS autotrade_log_action_check;

ALTER TABLE public.autotrade_log
  ADD CONSTRAINT autotrade_log_action_check
  CHECK (action IN (
    'ENTRY','PARTIAL_EXIT','FULL_EXIT','HOLD','BLOCKED','ERROR',
    'AUTO_ADD','AUTO_REMOVE'
  ));
