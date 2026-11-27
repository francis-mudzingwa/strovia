-- Admin approval: a newly registered caregiver has no access until an administrator approves them.
-- Only the administrator's own Company ID (C4XXXXX) is approved automatically; everyone else waits.
-- Family members added through an admin-created invitation are approved when they accept it.

alter table staff_accounts add column if not exists approved boolean not null default false;
-- Accounts that already exist: the administrator and family members (who were added by an admin) keep working;
-- any caregiver who registered before this rule has to be approved like everyone else.
update staff_accounts set approved = true where role in ('admin', 'relative');

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and approved from staff_accounts where user_id = auth.uid()), false)
$$;

create or replace function can_view_patient(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from patient_assignments pa
    join staff_accounts s on s.user_id = pa.user_id
    where pa.patient_id = p and pa.user_id = auth.uid() and s.approved
  )
$$;

create or replace function can_edit_patient(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from patient_assignments pa
    join staff_accounts s on s.user_id = pa.user_id
    where pa.patient_id = p and pa.user_id = auth.uid() and s.approved
  )
$$;

create or replace function handle_new_staff()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid text;
begin
  cid := upper(trim(coalesce(new.raw_user_meta_data->>'company_id', '')));
  if cid = '' or cid !~ '^C[0-9]{6}$' or substring(cid from 2)::int not between 427535 and 427545 then
    return new;
  end if;

  insert into staff_accounts (user_id, company_id, organisation, first_name, last_name, job_title, phone, role, approved)
  values (
    new.id,
    cid,
    coalesce(new.raw_user_meta_data->>'organisation', ''),
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'job_title',
    new.raw_user_meta_data->>'phone',
    case when cid = 'C4XXXXX' then 'admin' else 'caregiver' end,
    cid = 'C4XXXXX'
  )
  on conflict do nothing;
  return new;
end;
$$;

drop function if exists admin_list_accounts();
create or replace function admin_list_accounts()
returns table (user_id uuid, email text, role text, first_name text, last_name text, company_id text,
               organisation text, job_title text, phone text, confirmed boolean, approved boolean, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  return query
    select u.id, u.email::text, s.role, s.first_name, s.last_name, s.company_id, s.organisation, s.job_title, s.phone,
           (u.email_confirmed_at is not null), coalesce(s.approved, false), u.created_at
    from auth.users u left join staff_accounts s on s.user_id = u.id
    order by u.created_at;
end;
$$;

create or replace function admin_approve_account(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  update staff_accounts set approved = true where user_id = p_user;
  if not found then
    raise exception 'That account has no role to approve.';
  end if;
  perform log_activity(null, 'approved an account', (select coalesce(email::text, id::text) from auth.users where id = p_user));
end;
$$;

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

  -- The administrator created this invitation, so the family member is approved from the start.
  insert into staff_accounts (user_id, role, first_name, last_name, phone, company_id, organisation, approved)
  values (auth.uid(), 'relative', coalesce(nullif(trim(p_first), ''), inv.invitee_name), nullif(trim(p_last), ''), nullif(trim(p_phone), ''), null, '', true)
  on conflict (user_id) do nothing;

  insert into patient_assignments (patient_id, user_id, assigned_by)
  values (inv.patient_id, auth.uid(), inv.created_by)
  on conflict do nothing;

  update join_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
end;
$$;
