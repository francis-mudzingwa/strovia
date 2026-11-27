-- Stop the register / login screens from leaking information.
--  * Registration never fails because of the Company ID: an invalid or already-used ID simply
--    creates an account with no role (an admin can delete it), so nobody can probe which IDs exist.
--  * The public "which IDs are free" list and the "Company ID -> email" lookup are removed.
--    Company-ID login now goes through the company-login edge function, which never reveals an email.

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
  )
  on conflict do nothing;
  return new;
end;
$$;

drop function if exists available_company_ids();
drop function if exists get_login_email(text);

-- Failed Company-ID logins, so one address can't hammer one ID. Only the edge function touches it.
create table if not exists login_attempts (
  id bigserial primary key,
  ip text not null,
  identifier text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_lookup_idx on login_attempts (ip, identifier, at);
alter table login_attempts enable row level security;
