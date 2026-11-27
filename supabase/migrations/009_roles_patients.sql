-- Roles (admin / caregiver / relative), patients as their own records, admin-managed
-- assignments, wellbeing notes and an activity log the admin can read.
-- WARNING: this clears all check-ins and recovery insights (they are re-created empty).

-- 1. Retire the old "patient invites a caregiver by email" model -----------------------
drop policy if exists "caregiver view linked checkins" on checkins;
drop policy if exists "caregiver view linked profile" on profiles;
drop policy if exists "caregiver view linked ai_insights" on ai_insights;
drop function if exists accept_caregiver_invitation(uuid);
drop function if exists get_invitation_preview(uuid);
drop table if exists caregiver_observations cascade;
drop table if exists caregiver_links cascade;
drop table if exists caregiver_invitations cascade;
drop table if exists profiles cascade;
drop table if exists checkins cascade;
drop table if exists ai_insights cascade;

-- 2. Accounts: one role per account ---------------------------------------------------
alter table staff_accounts add column if not exists role text not null default 'caregiver';
alter table staff_accounts drop constraint if exists staff_accounts_role_check;
alter table staff_accounts add constraint staff_accounts_role_check check (role in ('admin', 'caregiver', 'relative'));
alter table staff_accounts alter column company_id drop not null;
alter table staff_accounts alter column organisation set default '';
update staff_accounts set role = 'admin' where company_id = 'C4XXXXX';

create or replace function handle_new_staff()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid text;
begin
  cid := upper(trim(coalesce(new.raw_user_meta_data->>'company_id', '')));
  if cid = '' then
    return new;
  end if;

  if cid !~ '^C[0-9]{6}$' then
    raise exception 'Company ID % is not valid.', cid;
  end if;
  if substring(cid from 2)::int not between 427535 and 427545 then
    raise exception 'Company ID % is outside the allowed range.', cid;
  end if;

  insert into staff_accounts (user_id, company_id, organisation, first_name, last_name, job_title, phone, role)
  values (
    new.id,
    cid,
    coalesce(new.raw_user_meta_data->>'organisation', ''),
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'job_title',
    new.raw_user_meta_data->>'phone',
    case when cid = 'C4XXXXX' then 'admin' else 'caregiver' end
  );
  return new;
end;
$$;

-- 3. Patients and who may see them ------------------------------------------------------
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  profile jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists patient_assignments (
  patient_id uuid not null references patients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (patient_id, user_id)
);

create table if not exists join_invitations (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  invitee_name text not null,
  invitee_email text not null,
  relationship text,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz
);

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from staff_accounts where user_id = auth.uid()), false)
$$;

create or replace function can_view_patient(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (select 1 from patient_assignments pa where pa.patient_id = p and pa.user_id = auth.uid())
$$;

-- Admins, assigned caregivers and assigned relatives may all record and edit: a relative
-- takes over when the caregiver is away, so they can do everything a caregiver can.
create or replace function can_edit_patient(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from patient_assignments pa where pa.patient_id = p and pa.user_id = auth.uid()
  )
$$;

alter table patients enable row level security;
alter table patient_assignments enable row level security;
alter table join_invitations enable row level security;

drop policy if exists "view patients" on patients;
create policy "view patients" on patients for select using (can_view_patient(id));
drop policy if exists "admin adds patients" on patients;
create policy "admin adds patients" on patients for insert with check (is_admin());
drop policy if exists "edit patients" on patients;
create policy "edit patients" on patients for update using (can_edit_patient(id)) with check (can_edit_patient(id));
drop policy if exists "admin removes patients" on patients;
create policy "admin removes patients" on patients for delete using (is_admin());

drop policy if exists "view assignments" on patient_assignments;
create policy "view assignments" on patient_assignments for select using (is_admin() or user_id = auth.uid());
drop policy if exists "admin assigns" on patient_assignments;
create policy "admin assigns" on patient_assignments for insert with check (is_admin());
drop policy if exists "admin unassigns" on patient_assignments;
create policy "admin unassigns" on patient_assignments for delete using (is_admin());

drop policy if exists "admin manages invitations" on join_invitations;
create policy "admin manages invitations" on join_invitations for all using (is_admin()) with check (is_admin());

-- 4. Clinical data, now belonging to a patient -------------------------------------------
create table checkins (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  recorded_by uuid references auth.users(id) on delete set null,
  entry_date date not null,
  symptoms jsonb not null,
  feeling int,
  notes text,
  onset_note text,
  created_at timestamptz not null default now(),
  unique (patient_id, entry_date)
);

create table ai_insights (
  patient_id uuid primary key references patients(id) on delete cascade,
  explanation text,
  mobility_progress text,
  speech_progress text,
  cognitive_progress text,
  adl_progress text,
  recovery_level text,
  trend text,
  updated_at timestamptz default now()
);

alter table checkins enable row level security;
alter table ai_insights enable row level security;

create policy "view checkins" on checkins for select using (can_view_patient(patient_id));
create policy "record checkins" on checkins for insert with check (can_edit_patient(patient_id) and recorded_by = auth.uid());
create policy "edit checkins" on checkins for update using (can_edit_patient(patient_id)) with check (can_edit_patient(patient_id));
create policy "admin deletes checkins" on checkins for delete using (is_admin());

create policy "view insights" on ai_insights for select using (can_view_patient(patient_id));
create policy "write insights" on ai_insights for insert with check (can_edit_patient(patient_id));
create policy "update insights" on ai_insights for update using (can_edit_patient(patient_id)) with check (can_edit_patient(patient_id));

-- Appointments belong to a patient (old rows are kept only if their patient name matches a patient).
alter table appointments add column if not exists patient_id uuid references patients(id) on delete cascade;
update appointments a set patient_id = p.id from patients p where a.patient_id is null and lower(p.full_name) = lower(a.patient_name);
delete from appointments where patient_id is null;
alter table appointments alter column patient_id set not null;
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'appointments' and column_name = 'user_id') then
    alter table appointments rename column user_id to created_by;
  end if;
