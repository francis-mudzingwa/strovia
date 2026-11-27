-- A real, unbypassable version of the shift check-in rule added client-side earlier the same day: a caregiver may
-- only start today's first check-in for a patient while on shift for them (a stale cached page, or any other
-- client, can no longer get around it). Family proxies and administrators are never shift-bound. A caregiver who
-- has clocked in ("I've arrived") counts as on shift even outside the schedule. A caregiver/patient pair with no
-- shifts recorded at all is never blocked — shift tracking they haven't adopted must never stop them working.
--
-- Only the first save of the day is gated (a plain insert). Editing an already-saved check-in later is an
-- ON CONFLICT DO UPDATE, which this never touches, matching the client's own "view/edit is always open" rule.

create or replace function caregiver_on_shift(p_patient uuid, p_caregiver uuid default auth.uid())
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  grace interval := interval '30 minutes';
  has_any_shift boolean;
  now_ts timestamptz := now();
  eastern_today date := (now_ts at time zone 'America/New_York')::date;
  candidate_date date;
  s record;
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

  foreach candidate_date in array array[eastern_today, eastern_today - 1]
  loop
    for s in
      select * from shifts
      where patient_id = p_patient and caregiver_id = p_caregiver
        and (
          (weekday is not null and weekday = extract(dow from candidate_date)::int
             and starts_on <= candidate_date and (ends_on is null or ends_on >= candidate_date))
          or (on_date = candidate_date)
        )
    loop
      occ_start := (candidate_date::text || ' ' || s.start_time::text)::timestamp at time zone 'America/New_York';
      occ_end := (candidate_date::text || ' ' || s.end_time::text)::timestamp at time zone 'America/New_York';
      if s.end_time <= s.start_time then
        occ_end := occ_end + interval '1 day'; -- overnight
      end if;
      if now_ts between (occ_start - grace) and (occ_end + grace) then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$$;
grant execute on function caregiver_on_shift(uuid, uuid) to authenticated;

create or replace function trg_check_shift_for_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  my_role text;
begin
  select role into my_role from staff_accounts where user_id = auth.uid();
  if my_role = 'caregiver' and not caregiver_on_shift(new.patient_id, auth.uid()) then
    raise exception 'You can only start a check-in while you are on shift for this patient.';
  end if;
  return new;
end;
$$;
drop trigger if exists check_shift_for_checkin on checkins;
create trigger check_shift_for_checkin before insert on checkins for each row execute function trg_check_shift_for_checkin();
