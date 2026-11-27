-- Tools for the people doing the caring (caregivers and family proxies alike, they can do the same things):
--  * every saved version of a check-in is kept, so one person can never silently overwrite another's
--  * readings (blood pressure, pulse, blood sugar, weight) and a daily task tick-list
--  * notes come in three kinds: a wellbeing note, a shift handover, or a question for the care team
--  * incident reports (falls, missed medicine, ...)
--  * a caregiver can tell the team they have arrived for, and left, a shift
--  * family proxies can see who is looking after their relative and when (without the private shift notes)
--  * someone can be named as taking the patient to an appointment
-- Everything is limited by the same rules as before: you only reach a patient you are assigned to.

create or replace function is_family_of(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from patient_assignments pa
    join staff_accounts s on s.user_id = pa.user_id
    join patients x on x.id = pa.patient_id
    where pa.patient_id = p and pa.user_id = auth.uid() and s.role = 'relative' and s.approved and x.archived_at is null
  )
$$;

-- 1. Check-in history ------------------------------------------------------------------------------------
create table if not exists checkin_versions (
  id bigserial primary key,
  patient_id uuid not null references patients(id) on delete cascade,
  entry_date date not null,
  symptoms jsonb not null,
  feeling int,
  notes text,
  onset_note text,
  recorded_by uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default now()
);
create index if not exists checkin_versions_idx on checkin_versions (patient_id, entry_date, saved_at);
alter table checkin_versions enable row level security;
revoke all on checkin_versions from anon;
drop policy if exists "view checkin versions" on checkin_versions;
create policy "view checkin versions" on checkin_versions for select using (can_view_patient(patient_id));

create or replace function trg_keep_checkin_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into checkin_versions (patient_id, entry_date, symptoms, feeling, notes, onset_note, recorded_by, saved_at)
  values (new.patient_id, new.entry_date, new.symptoms, new.feeling, new.notes, new.onset_note, new.recorded_by, coalesce(new.updated_at, now()));
  return new;
end;
$$;
drop trigger if exists keep_checkin_version on checkins;
create trigger keep_checkin_version after insert or update on checkins for each row execute function trg_keep_checkin_version();

insert into checkin_versions (patient_id, entry_date, symptoms, feeling, notes, onset_note, recorded_by, saved_at)
select c.patient_id, c.entry_date, c.symptoms, c.feeling, c.notes, c.onset_note, c.recorded_by, coalesce(c.updated_at, c.created_at)
from checkins c
where not exists (select 1 from checkin_versions v where v.patient_id = c.patient_id and v.entry_date = c.entry_date);

-- 2. Readings --------------------------------------------------------------------------------------------
create table if not exists vitals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  taken_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  systolic int check (systolic between 40 and 300),
  diastolic int check (diastolic between 20 and 200),
  pulse int check (pulse between 20 and 250),
  glucose numeric(6,1) check (glucose between 10 and 1000),   -- mg/dL
  weight_lb numeric(5,1) check (weight_lb between 20 and 700),
  note text check (char_length(coalesce(note, '')) <= 300),
  created_at timestamptz not null default now(),
  check ((systolic is null) = (diastolic is null)),
  check (systolic is not null or pulse is not null or glucose is not null or weight_lb is not null)
);
create index if not exists vitals_patient_idx on vitals (patient_id, taken_at desc);
alter table vitals enable row level security;
revoke all on vitals from anon;
drop policy if exists "view vitals" on vitals;
create policy "view vitals" on vitals for select using (can_view_patient(patient_id));
drop policy if exists "record vitals" on vitals;
create policy "record vitals" on vitals for insert with check (can_edit_patient(patient_id) and recorded_by = auth.uid());
drop policy if exists "admin deletes vitals" on vitals;
create policy "admin deletes vitals" on vitals for delete using (is_admin());

