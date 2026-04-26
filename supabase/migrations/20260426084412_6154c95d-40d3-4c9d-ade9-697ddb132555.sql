-- Heartbeat table for cron / scheduled edge functions
create table if not exists public.cron_heartbeat (
  job_name text primary key,
  last_run_at timestamptz not null default now(),
  duration_ms integer,
  status text not null default 'ok',
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.cron_heartbeat enable row level security;

-- Any authenticated user can read heartbeat status (single-tenant ops view).
create policy "Authenticated users can view cron heartbeats"
  on public.cron_heartbeat
  for select
  to authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies → only service role can write.

create trigger update_cron_heartbeat_updated_at
  before update on public.cron_heartbeat
  for each row
  execute function public.update_updated_at_column();