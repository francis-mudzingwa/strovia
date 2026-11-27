-- Push alerts when something important happens, and a weekly summary email for family proxies.
-- The database tells the send-reminders function what happened; that function decides who to notify.

create extension if not exists pg_net;

-- The function secret, kept where only the database can read it (no policies: the app can never see this table).
create table if not exists app_secrets (
  name text primary key,
  value text not null
);
alter table app_secrets enable row level security;
revoke all on app_secrets from anon, authenticated;

-- Reuse the secret the reminders schedule already uses.
insert into app_secrets (name, value)
select 'cron_secret', (regexp_match(command, '''x-cron-secret'', ''([^'']+)'''))[1]
from cron.job
where jobname = 'strovia-send-reminders' and (regexp_match(command, '''x-cron-secret'', ''([^'']+)'''))[1] is not null
on conflict (name) do update set value = excluded.value;

create or replace function notify_event(p_event text, p_patient uuid, p_label text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  secret text;
  who text;
begin
  select value into secret from app_secrets where name = 'cron_secret';
  if secret is null then
    return;
  end if;
  select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') into who
    from staff_accounts where user_id = auth.uid();
  perform net.http_post(
    url := 'https://tbxgxbfxndegkbqwebis.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('event', p_event, 'patient_id', p_patient, 'actor_id', auth.uid(), 'actor_name', coalesce(who, 'Someone'), 'label', p_label)
  );
exception when others then
  null; -- an alert problem must never stop a check-in or a note from being saved
end;
$$;
revoke execute on function notify_event(text, uuid, text) from public, anon, authenticated;

-- 1. Severe symptoms recorded (only when a check-in newly becomes severe, not on every edit)
create or replace function trg_alert_severe() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  now_severe boolean := exists (select 1 from jsonb_each_text(new.symptoms) s where s.value = '3');
  was_severe boolean := tg_op = 'UPDATE' and exists (select 1 from jsonb_each_text(old.symptoms) s where s.value = '3');
begin
  if now_severe and not was_severe then
    perform notify_event('severe', new.patient_id);
  end if;
  return new;
end;
$$;
drop trigger if exists alert_severe on checkins;
create trigger alert_severe after insert or update on checkins for each row execute function trg_alert_severe();

-- 2. Someone recorded what was done about severe symptoms
create or replace function trg_alert_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_event('action_recorded', new.patient_id);
  return new;
end;
$$;
drop trigger if exists alert_action on symptom_actions;
create trigger alert_action after insert on symptom_actions for each row execute function trg_alert_action();

-- 3. An incident was reported
create or replace function trg_alert_incident() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_event('incident', new.patient_id, initcap(new.kind) || case when new.injury then ' (with injury)' else '' end);
  return new;
end;
$$;
drop trigger if exists alert_incident on incidents;
create trigger alert_incident after insert on incidents for each row execute function trg_alert_incident();

-- 4. Someone asked the care team a question
create or replace function trg_alert_question() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'question' then
    perform notify_event('question', new.patient_id);
  end if;
  return new;
end;
$$;
drop trigger if exists alert_question on patient_notes;
create trigger alert_question after insert on patient_notes for each row execute function trg_alert_question();

-- 5. The care plan changed
create or replace function trg_alert_care_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.care_plan is distinct from old.care_plan then
    perform notify_event('care_plan', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists alert_care_plan on patients;
create trigger alert_care_plan after update on patients for each row execute function trg_alert_care_plan();

-- 6. A reading was outside the range the administrator set in the care plan (nothing is flagged without a range)
create or replace function reading_out_of_range(p_patient uuid, p_sys int, p_dia int, p_pulse int, p_glucose numeric)
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
    or (p_glucose is not null and ((r ? 'glucose_max' and p_glucose > (r->>'glucose_max')::numeric) or (r ? 'glucose_min' and p_glucose < (r->>'glucose_min')::numeric)));
end;
$$;
revoke execute on function reading_out_of_range(uuid, int, int, int, numeric) from public, anon, authenticated;

create or replace function trg_alert_reading() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if reading_out_of_range(new.patient_id, new.systolic, new.diastolic, new.pulse, new.glucose) then
    perform notify_event('reading', new.patient_id);
  end if;
  return new;
end;
$$;
drop trigger if exists alert_reading on vitals;
create trigger alert_reading after insert on vitals for each row execute function trg_alert_reading();

-- 7. A weekly summary email to every family proxy, on Sundays at 09:00 (UTC)
select cron.unschedule('strovia-weekly-digest') where exists (select 1 from cron.job where jobname = 'strovia-weekly-digest');
do $$
declare
  secret text;
begin
  select value into secret from app_secrets where name = 'cron_secret';
  if secret is not null then
    perform cron.schedule(
      'strovia-weekly-digest',
      '0 9 * * 0',
      format($cmd$
        select net.http_post(
          url := 'https://tbxgxbfxndegkbqwebis.supabase.co/functions/v1/send-mail',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
          body := '{"type":"weekly_digest"}'::jsonb
        );
      $cmd$, secret)
    );
  end if;
end
$$;
