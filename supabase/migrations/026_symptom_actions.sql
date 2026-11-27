-- When severe symptoms are recorded, the caregiver or family proxy notes what they did about it, and the
-- administrator can see it. Append-only: people add what they did, nobody edits history. Only an
-- administrator can delete an entry.

create table if not exists symptom_actions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  entry_date date not null,                       -- the day of the severe check-in this is about
  actions text[] not null default '{}',           -- ticked suggestions, e.g. "Called 911"
  other_note text,                                -- anything else they did
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (cardinality(actions) <= 12),
  check (char_length(coalesce(other_note, '')) <= 500),
  check (cardinality(actions) > 0 or char_length(trim(coalesce(other_note, ''))) > 0)
);
create index if not exists symptom_actions_patient_idx on symptom_actions (patient_id, entry_date desc);

alter table symptom_actions enable row level security;
revoke all on symptom_actions from anon;

drop policy if exists "view symptom actions" on symptom_actions;
create policy "view symptom actions" on symptom_actions for select using (can_view_patient(patient_id));
drop policy if exists "record symptom actions" on symptom_actions;
create policy "record symptom actions" on symptom_actions for insert
  with check (can_edit_patient(patient_id) and recorded_by = auth.uid());
drop policy if exists "admin deletes symptom actions" on symptom_actions;
create policy "admin deletes symptom actions" on symptom_actions for delete using (is_admin());

-- An action can only be recorded against a check-in that really had a severe symptom, and each ticked item
-- must be short, so the table cannot be filled with junk.
create or replace function trg_check_symptom_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from checkins c
    where c.patient_id = new.patient_id and c.entry_date = new.entry_date
      and exists (select 1 from jsonb_each_text(c.symptoms) s where s.value = '3')
  ) then
    raise exception 'There is no severe-symptom check-in on that day for this patient.';
  end if;
  if exists (select 1 from unnest(new.actions) a where char_length(a) > 120) then
    raise exception 'An action is too long.';
  end if;
  return new;
end;
$$;
drop trigger if exists check_symptom_action on symptom_actions;
create trigger check_symptom_action before insert on symptom_actions for each row execute function trg_check_symptom_action();

-- The administrator's audit trail shows who did what about a severe symptom.
create or replace function trg_log_symptom_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_activity(
    new.patient_id,
    'recorded the action taken for severe symptoms',
    to_char(new.entry_date, 'FMMon FMDD') || ': '
      || coalesce(nullif(array_to_string(new.actions, '; '), ''), '')
      || case when nullif(trim(coalesce(new.other_note, '')), '') is not null
              then case when cardinality(new.actions) > 0 then '. Also: ' else '' end || trim(new.other_note) else '' end
  );
  return new;
end;
$$;
drop trigger if exists log_symptom_action on symptom_actions;
create trigger log_symptom_action after insert on symptom_actions for each row execute function trg_log_symptom_action();

-- home_people() also names whoever recorded an action, so the Home page can say who did what.
create or replace function home_people()
returns table (patient_id uuid, user_id uuid, name text, role text, on_team boolean)
language sql stable security definer set search_path = public as $$
  with visible as (select p.id from patients p where can_view_patient(p.id)),
  ppl as (
    select pa.patient_id, pa.user_id, true as on_team
      from patient_assignments pa join visible v on v.id = pa.patient_id
    union all
    select c.patient_id, c.recorded_by, false
      from checkins c join visible v on v.id = c.patient_id
      where c.recorded_by is not null and c.entry_date >= current_date - 14
    union all
    select sa.patient_id, sa.recorded_by, false
      from symptom_actions sa join visible v on v.id = sa.patient_id
      where sa.recorded_by is not null and sa.entry_date >= current_date - 14
  )
  select p.patient_id, p.user_id,
         coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), 'Team member'),
         s.role,
         bool_or(p.on_team)
  from ppl p join staff_accounts s on s.user_id = p.user_id and s.approved
  group by p.patient_id, p.user_id, s.first_name, s.last_name, s.role
$$;
revoke execute on function home_people() from public, anon;
grant execute on function home_people() to authenticated;
