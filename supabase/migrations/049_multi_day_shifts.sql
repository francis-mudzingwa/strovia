-- Live-in shifts: a shift can now run for several days, for example from 8:00 AM Monday to 8:00 AM Wednesday.
--
-- Until now a shift was a start time and an end time, and an end time that was not later than the start meant "the
-- next day", so a shift could never be longer than one night and 8:00 AM to 8:00 AM was refused. The new column says
-- how many days after the start day the shift ends. Empty (every existing shift) keeps the old rule, so nothing that is
-- already saved changes. The overlap check, "is this caregiver on shift right now" and the family schedule all use it.

alter table shifts add column if not exists ends_after_days smallint check (ends_after_days between 0 and 14);

-- The old rule that the two times must differ. What matters now is that the shift lasts for some time.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.shifts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%start_time <> end_time%'
  loop
    execute format('alter table shifts drop constraint %I', c.conname);
  end loop;
end
$$;
alter table shifts drop constraint if exists shifts_positive_length;
alter table shifts add constraint shifts_positive_length check (
  coalesce(ends_after_days, case when end_time <= start_time then 1 else 0 end) * 1440
  + (extract(epoch from end_time) - extract(epoch from start_time)) / 60 > 0
);

-- The stretches of time a shift covers (wall-clock time, no time zone). Same result as before for existing shifts.
create or replace function shift_windows(s shifts, from_day date, to_day date)
returns table (win_start timestamp, win_end timestamp)
language sql immutable as $$
  select d::date + s.start_time,
         (d::date + coalesce(s.ends_after_days, case when s.end_time <= s.start_time then 1 else 0 end)) + s.end_time
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
         || case when coalesce(s.ends_after_days, 0) >= 2 then ' (' || s.ends_after_days || ' days later)' else '' end
$$;

-- The caregiver cannot be in two places at once. A long shift that began days ago can still overlap a new one, so the
-- check now looks back far enough (the longest possible shift is 14 days later) to see it.
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
  select * into clash
  from shifts o
  where o.caregiver_id = new.caregiver_id and o.id <> new.id
    and exists (
      select 1
      from shift_windows(new, current_date - 15, current_date + 84) a,
           shift_windows(o, current_date - 15, current_date + 84) b
      where a.win_start < b.win_end and b.win_start < a.win_end)
  limit 1;
  if found then
    raise exception 'This caregiver already has an overlapping shift: % for %.',
      describe_shift(clash), (select full_name from patients where id = clash.patient_id);
  end if;
  return new;
end;
$$;

-- Is this caregiver on shift for this patient right now (Eastern Time, with the same 30 minutes either side)? Used by
-- the check-in, reading, medication and task rules. It now looks back over the days a long shift can span.
create or replace function caregiver_on_shift(p_patient uuid, p_caregiver uuid default auth.uid())
returns boolean
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  grace interval := interval '30 minutes';
  has_any_shift boolean;
  now_ts timestamptz := now();
  eastern_today date := (now_ts at time zone 'America/New_York')::date;
  candidate_date date;
  back int;
  s record;
  offset_days int;
  occ_start timestamptz;
  occ_end timestamptz;
begin
  if p_caregiver is null then
    return false;
  end if;

  -- An open clock-in always counts, regardless of the schedule (covering an unscheduled or swapped shift).
  if exists (
    select 1 from shift_attendance
    where patient_id = p_patient and caregiver_id = p_caregiver and left_at is null
      and arrived_at > now_ts - interval '20 hours'
  ) then
    return true;
  end if;

  select exists (select 1 from shifts where patient_id = p_patient and caregiver_id = p_caregiver) into has_any_shift;
  if not has_any_shift then
    return true;
  end if;

  for back in 0..15
  loop
    candidate_date := eastern_today - back;
    for s in
      select * from shifts
      where patient_id = p_patient and caregiver_id = p_caregiver
        and (
          (weekday is not null and weekday = extract(dow from candidate_date)::int
             and starts_on <= candidate_date and (ends_on is null or ends_on >= candidate_date))
          or (on_date = candidate_date)
        )
    loop
      offset_days := coalesce(s.ends_after_days, case when s.end_time <= s.start_time then 1 else 0 end);
      -- A shift that started `back` days ago only matters if it is long enough to still be running.
      continue when back > offset_days;
      occ_start := (candidate_date::text || ' ' || s.start_time::text)::timestamp at time zone 'America/New_York';
      occ_end := ((candidate_date + offset_days)::text || ' ' || s.end_time::text)::timestamp at time zone 'America/New_York';
      if now_ts between (occ_start - grace) and (occ_end + grace) then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$function$;

-- The schedule family members and the administrator can read now includes how long each shift runs.
drop function if exists patient_shift_schedule(uuid);
create function patient_shift_schedule(p_patient uuid)
returns table (id uuid, caregiver_id uuid, weekday smallint, on_date date, start_time time, end_time time, starts_on date, ends_on date, ends_after_days smallint)
language sql stable security definer set search_path = public as $$
  select s.id, s.caregiver_id, s.weekday, s.on_date, s.start_time, s.end_time, s.starts_on, s.ends_on, s.ends_after_days
  from shifts s
  where s.patient_id = p_patient and (is_admin() or is_family_of(p_patient))
$$;
revoke execute on function patient_shift_schedule(uuid) from public, anon;
grant execute on function patient_shift_schedule(uuid) to authenticated;