create or replace function trg_log_vitals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parts text[] := '{}';
begin
  if new.systolic is not null then parts := array_append(parts, 'blood pressure ' || new.systolic || '/' || new.diastolic); end if;
  if new.pulse is not null then parts := array_append(parts, 'pulse ' || new.pulse); end if;
  if new.glucose is not null then parts := array_append(parts, 'blood sugar ' || new.glucose || ' mg/dL'); end if;
  if new.weight_lb is not null then parts := array_append(parts, 'weight ' || new.weight_lb || ' lb'); end if;
  perform log_activity(new.patient_id, 'recorded a reading', array_to_string(parts, ', '));
  return new;
end;
$$;
drop trigger if exists log_vitals on vitals;
create trigger log_vitals after insert on vitals for each row execute function trg_log_vitals();

-- 3. Daily tasks -----------------------------------------------------------------------------------------
create table if not exists task_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  task_date date not null,
  task text not null check (char_length(task) between 1 and 120),
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz not null default now(),
  unique (patient_id, task_date, task)
);
create index if not exists task_log_idx on task_log (patient_id, task_date);
alter table task_log enable row level security;
revoke all on task_log from anon;
drop policy if exists "view tasks" on task_log;
create policy "view tasks" on task_log for select using (can_view_patient(patient_id));
drop policy if exists "tick tasks" on task_log;
create policy "tick tasks" on task_log for insert with check (can_edit_patient(patient_id) and done_by = auth.uid());
drop policy if exists "untick tasks" on task_log;
create policy "untick tasks" on task_log for delete using (is_admin() or (done_by = auth.uid() and can_edit_patient(patient_id)));

