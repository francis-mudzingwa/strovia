-- Bowel movement log. Carers and administrators only: family members and health proxies cannot read or write it.
--   * a carer can only add an entry while on shift for the patient (same rule as readings, tasks and medication)
--   * undo is always open to whoever recorded it, and to an administrator
--   * an entry marked "blood or black stool" tells the care team straight away (push alert, no details in the alert)
--   * how many days with no bowel movement before the office should be told is set per patient in the care plan
--     (care_plan.bowelDays); nothing is assumed when it is not set.

create table if not exists bowel_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  happened_at timestamptz not null default now(),
  kind text not null check (kind in ('hard', 'normal', 'loose', 'watery')),
  accident boolean not null default false,
  blood boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  done_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bowel_log_by_patient on bowel_log (patient_id, happened_at desc);

alter table bowel_log enable row level security;

drop policy if exists "view bowel log" on bowel_log;
create policy "view bowel log" on bowel_log for select using (is_staff() and can_view_patient(patient_id));
drop policy if exists "add bowel log" on bowel_log;
create policy "add bowel log" on bowel_log for insert with check (is_staff() and can_edit_patient(patient_id) and done_by = auth.uid());
drop policy if exists "undo bowel log" on bowel_log;
create policy "undo bowel log" on bowel_log for delete using (is_admin() or (is_staff() and done_by = auth.uid() and can_edit_patient(patient_id)));

-- A sensible time: not in the future, and not more than two days back.
create or replace function trg_bowel_time() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.happened_at > now() + interval '5 minutes' then
    raise exception 'That time is in the future.';
  end if;
  if new.happened_at < now() - interval '2 days' then
    raise exception 'That was too long ago to add here.';
  end if;
  return new;
end;
$$;
drop trigger if exists bowel_time on bowel_log;
create trigger bowel_time before insert on bowel_log for each row execute function trg_bowel_time();

drop trigger if exists check_shift_for_bowel_log on bowel_log;
create trigger check_shift_for_bowel_log before insert on bowel_log for each row execute function trg_check_shift_for_care_action();

-- Blood or black stool: tell the team (send-reminders decides who; the alert carries no details).
create or replace function trg_alert_bowel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.blood then
    perform notify_event('bowel_blood', new.patient_id);
  end if;
  return new;
end;
$$;
drop trigger if exists alert_bowel on bowel_log;
create trigger alert_bowel after insert on bowel_log for each row execute function trg_alert_bowel();
