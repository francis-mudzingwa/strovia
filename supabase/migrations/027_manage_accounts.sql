-- Manage Accounts, made complete: suspend/reactivate, edit a person's details, archive instead of delete,
-- a primary caregiver, moving a caregiver's patients to someone else, and invitations that expire.
-- Every action here is administrator-only and is written to the audit trail.

-- 1. Suspension: the person keeps their record and history but cannot get in --------------------------
alter table staff_accounts add column if not exists suspended boolean not null default false;
alter table staff_accounts add column if not exists suspended_at timestamptz;

-- 2. Archiving: a patient is hidden from everyone except the administrator, and nothing is deleted -------
alter table patients add column if not exists archived_at timestamptz;
alter table patients add column if not exists archived_by uuid references auth.users(id) on delete set null;

-- 3. A primary caregiver per patient (at most one) ------------------------------------------------
alter table patient_assignments add column if not exists is_primary boolean not null default false;
create unique index if not exists one_primary_per_patient on patient_assignments (patient_id) where is_primary;

create or replace function patient_is_archived(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from patients where id = p and archived_at is not null)
$$;

-- Access to a patient: the administrator always; everyone else only while the patient is not archived.
create or replace function can_view_patient(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from patient_assignments pa
    join staff_accounts s on s.user_id = pa.user_id
    join patients x on x.id = pa.patient_id
    where pa.patient_id = p and pa.user_id = auth.uid() and s.approved and x.archived_at is null
  )
$$;
create or replace function can_edit_patient(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from patient_assignments pa
    join staff_accounts s on s.user_id = pa.user_id
    join patients x on x.id = pa.patient_id
    where pa.patient_id = p and pa.user_id = auth.uid() and s.approved and x.archived_at is null
  )
$$;

drop policy if exists "read shifts" on shifts;
create policy "read shifts" on shifts for select
  using (is_admin() or (caregiver_id = auth.uid() and is_approved_caregiver() and not patient_is_archived(patient_id)));

-- A patient can only be deleted for good once archived (a deliberate second step), and it is recorded.
drop policy if exists "admin removes patients" on patients;
create policy "admin removes patients" on patients for delete using (is_admin() and archived_at is not null);

create or replace function trg_log_patient_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_activity(null, 'permanently deleted a patient', old.full_name);
  return old;
end;
$$;
drop trigger if exists log_patient_delete on patients;
create trigger log_patient_delete before delete on patients for each row execute function trg_log_patient_delete();

-- 4. The login gate: a suspended account is refused at sign-in and cannot refresh a session -------------
-- (Everything else is unchanged from before: caregivers must use their Company ID, and sign-ins are logged.)
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (event->>'user_id')::uuid;
  method text := coalesce(event->>'authentication_method', '');
  must_use_company_id boolean;
  permitted boolean;
  label text;
begin
  if exists (select 1 from staff_accounts where user_id = uid and suspended) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This account has been suspended. Please contact your administrator.'));
  end if;

  if method = 'token_refresh' then
    return event;
  end if;

  if method = 'password' then
    select exists (
      select 1 from staff_accounts where user_id = uid and role = 'caregiver' and company_id is not null
    ) into must_use_company_id;
    if must_use_company_id then
      delete from login_permits where expires_at < now();
      delete from login_permits where user_id = uid returning true into permitted;
      if not coalesce(permitted, false) then
        return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Please log in with your Company ID.'));
      end if;
    end if;
  end if;

  begin
    select coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), u.email::text)
      into label from auth.users u left join staff_accounts s on s.user_id = u.id where u.id = uid;
    insert into sign_in_log (user_id, actor_label, event, method)
    values (uid, label, 'signed in', case when method = 'password' then 'password' when method = 'recovery' then 'recovery' else 'email link' end);
  exception when others then
    null;
  end;

  return event;
end;
$$;
grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function custom_access_token_hook(jsonb) from authenticated, anon, public;

