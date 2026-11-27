-- Home exercises left by a therapist. Mirrors the paper handout: a plan (who set it, any precautions, photos of the
-- original sheet), the exercises on it, and a tick sheet with an AM and a PM box per exercise per day. When an
-- exercise isn't done, a reason is recorded, which the paper sheet has no room for.
--
-- Deliberately separate from task_log (a plain per-day tick-list with no reason) and from visits (the therapist's own
-- schedule). Strovia only records what the therapist prescribed; it never suggests, changes or judges an exercise.
--
-- Rules reuse the rest of the app:
--   * anyone who can see the patient can read; admin, assigned caregiver and assigned relative can write
--   * an off-shift caregiver can't tick an exercise (same trigger as readings, medication and tasks, migration 041);
--     undoing is always open
--   * exercises are retired (active = false), never deleted, so the history in past weeks' summaries stays intact

-- 1. Plans -----------------------------------------------------------------------------------------------
create table if not exists exercise_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  discipline text not null check (discipline in ('Physical therapy', 'Occupational therapy', 'Speech-language therapy', 'Swallowing', 'Cognitive', 'Other')),
  therapist_name text check (therapist_name is null or char_length(therapist_name) <= 80),
  title text check (title is null or char_length(title) <= 120),
  precautions text check (precautions is null or char_length(precautions) <= 600),
  sheet_paths text[] not null default '{}' check (cardinality(sheet_paths) <= 10),
  active boolean not null default true,
  starts_on date not null default current_date,
  ended_on date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists exercise_plans_patient_idx on exercise_plans (patient_id);

-- 2. Exercises on a plan ---------------------------------------------------------------------------------
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references exercise_plans(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  detail text check (detail is null or char_length(detail) <= 400),
  slots text[] not null default '{am,pm}' check (slots <@ array['am', 'pm']::text[] and cardinality(slots) >= 1),
  weekdays smallint[] not null default '{0,1,2,3,4,5,6}' check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(weekdays) >= 1),
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists exercises_patient_idx on exercises (patient_id);
create index if not exists exercises_plan_idx on exercises (plan_id);

-- 3. The tick sheet --------------------------------------------------------------------------------------
create table if not exists exercise_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete cascade,
  log_date date not null,
  slot text not null check (slot in ('am', 'pm')),
  status text not null check (status in ('done', 'partly', 'not_done')),
  reason text check (reason in ('tired', 'unwell', 'pain', 'dizzy', 'mood', 'out', 'no_caregiver', 'forgot', 'other')),
  note text check (note is null or char_length(note) <= 300),
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz not null default now(),
  unique (exercise_id, log_date, slot),
  constraint exercise_log_reason_needed check (status <> 'not_done' or reason is not null)
);
create index if not exists exercise_log_idx on exercise_log (patient_id, log_date);

-- 4. Who can do what -------------------------------------------------------------------------------------
alter table exercise_plans enable row level security;
alter table exercises enable row level security;
alter table exercise_log enable row level security;
revoke all on exercise_plans, exercises, exercise_log from anon;

drop policy if exists "view exercise plans" on exercise_plans;
create policy "view exercise plans" on exercise_plans for select using (can_view_patient(patient_id));
drop policy if exists "add exercise plans" on exercise_plans;
create policy "add exercise plans" on exercise_plans for insert with check (can_edit_patient(patient_id) and created_by = auth.uid());
drop policy if exists "change exercise plans" on exercise_plans;
create policy "change exercise plans" on exercise_plans for update using (can_edit_patient(patient_id)) with check (can_edit_patient(patient_id));
drop policy if exists "remove exercise plans" on exercise_plans;
create policy "remove exercise plans" on exercise_plans for delete using (is_admin());

