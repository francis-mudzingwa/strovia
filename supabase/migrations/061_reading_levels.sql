-- Reading levels. A patient's care plan can hold two levels for each reading, set from the doctor's numbers:
--   amber = outside the range (tell the supervisor), already stored as  <reading>_min / <reading>_max
--   red   = urgent (call now), new:                                      <reading>_red_min / <reading>_red_max
-- plus a weight-gain rule (weight_gain_1d, weight_gain_7d, in lb) and, for every reading, how often it should be taken
-- (<reading>_every, in hours; blood pressure is bp_every, weight is weight_every). Strovia still sets no medical limits itself:
-- nothing is flagged unless the care team has entered a number.

-- 1. What a reading records about itself ---------------------------------------------------------------------
alter table vitals add column if not exists level text check (level in ('amber', 'red'));
alter table vitals add column if not exists acknowledged_by uuid references auth.users(id) on delete set null;
alter table vitals add column if not exists acknowledged_at timestamptz;
alter table vitals add column if not exists action_note text;
alter table vitals add column if not exists repeat_count smallint not null default 0;
alter table vitals add column if not exists last_alert_at timestamptz;

-- 2. Judging a reading ------------------------------------------------------------------------------------
-- A number from the care plan, or nothing if it is missing or not a number.
create or replace function reading_limit(r jsonb, k text)
returns numeric language sql immutable as $$
  select case when (r->>k) ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>k)::numeric end
$$;

create or replace function reading_crosses(r jsonb, k text, val numeric, red boolean)
returns boolean language sql immutable as $$
  select val is not null and (
    (reading_limit(r, k || case when red then '_red_max' else '_max' end) is not null and val > reading_limit(r, k || case when red then '_red_max' else '_max' end))
    or (reading_limit(r, k || case when red then '_red_min' else '_min' end) is not null and val < reading_limit(r, k || case when red then '_red_min' else '_min' end))
  )
$$;

-- 'red', 'amber' or null. Weight is judged by how much it has gone UP: compared with the lowest weight recorded in the
-- last 24 hours (weight_gain_1d) and in the last 7 days (weight_gain_7d).
create or replace function assess_reading(p_patient uuid, v vitals)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  red boolean;
  amber boolean;
  g1 numeric;
  g7 numeric;
  low1 numeric;
  low7 numeric;
  at_time timestamptz := coalesce(v.taken_at, now());
begin
  select care_plan->'ranges' into r from patients where id = p_patient;
  if r is null or jsonb_typeof(r) <> 'object' then
    return null;
  end if;
  red := reading_crosses(r, 'systolic', v.systolic, true) or reading_crosses(r, 'diastolic', v.diastolic, true)
      or reading_crosses(r, 'pulse', v.pulse, true) or reading_crosses(r, 'glucose', v.glucose, true)
      or reading_crosses(r, 'temperature', v.temperature, true) or reading_crosses(r, 'oxygen_saturation', v.oxygen_saturation, true)
      or reading_crosses(r, 'pain_score', v.pain_score, true);
  if red then
    return 'red';
  end if;
  amber := reading_crosses(r, 'systolic', v.systolic, false) or reading_crosses(r, 'diastolic', v.diastolic, false)
        or reading_crosses(r, 'pulse', v.pulse, false) or reading_crosses(r, 'glucose', v.glucose, false)
        or reading_crosses(r, 'temperature', v.temperature, false) or reading_crosses(r, 'oxygen_saturation', v.oxygen_saturation, false)
        or reading_crosses(r, 'pain_score', v.pain_score, false);
  g1 := reading_limit(r, 'weight_gain_1d');
  g7 := reading_limit(r, 'weight_gain_7d');
  if not amber and v.weight_lb is not null and (g1 is not null or g7 is not null) then
    select min(w.weight_lb) filter (where w.taken_at > at_time - interval '24 hours'), min(w.weight_lb)
      into low1, low7
      from vitals w
      where w.patient_id = p_patient and w.weight_lb is not null and w.taken_at > at_time - interval '7 days' and w.taken_at <= at_time;
    amber := (g1 is not null and low1 is not null and v.weight_lb - low1 > g1) or (g7 is not null and low7 is not null and v.weight_lb - low7 > g7);
  end if;
  return case when amber then 'amber' end;
end;
$$;
revoke execute on function assess_reading(uuid, vitals) from public, anon, authenticated;

create or replace function trg_vitals_level() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.level := assess_reading(new.patient_id, new);
  if new.level = 'red' then
    new.last_alert_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists vitals_level on vitals;
create trigger vitals_level before insert on vitals for each row execute function trg_vitals_level();

-- The phone alert now follows the level: urgent for red, the usual one for amber. (Pain and weight are judged too now.)
create or replace function trg_alert_reading() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.level = 'red' then
    perform notify_event('reading_urgent', new.patient_id);
  elsif new.level = 'amber' then
    perform notify_event('reading', new.patient_id);
  end if;
  return new;
end;
$$;

