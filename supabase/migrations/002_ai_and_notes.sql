alter table checkins add column if not exists notes text;

create table if not exists ai_insights (
  user_id uuid primary key references auth.users(id),
  explanation text,
  mobility_progress text,
  speech_progress text,
  cognitive_progress text,
  adl_progress text,
  recovery_level text,
  trend text,
  updated_at timestamptz default now()
);

alter table ai_insights enable row level security;

create policy "own ai insights" on ai_insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
