create table if not exists public.quant_experiment_runs (
  id uuid primary key default gen_random_uuid(),
  experiment_id text not null unique,
  code_revision text not null,
  feature_set_version text not null,
  model_versions jsonb not null default '[]'::jsonb,
  dataset_snapshot text not null,
  universe_definition text not null,
  decision_lag_bars integer not null default 1 check (decision_lag_bars >= 0),
  cost_model_version text not null,
  random_seed bigint not null,
  train_window jsonb not null,
  validation_window jsonb not null,
  test_window jsonb not null,
  purge_bars integer not null default 0 check (purge_bars >= 0),
  embargo_bars integer not null default 0 check (embargo_bars >= 0),
  status text not null default 'created' check (status in ('created','running','frozen','passed','rejected','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

grant all on public.quant_experiment_runs to service_role;
alter table public.quant_experiment_runs enable row level security;

create table if not exists public.quant_decision_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  experiment_id text references public.quant_experiment_runs(experiment_id) on delete set null,
  intent_id text,
  signal_id text not null,
  ticker text not null,
  side text not null check (side in ('long','short')),
  sleeve text not null,
  mode text not null check (mode in ('shadow','paper','live','backtest')),
  decision_at timestamptz not null,
  generated_at timestamptz not null,
  model_version text not null,
  feature_set_version text not null,
  raw_score numeric,
  calibrated_probability numeric check (calibrated_probability is null or calibrated_probability between 0 and 1),
  expected_net_edge_pct numeric,
  proposed_notional numeric not null default 0 check (proposed_notional >= 0),
  approved_notional numeric not null default 0 check (approved_notional >= 0),
  approved_risk_pct numeric not null default 0 check (approved_risk_pct >= 0),
  allowed boolean not null,
  block_reasons jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on public.quant_decision_log to service_role;
alter table public.quant_decision_log enable row level security;

create index if not exists quant_decision_log_ticker_time_idx on public.quant_decision_log (ticker, decision_at desc);
create index if not exists quant_decision_log_signal_idx on public.quant_decision_log (signal_id);
create index if not exists quant_decision_log_experiment_idx on public.quant_decision_log (experiment_id);
create index if not exists quant_decision_log_user_time_idx on public.quant_decision_log (user_id, decision_at desc);

create table if not exists public.quant_counterfactual_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.quant_decision_log(id) on delete cascade,
  horizon_bars integer not null check (horizon_bars > 0),
  outcome_at timestamptz not null,
  gross_return_pct numeric,
  net_return_pct numeric,
  max_favorable_pct numeric,
  max_adverse_pct numeric,
  realized_cost_pct numeric,
  label text not null check (label in ('win','loss','flat','unresolved','invalid')),
  label_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (decision_id, horizon_bars, label_version)
);

grant all on public.quant_counterfactual_outcomes to service_role;
alter table public.quant_counterfactual_outcomes enable row level security;

create index if not exists quant_counterfactual_decision_idx on public.quant_counterfactual_outcomes (decision_id);
create index if not exists quant_counterfactual_outcome_time_idx on public.quant_counterfactual_outcomes (outcome_at desc);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_quant_experiment_runs_updated_at on public.quant_experiment_runs;
create trigger update_quant_experiment_runs_updated_at
  before update on public.quant_experiment_runs
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_quant_decision_log_updated_at on public.quant_decision_log;
create trigger update_quant_decision_log_updated_at
  before update on public.quant_decision_log
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_quant_counterfactual_outcomes_updated_at on public.quant_counterfactual_outcomes;
create trigger update_quant_counterfactual_outcomes_updated_at
  before update on public.quant_counterfactual_outcomes
  for each row execute function public.update_updated_at_column();