-- 3. "What was done" about an urgent reading ------------------------------------------------------------------
create or replace function acknowledge_reading(p_vital uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v vitals;
  my_role text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  select * into v from vitals where id = p_vital;
  if not found or not can_edit_patient(v.patient_id) then
    raise exception 'You are not on this patient''s care team.';
  end if;
  select role into my_role from staff_accounts where user_id = auth.uid();
  if my_role = 'caregiver' and not caregiver_on_shift(v.patient_id, auth.uid()) then
    raise exception 'Only the caregiver on shift can record this.';
  end if;
  if v.level is distinct from 'red' then
    raise exception 'Only an urgent reading needs this.';
  end if;
  if p_note is null or char_length(btrim(p_note)) = 0 then
    raise exception 'Write what was done.';
  end if;
  update vitals set acknowledged_by = auth.uid(), acknowledged_at = now(), action_note = left(btrim(p_note), 500)
   where id = p_vital and acknowledged_at is null;
  perform log_activity(v.patient_id, 'recorded what was done about an urgent reading', null);
end;
$$;
revoke execute on function acknowledge_reading(uuid, text) from public, anon;
grant execute on function acknowledge_reading(uuid, text) to authenticated;

-- 4. Readings that are overdue ---------------------------------------------------------------------------------
-- Each reading in the care plan can have a "how often" (hours). It is due that long after it was last recorded, or after the
-- plan was saved if it has never been recorded.
create or replace function reading_overdue_rows()
returns table (patient_id uuid, reading text, every_hours integer, last_at timestamptz, due_at timestamptz)
language sql stable security definer set search_path = public as $$
  with defs(reading, k) as (values
    ('bp', 'bp_every'), ('pulse', 'pulse_every'), ('glucose', 'glucose_every'), ('temperature', 'temperature_every'),
    ('oxygen_saturation', 'oxygen_saturation_every'), ('pain_score', 'pain_score_every'), ('weight', 'weight_every')),
  reads as (
    select v.patient_id as pid, 'bp'::text as reading, v.taken_at from vitals v where v.systolic is not null
    union all select v.patient_id, 'pulse', v.taken_at from vitals v where v.pulse is not null
    union all select v.patient_id, 'glucose', v.taken_at from vitals v where v.glucose is not null
    union all select v.patient_id, 'temperature', v.taken_at from vitals v where v.temperature is not null
    union all select v.patient_id, 'oxygen_saturation', v.taken_at from vitals v where v.oxygen_saturation is not null
    union all select v.patient_id, 'pain_score', v.taken_at from vitals v where v.pain_score is not null
    union all select v.patient_id, 'weight', v.taken_at from vitals v where v.weight_lb is not null
  ),
  last_read as (
    select pid, reading, max(taken_at) as last_at from reads where taken_at > now() - interval '60 days' group by pid, reading
  ),
  cfg as (
    select p.id as pid, d.reading, reading_limit(p.care_plan->'ranges', d.k) as hrs,
           case when (p.care_plan->'ranges'->>'set_at') ~ '^[0-9]{4}-' then (p.care_plan->'ranges'->>'set_at')::timestamptz end as set_at
    from patients p cross join defs d
    where p.archived_at is null and jsonb_typeof(p.care_plan->'ranges') = 'object'
  )
  select c.pid, c.reading, c.hrs::integer, l.last_at,
         greatest(coalesce(l.last_at, '-infinity'::timestamptz), coalesce(c.set_at, now())) + make_interval(hours => c.hrs::integer)
  from cfg c left join last_read l on l.pid = c.pid and l.reading = c.reading
  where c.hrs is not null and c.hrs > 0
$$;
revoke execute on function reading_overdue_rows() from public, anon, authenticated;

-- What a signed-in person may see: the overdue readings of the patients they can view.
create or replace function overdue_readings()
returns table (patient_id uuid, reading text, every_hours integer, last_at timestamptz, due_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.patient_id, r.reading, r.every_hours, r.last_at, r.due_at
  from reading_overdue_rows() r
  where r.due_at < now() and can_view_patient(r.patient_id)
$$;
revoke execute on function overdue_readings() from public, anon;
grant execute on function overdue_readings() to authenticated;

-- What the alert job may announce: overdue by more than half an hour, and only once per overdue period.
create or replace function reading_overdue_alertable()
returns table (patient_id uuid, reading text, every_hours integer, last_at timestamptz, due_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.patient_id, r.reading, r.every_hours, r.last_at, r.due_at from reading_overdue_rows() r where r.due_at < now() - interval '30 minutes'
$$;
revoke execute on function reading_overdue_alertable() from public, anon, authenticated;
grant execute on function reading_overdue_alertable() to service_role;

create table if not exists reading_overdue_log (
  patient_id uuid not null references patients(id) on delete cascade,
  reading text not null,
  due_at timestamptz not null,
  alerted_at timestamptz not null default now(),
  primary key (patient_id, reading, due_at)
);
alter table reading_overdue_log enable row level security;
revoke all on reading_overdue_log from anon, authenticated;
