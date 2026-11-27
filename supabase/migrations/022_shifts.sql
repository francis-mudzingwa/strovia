-- Shifts: the administrator assigns a caregiver to a patient for set hours. A caregiver can READ their own
-- shifts and nothing else: only the administrator can create, change or delete one. This is enforced by
-- row-level security in the database, so it holds even if someone bypasses the app.

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  caregiver_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint check (weekday between 0 and 6),   -- 0 = Sunday ... 6 = Saturday. Set for a weekly shift
  on_date date,                                        -- Set for a one-day shift
  start_time time not null,
  end_time time not null,                              -- Not later than start_time means the shift ends the next day
  starts_on date not null default current_date,        -- Weekly shifts: first day it applies
  ends_on date,                                        -- Weekly shifts: last day (empty = repeats until removed)
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((weekday is not null) <> (on_date is not null)),
  check (start_time <> end_time),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists shifts_caregiver_idx on shifts (caregiver_id);
create index if not exists shifts_patient_idx on shifts (patient_id);

alter table shifts enable row level security;
revoke all on shifts from anon;

create or replace function is_approved_caregiver()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'caregiver' and approved from staff_accounts where user_id = auth.uid()), false)
$$;

drop policy if exists "read shifts" on shifts;
create policy "read shifts" on shifts for select
  using (is_admin() or (caregiver_id = auth.uid() and is_approved_caregiver()));
drop policy if exists "admin adds shifts" on shifts;
create policy "admin adds shifts" on shifts for insert with check (is_admin());
drop policy if exists "admin changes shifts" on shifts;
create policy "admin changes shifts" on shifts for update using (is_admin()) with check (is_admin());
drop policy if exists "admin removes shifts" on shifts;
create policy "admin removes shifts" on shifts for delete using (is_admin());

-- The stretches of time a shift covers between two days (wall-clock time, no time zone).
create or replace function shift_windows(s shifts, from_day date, to_day date)
returns table (win_start timestamp, win_end timestamp)
language sql immutable as $$
  select d::date + s.start_time,
         d::date + s.start_time + case when s.end_time > s.start_time then s.end_time - s.start_time
                                       else s.end_time - s.start_time + interval '24 hours' end
  from generate_series(from_day, to_day, interval '1 day') d
  where (s.weekday is not null and extract(dow from d)::int = s.weekday
         and d::date >= s.starts_on and (s.ends_on is null or d::date <= s.ends_on))
     or (s.on_date is not null and d::date = s.on_date)
$$;

create or replace function describe_shift(s shifts)
returns text language sql immutable as $$
  select case when s.weekday is not null
           then 'every ' || (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[s.weekday + 1]
           else to_char(s.on_date, 'FMDay, FMMon FMDD, YYYY') end
         || ', ' || to_char(s.start_time, 'FMHH12:MI AM') || ' to ' || to_char(s.end_time, 'FMHH12:MI AM')
$$;

-- Rules every shift must meet, whoever tries to save it.
create or replace function trg_check_shift() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  clash shifts;
begin
  if not exists (select 1 from staff_accounts where user_id = new.caregiver_id and role = 'caregiver' and approved) then
    raise exception 'Shifts can only be given to approved caregivers.';
  end if;
  if not exists (select 1 from patient_assignments where patient_id = new.patient_id and user_id = new.caregiver_id) then
    raise exception 'This caregiver is not assigned to this patient yet. Give them access first (Manage Accounts, Patients).';
  end if;
  -- A caregiver cannot be in two places at once: no overlap with their other shifts in the next 12 weeks.
  select * into clash
  from shifts o
  where o.caregiver_id = new.caregiver_id and o.id <> new.id
    and exists (
      select 1
      from shift_windows(new, current_date - 1, current_date + 84) a,
           shift_windows(o, current_date - 1, current_date + 84) b
      where a.win_start < b.win_end and b.win_start < a.win_end)
  limit 1;
  if found then
    raise exception 'This caregiver already has an overlapping shift: % for %.',
      describe_shift(clash), (select full_name from patients where id = clash.patient_id);
  end if;
  return new;
end;
$$;
drop trigger if exists check_shift on shifts;
create trigger check_shift before insert or update on shifts for each row execute function trg_check_shift();

-- Every change to a shift goes into the administrator's audit trail.
create or replace function trg_log_shift() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s shifts;
  who text;
begin
  s := case when tg_op = 'DELETE' then old else new end;
  select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') into who
    from staff_accounts where user_id = s.caregiver_id;
  perform log_activity(
    s.patient_id,
    case tg_op when 'INSERT' then 'assigned a shift' when 'UPDATE' then 'changed a shift' else 'removed a shift' end,
    coalesce(who, 'A caregiver') || ': ' || describe_shift(s) || coalesce('. Note: ' || nullif(s.notes, ''), '')
  );
  return s;
end;
$$;
drop trigger if exists log_shift on shifts;
create trigger log_shift after insert or update or delete on shifts for each row execute function trg_log_shift();

-- If a caregiver loses access to a patient, their shifts for that patient go with it.
create or replace function trg_remove_shifts_on_unassign() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from shifts where patient_id = old.patient_id and caregiver_id = old.user_id;
  return old;
end;
$$;
drop trigger if exists remove_shifts_on_unassign on patient_assignments;
create trigger remove_shifts_on_unassign after delete on patient_assignments for each row execute function trg_remove_shifts_on_unassign();
