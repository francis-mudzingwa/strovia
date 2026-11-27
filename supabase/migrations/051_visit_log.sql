-- Did the visit happen? A visit (a therapist or nurse coming on set days) is only a schedule, so nothing recorded whether
-- a particular visit took place. One row here is the result for one visit on one date: it happened (with an optional note
-- such as what was done) or it did not (with a reason). A recurring visit gets its own row each time it comes round.
--
-- Anyone assigned to the patient (caregiver or family proxy) and the administrator can record a result and correct it,
-- the same people who can add and change visits (migrations 044 and 050).

create table if not exists visit_log (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  occurred_on date not null,
  status text not null check (status in ('happened', 'missed')),
  reason text check (reason in ('cancelled', 'unwell', 'out', 'wrong_time', 'other')),
  note text check (note is null or char_length(note) <= 300),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (visit_id, occurred_on),
  constraint visit_log_reason_needed check (status <> 'missed' or reason is not null)
);
create index if not exists visit_log_patient_idx on visit_log (patient_id, occurred_on desc);

alter table visit_log enable row level security;
revoke all on visit_log from anon;

-- The patient always comes from the visit itself, so a result cannot be filed under a different patient than its visit,
-- and the visit, patient and date cannot be changed afterwards (only the result, reason and note).
create or replace function trg_visit_log_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid;
begin
  select patient_id into v_patient from visits where id = new.visit_id;
  if v_patient is null then
    raise exception 'That visit no longer exists.';
  end if;
  if tg_op = 'UPDATE' and (new.visit_id <> old.visit_id or new.occurred_on <> old.occurred_on) then
    raise exception 'The visit and its date cannot be changed. Remove this result and record a new one.';
  end if;
  new.patient_id := v_patient;
  return new;
end;
$$;
drop trigger if exists visit_log_fill on visit_log;
create trigger visit_log_fill before insert or update on visit_log for each row execute function trg_visit_log_fill();

drop policy if exists "view visit log" on visit_log;
create policy "view visit log" on visit_log for select using (can_view_patient(patient_id));
drop policy if exists "record visit result" on visit_log;
create policy "record visit result" on visit_log for insert with check (can_edit_patient(patient_id) and recorded_by = auth.uid());
drop policy if exists "correct visit result" on visit_log;
create policy "correct visit result" on visit_log for update using (can_edit_patient(patient_id)) with check (can_edit_patient(patient_id));
drop policy if exists "remove visit result" on visit_log;
create policy "remove visit result" on visit_log for delete using (can_edit_patient(patient_id));
