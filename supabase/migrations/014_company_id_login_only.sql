-- Caregivers must log in with their Company ID; only family members (no Company ID) may use their email.
-- Enforced by a Supabase Auth "custom access token" hook, so it holds even for someone calling the API directly.
--
-- How: the company-login edge function writes a short-lived permit for the account just before it signs in.
-- The hook lets a caregiver's password sign-in through only if it can consume that permit. Refreshing a
-- session, password recovery and email links are not password sign-ins, so they are unaffected.
-- Administrators are exempt so a mistake here can never lock out the only admin.

create table if not exists login_permits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
alter table login_permits enable row level security;

create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (event->>'user_id')::uuid;
  must_use_company_id boolean;
  permitted boolean;
begin
  if coalesce(event->>'authentication_method', '') <> 'password' then
    return event;
  end if;

  select exists (
    select 1 from staff_accounts where user_id = uid and role = 'caregiver' and company_id is not null
  ) into must_use_company_id;
  if not must_use_company_id then
    return event;
  end if;

  delete from login_permits where expires_at < now();
  delete from login_permits where user_id = uid returning true into permitted;
  if permitted then
    return event;
  end if;

  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Please log in with your Company ID.'));
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function custom_access_token_hook(jsonb) from authenticated, anon, public;
