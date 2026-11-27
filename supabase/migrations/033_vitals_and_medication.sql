-- Two additions to the care tools:
--  1. Two more readings: temperature and oxygen saturation (SpO2). Chosen because a stroke survivor's caregiver
--     already commonly has a thermometer and a pulse oximeter, and both catch problems that don't announce
--     themselves as symptoms: a fever (infection, sometimes pneumonia from swallowing trouble) and low oxygen
--     (poor breathing or a swallowing problem). Respiratory rate and pain scores were considered but left out:
--     they need either a device most homes don't have or a subjective scale, unlike the others already tracked.
--  2. A medication schedule and log: the administrator sets what's due and when in the care plan; caregivers and
--     family proxies mark each dose given or refused; the administrator (and everyone on the team) can see who
--     dispensed what and when. A refused dose raises the same kind of alert as an incident.

-- 1a. New readings -----------------------------------------------------------------------------------------
alter table vitals add column if not exists temperature numeric(4,1) check (temperature between 85 and 110);       -- Fahrenheit
alter table vitals add column if not exists oxygen_saturation int check (oxygen_saturation between 50 and 100);    -- SpO2 %

do $$
declare
  old_name text;
begin
  select conname into old_name from pg_constraint
  where conrelid = 'vitals'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%systolic is not null or pulse is not null%';
  if old_name is not null then
    execute format('alter table vitals drop constraint %I', old_name);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'vitals'::regclass and conname = 'vitals_has_a_reading') then
    alter table vitals add constraint vitals_has_a_reading check (
      systolic is not null or pulse is not null or glucose is not null or weight_lb is not null
      or temperature is not null or oxygen_saturation is not null
    );
  end if;
end $$;

create or replace function trg_log_vitals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parts text[] := '{}';
begin
  if new.systolic is not null then parts := array_append(parts, 'blood pressure ' || new.systolic || '/' || new.diastolic); end if;
  if new.pulse is not null then parts := array_append(parts, 'pulse ' || new.pulse); end if;
  if new.glucose is not null then parts := array_append(parts, 'blood sugar ' || new.glucose || ' mg/dL'); end if;
  if new.weight_lb is not null then parts := array_append(parts, 'weight ' || new.weight_lb || ' lb'); end if;
  if new.temperature is not null then parts := array_append(parts, 'temperature ' || new.temperature || '°F'); end if;
  if new.oxygen_saturation is not null then parts := array_append(parts, 'oxygen ' || new.oxygen_saturation || '%'); end if;
  perform log_activity(new.patient_id, 'recorded a reading', array_to_string(parts, ', '));
  return new;
end;
$$;

-- 1b. The out-of-range check (029) grows the same two fields; the old 5-argument version is dropped, not kept, so
-- there is only ever one to call.
drop function if exists reading_out_of_range(uuid, int, int, int, numeric);

create or replace function reading_out_of_range(p_patient uuid, p_sys int, p_dia int, p_pulse int, p_glucose numeric, p_temp numeric, p_o2 int)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  select care_plan->'ranges' into r from patients where id = p_patient;
  if r is null or jsonb_typeof(r) <> 'object' then
    return false;
  end if;
  return
    (p_sys is not null and ((r ? 'systolic_max' and p_sys > (r->>'systolic_max')::numeric) or (r ? 'systolic_min' and p_sys < (r->>'systolic_min')::numeric)))
    or (p_dia is not null and ((r ? 'diastolic_max' and p_dia > (r->>'diastolic_max')::numeric) or (r ? 'diastolic_min' and p_dia < (r->>'diastolic_min')::numeric)))
    or (p_pulse is not null and ((r ? 'pulse_max' and p_pulse > (r->>'pulse_max')::numeric) or (r ? 'pulse_min' and p_pulse < (r->>'pulse_min')::numeric)))
    or (p_glucose is not null and ((r ? 'glucose_max' and p_glucose > (r->>'glucose_max')::numeric) or (r ? 'glucose_min' and p_glucose < (r->>'glucose_min')::numeric)))
    or (p_temp is not null and ((r ? 'temperature_max' and p_temp > (r->>'temperature_max')::numeric) or (r ? 'temperature_min' and p_temp < (r->>'temperature_min')::numeric)))
    or (p_o2 is not null and ((r ? 'oxygen_saturation_max' and p_o2 > (r->>'oxygen_saturation_max')::numeric) or (r ? 'oxygen_saturation_min' and p_o2 < (r->>'oxygen_saturation_min')::numeric)));
end;
$$;
revoke execute on function reading_out_of_range(uuid, int, int, int, numeric, numeric, int) from public, anon, authenticated;

create or replace function trg_alert_reading() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if reading_out_of_range(new.patient_id, new.systolic, new.diastolic, new.pulse, new.glucose, new.temperature, new.oxygen_saturation) then
    perform notify_event('reading', new.patient_id);
  end if;
  return new;
end;
$$;

-- 2. Medication schedule and log ---------------------------------------------------------------------------
-- The schedule itself (name, dose, times of day, instructions, or "as needed") lives in care_plan->'medSchedule',
-- set by the administrator alongside the daily tasks and reading ranges already there. This table is only the log
-- of what actually happened: each dose given or refused, by whom, and when.
create table if not exists medication_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  med_name text not null check (char_length(med_name) between 1 and 120),
  dose text check (char_length(coalesce(dose, '')) <= 60),
  scheduled_for timestamptz,                                   -- the due time this logs (null for an as-needed dose)
  status text not null check (status in ('given', 'refused')),
  given_by uuid references auth.users(id) on delete set null,
  note text check (char_length(coalesce(note, '')) <= 300),
  created_at timestamptz not null default now()
);
-- A scheduled dose can only be logged once; an as-needed dose (scheduled_for null) has no such limit.
create unique index if not exists medication_log_scheduled_unique on medication_log (patient_id, med_name, scheduled_for) where scheduled_for is not null;
create index if not exists medication_log_patient_idx on medication_log (patient_id, created_at desc);

alter table medication_log enable row level security;
revoke all on medication_log from anon;
drop policy if exists "view medication log" on medication_log;
create policy "view medication log" on medication_log for select using (can_view_patient(patient_id));
drop policy if exists "log medication" on medication_log;
create policy "log medication" on medication_log for insert with check (can_edit_patient(patient_id) and given_by = auth.uid());
drop policy if exists "admin deletes medication log" on medication_log;
create policy "admin deletes medication log" on medication_log for delete using (is_admin());

create or replace function trg_log_medication() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_activity(
    new.patient_id,
    case when new.status = 'refused' then 'recorded a refused dose' else 'gave a dose of medicine' end,
    new.med_name || coalesce(' (' || new.dose || ')', '') || coalesce('. ' || nullif(trim(new.note), ''), '')
  );
  return new;
end;
$$;
drop trigger if exists log_medication on medication_log;
create trigger log_medication after insert on medication_log for each row execute function trg_log_medication();

-- A refused dose alerts the team the same way an incident does; a given dose does not (it's the expected outcome
-- and would be noise on every ordinary day).
create or replace function trg_alert_medication() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'refused' then
    perform notify_event('medication_refused', new.patient_id, new.med_name);
  end if;
  return new;
end;
$$;
drop trigger if exists alert_medication on medication_log;
create trigger alert_medication after insert on medication_log for each row execute function trg_alert_medication();
