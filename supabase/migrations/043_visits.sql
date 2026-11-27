-- A recurring or one-off schedule for visiting professionals (a physical/occupational/speech therapist, a visiting
-- nurse, or anyone else who isn't a caregiver with a Strovia account) -- so a caregiver knows who's coming, when,
-- and for how long, without hunting through the care plan's free-text "services" description. Deliberately a
-- separate table from shifts: a visitor has no login, never checks in, and is never shift-gated -- this is pure
-- information, not a work assignment. Mirrors the shifts table's own recurring-vs-one-off shape closely enough that
-- shifts.js's pure schedule math (occurrences, describeShift, fmtTimeRange, etc.) works on visits unmodified.

create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  visitor_name text,
  visit_type text not null,
  weekday smallint,
  on_date date,
  start_time time not null,
  end_time time not null,
  starts_on date not null default current_date,
  ends_on date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint visits_has_a_day check ((weekday is not null) <> (on_date is not null)),
  constraint visits_weekday_check check (weekday between 0 and 6),
  constraint visits_time_check check (start_time <> end_time),
  constraint visits_dates_check check (ends_on is null or ends_on >= starts_on)
);
create index if not exists visits_patient_idx on visits (patient_id);

alter table visits enable row level security;

create policy "view visits" on visits for select using (can_view_patient(patient_id));
create policy "admin adds visits" on visits for insert with check (is_admin());
create policy "admin changes visits" on visits for update using (is_admin()) with check (is_admin());
create policy "admin removes visits" on visits for delete using (is_admin());