end $$;
alter table appointments drop constraint if exists appointments_user_id_fkey;
alter table appointments drop constraint if exists appointments_created_by_fkey;
alter table appointments alter column created_by drop not null;
alter table appointments add constraint appointments_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
drop index if exists appointments_user_starts_idx;
create index if not exists appointments_patient_starts_idx on appointments (patient_id, starts_at);
drop policy if exists "owners manage appointments" on appointments;
drop policy if exists "caregivers view linked appointments" on appointments;
drop policy if exists "view appointments" on appointments;
create policy "view appointments" on appointments for select using (can_view_patient(patient_id));
drop policy if exists "add appointments" on appointments;
create policy "add appointments" on appointments for insert with check (can_edit_patient(patient_id));
drop policy if exists "change appointments" on appointments;
create policy "change appointments" on appointments for update using (can_edit_patient(patient_id)) with check (can_edit_patient(patient_id));
drop policy if exists "remove appointments" on appointments;
create policy "remove appointments" on appointments for delete using (can_edit_patient(patient_id));

-- 5. Wellbeing notes: everyone with access can write, nobody edits ------------------------
create table if not exists patient_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  author_role text,
  note text not null,
  created_at timestamptz not null default now()
);
alter table patient_notes enable row level security;
drop policy if exists "view notes" on patient_notes;
create policy "view notes" on patient_notes for select using (can_view_patient(patient_id));
drop policy if exists "write notes" on patient_notes;
create policy "write notes" on patient_notes for insert with check (can_view_patient(patient_id) and author_id = auth.uid());
drop policy if exists "admin deletes notes" on patient_notes;
create policy "admin deletes notes" on patient_notes for delete using (is_admin());

