-- Checking out ends the shift. Until now a caregiver who tapped "I'm leaving" was still treated as on shift for the rest
-- of the scheduled window (plus 30 minutes), so they could still record check-ins, readings, medication and tasks.
-- Now, if they have already arrived and left during a scheduled shift, that shift no longer counts for them. Tapping
-- "I'm still here" (a new arrival) puts them back on shift, and a later shift on the same patient is not affected.
-- This function backs the check-in, reading, medication and task rules and the medication reminders, so they all follow.

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
        -- Already arrived and left during this shift: they have checked out, so it no longer counts. An arrival belongs to the
        -- shift it was recorded against (its planned start); one with no planned start belongs to the shift it happened in.
        continue when exists (
          select 1 from shift_attendance a
          where a.patient_id = p_patient and a.caregiver_id = p_caregiver and a.left_at is not null and a.left_at <= now_ts
            and (
              (a.planned_start is not null and abs(extract(epoch from (a.planned_start - occ_start))) < 120)
              or (a.planned_start is null and a.arrived_at >= occ_start - interval '60 minutes' and a.arrived_at < occ_end)
            )
        );
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$function$;