-- 5. The account list now says who is suspended ----------------------------------------------------
drop function if exists admin_list_accounts();
create or replace function admin_list_accounts()
returns table (user_id uuid, email text, role text, first_name text, last_name text, company_id text,
               organisation text, job_title text, phone text, confirmed boolean, approved boolean,
               created_at timestamptz, last_sign_in_at timestamptz, suspended boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  return query
    select u.id, u.email::text, s.role, s.first_name, s.last_name, s.company_id, s.organisation, s.job_title, s.phone,
           (u.email_confirmed_at is not null), coalesce(s.approved, false), u.created_at, u.last_sign_in_at,
           coalesce(s.suspended, false)
    from auth.users u left join staff_accounts s on s.user_id = u.id
    order by u.created_at;
end;
$$;

-- 6. Suspend and reactivate -------------------------------------------------------------------------
create or replace function admin_set_suspended(p_user uuid, p_suspend boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  acct staff_accounts%rowtype;
  who text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot suspend your own account.';
  end if;
  select * into acct from staff_accounts where user_id = p_user;
  if not found then
    raise exception 'That account has no role.';
  end if;
  if acct.role = 'admin' then
    raise exception 'Administrator accounts cannot be suspended here.';
  end if;
  who := coalesce(nullif(trim(coalesce(acct.first_name, '') || ' ' || coalesce(acct.last_name, '')), ''), (select email::text from auth.users where id = p_user));
  if p_suspend then
    if acct.suspended then raise exception 'That account is already suspended.'; end if;
    if not acct.approved then raise exception 'Only approved accounts can be suspended. Reject or delete an account that is waiting for approval.'; end if;
    -- approved = false is what removes access to every patient, in the database itself, at once.
    update staff_accounts set suspended = true, suspended_at = now(), approved = false where user_id = p_user;
    delete from push_subscriptions where user_id = p_user;
    perform log_activity(null, 'suspended an account', who);
  else
    if not acct.suspended then raise exception 'That account is not suspended.'; end if;
    update staff_accounts set suspended = false, suspended_at = null, approved = true where user_id = p_user;
    perform log_activity(null, 'reactivated an account', who);
  end if;
end;
$$;

-- 7. Edit a person's details ---------------------------------------------------------------------
create or replace function admin_update_account(p_user uuid, p_first text, p_last text, p_job_title text, p_phone text, p_organisation text, p_company_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  acct staff_accounts%rowtype;
  cid text;
  nfirst text := nullif(trim(coalesce(p_first, '')), '');
  nlast text := nullif(trim(coalesce(p_last, '')), '');
  njob text := nullif(trim(coalesce(p_job_title, '')), '');
  nphone text := nullif(trim(coalesce(p_phone, '')), '');
  norg text := coalesce(trim(p_organisation), '');
  changes text[] := '{}';
  who text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  select * into acct from staff_accounts where user_id = p_user;
  if not found then
    raise exception 'That account has no role.';
  end if;
  if acct.role = 'admin' and p_user <> auth.uid() then
    raise exception 'An administrator can only change their own details.';
  end if;
  if nfirst is null then
    raise exception 'A first name is required.';
  end if;
  if length(coalesce(nfirst, '') || coalesce(nlast, '') || coalesce(njob, '') || coalesce(nphone, '') || norg) > 500 then
    raise exception 'Those details are too long.';
  end if;

  cid := acct.company_id;
  if acct.role = 'caregiver' and nullif(trim(coalesce(p_company_id, '')), '') is not null then
    cid := upper(trim(p_company_id));
    if cid !~ '^C[0-9]{6}$' or substring(cid from 2)::int not between 427535 and 427540 or cid = 'C4XXXXX' then
      raise exception 'That Company ID cannot be used. Caregiver IDs run from C4XXXXX to C4XXXXX.';
    end if;
    if cid is distinct from acct.company_id and exists (select 1 from staff_accounts where company_id = cid and user_id <> p_user) then
      raise exception 'That Company ID is already in use.';
    end if;
  end if;

  if nfirst is distinct from acct.first_name or nlast is distinct from acct.last_name then changes := array_append(changes, 'name'); end if;
  if njob is distinct from acct.job_title then changes := array_append(changes, 'job title'); end if;
  if nphone is distinct from acct.phone then changes := array_append(changes, 'phone number'); end if;
  if norg is distinct from acct.organisation then changes := array_append(changes, 'organisation'); end if;
  if cid is distinct from acct.company_id then changes := array_append(changes, 'Company ID (' || coalesce(acct.company_id, 'none') || ' to ' || cid || ')'); end if;

  update staff_accounts
  set first_name = nfirst, last_name = nlast, job_title = njob, phone = nphone, organisation = norg, company_id = cid
  where user_id = p_user;

  if cardinality(changes) > 0 then
    who := coalesce(nullif(trim(coalesce(acct.first_name, '') || ' ' || coalesce(acct.last_name, '')), ''), (select email::text from auth.users where id = p_user));
    perform log_activity(null, 'edited an account', who || ': ' || array_to_string(changes, ', '));
  end if;
end;
$$;

-- 8. Primary caregiver -----------------------------------------------------------------------------
create or replace function admin_set_primary(p_patient uuid, p_user uuid, p_primary boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if not exists (select 1 from patient_assignments a join staff_accounts s on s.user_id = a.user_id
                 where a.patient_id = p_patient and a.user_id = p_user and s.role = 'caregiver') then
    raise exception 'Only a caregiver assigned to this patient can be the primary caregiver.';
  end if;
  who := (select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'A caregiver') from staff_accounts where user_id = p_user);
  if p_primary then
    update patient_assignments set is_primary = false where patient_id = p_patient and is_primary;
    update patient_assignments set is_primary = true where patient_id = p_patient and user_id = p_user;
    perform log_activity(p_patient, 'set the primary caregiver', who);
  else
    update patient_assignments set is_primary = false where patient_id = p_patient and user_id = p_user;
    perform log_activity(p_patient, 'removed the primary caregiver', who);
  end if;
end;
$$;

-- 9. Move a caregiver's patients (and shifts) to another caregiver in one step --------------------------
-- All or nothing: if the new caregiver already has a shift at one of those times, nothing changes.
create or replace function admin_reassign_caregiver(p_from uuid, p_to uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  primaries uuid[];
  moved_patients int;
  moved_shifts int;
  from_name text;
  to_name text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if p_from = p_to then
    raise exception 'Choose two different caregivers.';
  end if;
  if not exists (select 1 from staff_accounts where user_id = p_from and role = 'caregiver') then
    raise exception 'The caregiver to move patients from was not found.';
  end if;
  if not exists (select 1 from staff_accounts where user_id = p_to and role = 'caregiver' and approved and not suspended) then
    raise exception 'The caregiver to move patients to must be approved and active.';
  end if;

  select array_agg(patient_id) into primaries from patient_assignments where user_id = p_from and is_primary;
  select count(*) into moved_patients from patient_assignments where user_id = p_from;

  -- 1) the new caregiver gets access to each patient
  insert into patient_assignments (patient_id, user_id, assigned_by, is_primary)
  select patient_id, p_to, auth.uid(), false from patient_assignments where user_id = p_from
  on conflict (patient_id, user_id) do nothing;

  -- 2) shifts move across (the shift rules run for each: an overlap stops the whole move)
  with moved as (update shifts set caregiver_id = p_to where caregiver_id = p_from returning 1)
  select count(*) into moved_shifts from moved;

  -- 3) the old caregiver no longer has these patients
  delete from patient_assignments where user_id = p_from;

  -- 4) the primary marker follows
  if primaries is not null then
    update patient_assignments set is_primary = true where user_id = p_to and patient_id = any (primaries);
  end if;

  from_name := (select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'A caregiver') from staff_accounts where user_id = p_from);
  to_name := (select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'a caregiver') from staff_accounts where user_id = p_to);
  perform log_activity(null, 'moved a caregiver''s patients', from_name || ' to ' || to_name || ': ' || moved_patients || ' patients, ' || moved_shifts || ' shifts');
  return jsonb_build_object('patients', moved_patients, 'shifts', moved_shifts);