-- 6. Activity log (admin reads everything anyone typed or changed) -------------------------
create table if not exists activity_log (
  id bigserial primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_role text,
  patient_id uuid,
  patient_name text,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
alter table activity_log enable row level security;
drop policy if exists "admin reads activity" on activity_log;
create policy "admin reads activity" on activity_log for select using (is_admin());

create or replace function log_activity(p_patient uuid, p_action text, p_detail text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a_name text;
  a_role text;
begin
  if auth.uid() is null then
    return;
  end if;
  select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), role
    into a_name, a_role from staff_accounts where user_id = auth.uid();
  insert into activity_log (actor_id, actor_name, actor_role, patient_id, patient_name, action, detail)
  values (
    auth.uid(),
    coalesce(a_name, (select email::text from auth.users where id = auth.uid())),
    a_role,
    p_patient,
    (select full_name from patients where id = p_patient),
    p_action,
    p_detail
  );
end;
$$;

create or replace function log_care_plan_print(p_patient uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_view_patient(p_patient) then
    raise exception 'No access to this patient.';
  end if;
  perform log_activity(p_patient, 'printed the care plan', null);
end;
$$;

create or replace function trg_log_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  summary text;
begin
  select string_agg(
    initcap(k) || ': ' || case v when '0' then 'None' when '1' then 'Mild' when '2' then 'Moderate' when '3' then 'Severe' else v end, ', ')
    into summary from jsonb_each_text(new.symptoms) as t(k, v);
  perform log_activity(
    new.patient_id,
    case when tg_op = 'INSERT' then 'recorded a symptom check-in' else 'updated a symptom check-in' end,
    summary || coalesce('. Onset: ' || nullif(new.onset_note, ''), '') || coalesce('. Note: ' || nullif(new.notes, ''), '')
  );
  return new;
end;
$$;
drop trigger if exists log_checkin on checkins;
create trigger log_checkin after insert or update on checkins for each row execute function trg_log_checkin();

create or replace function trg_log_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_activity(new.patient_id, 'wrote a wellbeing note', new.note);
  return new;
end;
$$;
drop trigger if exists log_note on patient_notes;
create trigger log_note after insert on patient_notes for each row execute function trg_log_note();

create or replace function trg_log_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform log_activity(old.patient_id, 'deleted an appointment', old.doctor || ' on ' || to_char(old.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');
    return old;
  end if;
  perform log_activity(
    new.patient_id,
    case when tg_op = 'INSERT' then 'added an appointment' else 'changed an appointment' end,
    new.doctor || ' on ' || to_char(new.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC, ' || new.address
      || coalesce('. Notes: ' || nullif(new.notes, ''), '')
  );
  return new;
end;
$$;
drop trigger if exists log_appointment on appointments;
create trigger log_appointment after insert or update or delete on appointments for each row execute function trg_log_appointment();

create or replace function trg_log_patient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.profile is distinct from old.profile or new.full_name is distinct from old.full_name then
    perform log_activity(new.id, 'updated the patient profile', null);
  end if;
  return new;
end;
$$;
drop trigger if exists log_patient on patients;
create trigger log_patient after update on patients for each row execute function trg_log_patient();

create or replace function trg_log_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), user_id::text) || ' (' || role || ')'
    into who from staff_accounts where user_id = coalesce(new.user_id, old.user_id);
  if tg_op = 'DELETE' then
    perform log_activity(old.patient_id, 'removed access', who);
    return old;
  end if;
  perform log_activity(new.patient_id, 'gave access', who);
  return new;
end;
$$;
drop trigger if exists log_assignment on patient_assignments;
create trigger log_assignment after insert or delete on patient_assignments for each row execute function trg_log_assignment();

-- 7. Admin tools ---------------------------------------------------------------------------
create or replace function admin_list_accounts()
returns table (user_id uuid, email text, role text, first_name text, last_name text, company_id text,
               organisation text, job_title text, phone text, confirmed boolean, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  return query
    select u.id, u.email::text, s.role, s.first_name, s.last_name, s.company_id, s.organisation, s.job_title, s.phone,
           (u.email_confirmed_at is not null), u.created_at
    from auth.users u left join staff_accounts s on s.user_id = u.id
    order by u.created_at;
end;
$$;

create or replace function admin_delete_account(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot delete your own account.';
  end if;
  perform log_activity(null, 'deleted an account', (select coalesce(email::text, id::text) from auth.users where id = p_user));
  delete from auth.users where id = p_user;
end;
$$;

-- 8. Relatives join through a link the admin creates ----------------------------------------
create or replace function get_join_preview(p_token uuid)
returns table (patient_name text, invitee_name text, invitee_email text, relationship text, status text)
language sql security definer set search_path = public as $$
  select p.full_name, j.invitee_name, j.invitee_email, j.relationship, j.status
  from join_invitations j join patients p on p.id = j.patient_id
  where j.token = p_token
$$;
grant execute on function get_join_preview(uuid) to anon, authenticated;

create or replace function accept_join_invitation(p_token uuid, p_first text, p_last text, p_phone text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  inv join_invitations%rowtype;
  my_email text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept an invitation.';
  end if;
  select * into inv from join_invitations where token = p_token and status = 'pending';
  if not found then
    raise exception 'This invitation is invalid or has already been used.';
  end if;
  select email::text into my_email from auth.users where id = auth.uid();
  if lower(my_email) <> lower(inv.invitee_email) then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  insert into staff_accounts (user_id, role, first_name, last_name, phone, company_id, organisation)
  values (auth.uid(), 'relative', coalesce(nullif(trim(p_first), ''), inv.invitee_name), nullif(trim(p_last), ''), nullif(trim(p_phone), ''), null, '')
  on conflict (user_id) do nothing;

  insert into patient_assignments (patient_id, user_id, assigned_by)
  values (inv.patient_id, auth.uid(), inv.created_by)
  on conflict do nothing;

  update join_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
end;
$$;
grant execute on function accept_join_invitation(uuid, text, text, text) to authenticated;

-- 9. The sample patient, unassigned until an admin assigns them ------------------------------
insert into patients (full_name, profile)
select 'Walter Bennett', $json${"fullName":"Walter Bennett","dob":"1959-03-14","phone":"(508) 555-0123","strokeType":"Ischemic","strokeDate":"2026-08-10","emergencyName":"Margaret Bennett","emergencyRelationship":"Spouse","emergencyPhone":"(508) 555-0177","careProvider":"Dr. Priya Raman, Neurology","recoveryGoals":["Walk safely with a cane","Regain strength in the affected arm","Speak clearly and be easily understood","Keep blood sugar and blood pressure in range"],"address":"214 Maple Grove Lane, Worcester, MA 01602","livesWith":"Wife (Margaret)","gender":"Male","maritalStatus":"Married","workType":"Private sector","residence":"Urban","hypertension":false,"heartDisease":true,"avgGlucose":228.69,"bmi":36.6,"smokingStatus":"Formerly smoked","sampleRecord":true,"datasetSource":"Kaggle Stroke Prediction Dataset (fedesoriano), record id 9046"}$json$::jsonb
where not exists (select 1 from patients);