-- A task can only be ticked for around today (the app uses each person's own local date).
create or replace function trg_check_task() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.task_date not between current_date - 1 and current_date + 1 then
    raise exception 'Tasks can only be ticked for today.';
  end if;
  return new;
end;
$$;
drop trigger if exists check_task on task_log;
create trigger check_task before insert on task_log for each row execute function trg_check_task();

-- 4. Three kinds of note ---------------------------------------------------------------------------------
alter table patient_notes add column if not exists kind text not null default 'note';
alter table patient_notes drop constraint if exists patient_notes_kind_check;
alter table patient_notes add constraint patient_notes_kind_check check (kind in ('note', 'handover', 'question'));
alter table patient_notes add column if not exists answered_at timestamptz;
alter table patient_notes add column if not exists answered_by uuid references auth.users(id) on delete set null;
create index if not exists patient_notes_kind_idx on patient_notes (patient_id, kind, created_at desc);

create or replace function trg_log_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_activity(
    new.patient_id,
    case new.kind when 'handover' then 'wrote a shift handover' when 'question' then 'asked the care team a question' else 'wrote a wellbeing note' end,
    new.note
  );
  return new;
end;
$$;

-- Anyone caring for the patient (or the administrator) can mark a question as answered.
create or replace function answer_question(p_note uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  n patient_notes%rowtype;
begin
  select * into n from patient_notes where id = p_note and kind = 'question';
  if not found then
    raise exception 'That question was not found.';
  end if;
  if not can_edit_patient(n.patient_id) then
    raise exception 'You cannot answer questions for this patient.';
  end if;
  update patient_notes set answered_at = now(), answered_by = auth.uid() where id = p_note and answered_at is null;
  perform log_activity(n.patient_id, 'marked a question as answered', left(n.note, 120));
end;
$$;
revoke execute on function answer_question(uuid) from public, anon;
grant execute on function answer_question(uuid) to authenticated;

-- 5. Incident reports ------------------------------------------------------------------------------------
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  kind text not null check (kind in ('fall', 'missed medicine', 'refused medicine', 'choking or coughing at meals', 'skin problem', 'other')),
  happened_at timestamptz not null default now(),
  injury boolean not null default false,
  details text check (char_length(coalesce(details, '')) <= 1000),
  action_taken text check (char_length(coalesce(action_taken, '')) <= 1000),
  reported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists incidents_patient_idx on incidents (patient_id, happened_at desc);
alter table incidents enable row level security;
revoke all on incidents from anon;
drop policy if exists "view incidents" on incidents;
create policy "view incidents" on incidents for select using (can_view_patient(patient_id));
drop policy if exists "report incidents" on incidents;
create policy "report incidents" on incidents for insert with check (can_edit_patient(patient_id) and reported_by = auth.uid());
drop policy if exists "admin deletes incidents" on incidents;
create policy "admin deletes incidents" on incidents for delete using (is_admin());

create or replace function trg_log_incident() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_activity(new.patient_id, 'reported an incident',
    initcap(new.kind) || case when new.injury then ' (with injury)' else '' end
    || coalesce('. ' || nullif(trim(new.details), ''), '') || coalesce('. Action: ' || nullif(trim(new.action_taken), ''), ''));
  return new;
end;
$$;
drop trigger if exists log_incident on incidents;
create trigger log_incident after insert on incidents for each row execute function trg_log_incident();

-- 6. Arriving for and leaving a shift --------------------------------------------------------------------
create table if not exists shift_attendance (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  caregiver_id uuid not null references auth.users(id) on delete cascade,
  shift_id uuid references shifts(id) on delete set null,
  planned_start timestamptz,
  planned_end timestamptz,
  arrived_at timestamptz not null default now(),
  left_at timestamptz
);
create index if not exists shift_attendance_idx on shift_attendance (patient_id, arrived_at desc);
alter table shift_attendance enable row level security;
revoke all on shift_attendance from anon;
drop policy if exists "view attendance" on shift_attendance;
create policy "view attendance" on shift_attendance for select using (can_view_patient(patient_id));

create or replace function clock_in(p_patient uuid, p_shift uuid, p_start timestamptz, p_end timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  existing uuid;
  new_id uuid;
begin
  if auth.uid() is null or not is_approved_caregiver() then
    raise exception 'Only an approved caregiver can do this.';
  end if;
  if not can_edit_patient(p_patient) then
    raise exception 'You are not assigned to this patient.';
  end if;
  select id into existing from shift_attendance
    where patient_id = p_patient and caregiver_id = auth.uid() and left_at is null and arrived_at > now() - interval '24 hours'
    order by arrived_at desc limit 1;
  if existing is not null then
    return existing;
  end if;
  insert into shift_attendance (patient_id, caregiver_id, shift_id, planned_start, planned_end)
  values (p_patient, auth.uid(), p_shift, p_start, p_end) returning id into new_id;
  perform log_activity(p_patient, 'arrived for a shift', null);
  return new_id;
end;
$$;

create or replace function clock_out(p_attendance uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a shift_attendance%rowtype;
begin
  select * into a from shift_attendance where id = p_attendance and caregiver_id = auth.uid() and left_at is null;
  if not found then
    raise exception 'There is no shift to finish.';
  end if;
  update shift_attendance set left_at = now() where id = p_attendance;
  perform log_activity(a.patient_id, 'finished a shift', null);
end;
$$;
revoke execute on function clock_in(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function clock_out(uuid) from public, anon;
grant execute on function clock_in(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function clock_out(uuid) to authenticated;

-- 7. Family proxies can see who is caring for their relative, and when (not the private notes on a shift) -----
create or replace function patient_shift_schedule(p_patient uuid)
returns table (id uuid, caregiver_id uuid, weekday smallint, on_date date, start_time time, end_time time, starts_on date, ends_on date)
language sql stable security definer set search_path = public as $$
  select s.id, s.caregiver_id, s.weekday, s.on_date, s.start_time, s.end_time, s.starts_on, s.ends_on
  from shifts s
  where s.patient_id = p_patient and (is_admin() or is_family_of(p_patient))
$$;
revoke execute on function patient_shift_schedule(uuid) from public, anon;
grant execute on function patient_shift_schedule(uuid) to authenticated;

-- 8. Who is taking the patient to an appointment ------------------------------------------------------------
alter table appointments add column if not exists escort_id uuid references auth.users(id) on delete set null;
alter table appointments add column if not exists escort_note text check (char_length(coalesce(escort_note, '')) <= 200);