end;
$$;

-- 10. Archive and restore a patient ----------------------------------------------------------------
create or replace function admin_archive_patient(p_patient uuid, p_archive boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if not exists (select 1 from patients where id = p_patient) then
    raise exception 'That patient was not found.';
  end if;
  if p_archive then
    update patients set archived_at = now(), archived_by = auth.uid() where id = p_patient and archived_at is null;
    perform log_activity(p_patient, 'archived a patient', null);
  else
    update patients set archived_at = null, archived_by = null where id = p_patient and archived_at is not null;
    perform log_activity(p_patient, 'restored a patient', null);
  end if;
end;
$$;

-- 11. Invitations expire after 7 days ---------------------------------------------------------------
create or replace function get_join_preview(p_token uuid)
returns table (patient_name text, invitee_name text, invitee_email text, relationship text, status text)
language sql security definer set search_path = public as $$
  select p.full_name, j.invitee_name, j.invitee_email, j.relationship,
         case when j.status = 'pending' and j.created_at < now() - interval '7 days' then 'expired' else j.status end
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
  if inv.created_at < now() - interval '7 days' then
    raise exception 'This invitation has expired. Ask your administrator to send a new one.';
  end if;
  select email::text into my_email from auth.users where id = auth.uid();
  if lower(my_email) <> lower(inv.invitee_email) then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  insert into staff_accounts (user_id, role, first_name, last_name, phone, company_id, organisation, approved)
  values (auth.uid(), 'relative', coalesce(nullif(trim(p_first), ''), inv.invitee_name), nullif(trim(p_last), ''), nullif(trim(p_phone), ''), null, '', true)
  on conflict (user_id) do nothing;

  insert into patient_assignments (patient_id, user_id, assigned_by)
  values (inv.patient_id, auth.uid(), inv.created_by)
  on conflict do nothing;

  update join_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
end;
$$;
grant execute on function accept_join_invitation(uuid, text, text, text) to authenticated;

-- 12. The Home page's care team: names, roles and who is primary -----------------------------------------
drop function if exists home_people();
create or replace function home_people()
returns table (patient_id uuid, user_id uuid, name text, role text, on_team boolean, is_primary boolean)
language sql stable security definer set search_path = public as $$
  with visible as (select p.id from patients p where can_view_patient(p.id) and p.archived_at is null),
  ppl as (
    select pa.patient_id, pa.user_id, true as on_team, pa.is_primary
      from patient_assignments pa join visible v on v.id = pa.patient_id
    union all
    select c.patient_id, c.recorded_by, false, false
      from checkins c join visible v on v.id = c.patient_id
      where c.recorded_by is not null and c.entry_date >= current_date - 14
    union all
    select sa.patient_id, sa.recorded_by, false, false
      from symptom_actions sa join visible v on v.id = sa.patient_id
      where sa.recorded_by is not null and sa.entry_date >= current_date - 14
  )
  select p.patient_id, p.user_id,
         coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), 'Team member'),
         s.role,
         bool_or(p.on_team),
         bool_or(p.is_primary)
  from ppl p join staff_accounts s on s.user_id = p.user_id and s.approved
  group by p.patient_id, p.user_id, s.first_name, s.last_name, s.role