drop policy if exists "view exercises" on exercises;
create policy "view exercises" on exercises for select using (can_view_patient(patient_id));
drop policy if exists "add exercises" on exercises;
create policy "add exercises" on exercises for insert with check (can_edit_patient(patient_id));
drop policy if exists "change exercises" on exercises;
create policy "change exercises" on exercises for update using (can_edit_patient(patient_id)) with check (can_edit_patient(patient_id));
drop policy if exists "remove exercises" on exercises;
create policy "remove exercises" on exercises for delete using (is_admin());

drop policy if exists "view exercise log" on exercise_log;
create policy "view exercise log" on exercise_log for select using (can_view_patient(patient_id));
drop policy if exists "tick exercises" on exercise_log;
create policy "tick exercises" on exercise_log for insert with check (can_edit_patient(patient_id) and done_by = auth.uid());
drop policy if exists "change own exercise ticks" on exercise_log;
create policy "change own exercise ticks" on exercise_log for update
  using (is_admin() or (done_by = auth.uid() and can_edit_patient(patient_id)))
  with check (is_admin() or (done_by = auth.uid() and can_edit_patient(patient_id)));
drop policy if exists "untick exercises" on exercise_log;
create policy "untick exercises" on exercise_log for delete using (is_admin() or (done_by = auth.uid() and can_edit_patient(patient_id)));

-- 5. Integrity checks ------------------------------------------------------------------------------------
-- An exercise belongs to its plan's patient, and a tick belongs to its exercise's patient: without this, someone
-- assigned to one patient could write rows against another patient's exercise by naming that exercise's id.
create or replace function trg_exercise_same_patient() returns trigger
language plpgsql set search_path = public as $$
declare
  owner_patient uuid;
begin
  if tg_table_name = 'exercises' then
    select patient_id into owner_patient from exercise_plans where id = new.plan_id;
  else
    select patient_id into owner_patient from exercises where id = new.exercise_id;
  end if;
  if owner_patient is null or owner_patient <> new.patient_id then
    raise exception 'That exercise belongs to a different patient.';
  end if;
  return new;
end;
$$;
drop trigger if exists exercises_same_patient on exercises;
create trigger exercises_same_patient before insert or update on exercises for each row execute function trg_exercise_same_patient();
drop trigger if exists exercise_log_same_patient on exercise_log;
create trigger exercise_log_same_patient before insert on exercise_log for each row execute function trg_exercise_same_patient();

-- A tick can only be recorded for around today (the app uses each person's own local date), like daily tasks.
create or replace function trg_check_exercise_date() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.log_date not between current_date - 1 and current_date + 1 then
    raise exception 'Exercises can only be recorded for today.';
  end if;
  return new;
end;
$$;
drop trigger if exists check_exercise_date on exercise_log;
create trigger check_exercise_date before insert on exercise_log for each row execute function trg_check_exercise_date();

-- Same shift rule as readings, medication and tasks (migration 041). Only inserts are gated; undoing is always open.
drop trigger if exists check_shift_for_exercise_log on exercise_log;
create trigger check_shift_for_exercise_log before insert on exercise_log for each row execute function trg_check_shift_for_care_action();

-- 6. Photos of the therapist's sheet ---------------------------------------------------------------------
-- A private bucket; each file lives under a folder named for its patient, so the same view/edit rules apply.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-sheets', 'exercise-sheets', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "view exercise sheets" on storage.objects;
create policy "view exercise sheets" on storage.objects for select using (
  bucket_id = 'exercise-sheets'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then can_view_patient(((storage.foldername(name))[1])::uuid) else false end
);
drop policy if exists "add exercise sheets" on storage.objects;
create policy "add exercise sheets" on storage.objects for insert with check (
  bucket_id = 'exercise-sheets'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then can_edit_patient(((storage.foldername(name))[1])::uuid) else false end
);
drop policy if exists "remove exercise sheets" on storage.objects;
create policy "remove exercise sheets" on storage.objects for delete using (
  bucket_id = 'exercise-sheets'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then can_edit_patient(((storage.foldername(name))[1])::uuid) else false end
);