$$;
revoke execute on function home_people() from public, anon;
grant execute on function home_people() to authenticated;

-- Approving is for people waiting for approval. A suspended account is brought back with Reactivate.
create or replace function admin_approve_account(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if exists (select 1 from staff_accounts where user_id = p_user and suspended) then
    raise exception 'That account is suspended. Use Reactivate instead.';
  end if;
  update staff_accounts set approved = true where user_id = p_user;
  if not found then
    raise exception 'That account has no role to approve.';
  end if;
  perform log_activity(null, 'approved an account', (select coalesce(email::text, id::text) from auth.users where id = p_user));
end;
$$;

-- 13. Nobody but the administrator can run the new administrator tools ----------------------------------
revoke execute on function admin_set_suspended(uuid, boolean) from public, anon;
revoke execute on function admin_update_account(uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function admin_set_primary(uuid, uuid, boolean) from public, anon;
revoke execute on function admin_reassign_caregiver(uuid, uuid) from public, anon;
revoke execute on function admin_archive_patient(uuid, boolean) from public, anon;
revoke execute on function admin_list_accounts() from public, anon;
grant execute on function admin_set_suspended(uuid, boolean) to authenticated;
grant execute on function admin_update_account(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function admin_set_primary(uuid, uuid, boolean) to authenticated;
grant execute on function admin_reassign_caregiver(uuid, uuid) to authenticated;
grant execute on function admin_archive_patient(uuid, boolean) to authenticated;
grant execute on function admin_list_accounts() to authenticated;
