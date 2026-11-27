-- Staff accounts: organisation users who register with a Company ID
-- (C4XXXXX - C4XXXXX for this project). One Company ID per account.
create table if not exists staff_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id text not null unique,
  organisation text not null,
  first_name text,
  last_name text,
  job_title text,
  phone text,
  created_at timestamptz not null default now()
);

alter table staff_accounts enable row level security;

drop policy if exists "staff view own account" on staff_accounts;
create policy "staff view own account" on staff_accounts
  for select using (auth.uid() = user_id);

-- Which Company IDs in the allowed range are still free? Callable before
-- sign-up (no login yet), so it's a narrow security definer function.
create or replace function available_company_ids()
returns table (available_id text)
language sql security definer set search_path = public as $$
  select 'C' || n::text as available_id
  from generate_series(427535, 427545) as n
  where ('C' || n::text) not in (select sa.company_id from staff_accounts sa)
  order by n
$$;

grant execute on function available_company_ids() to anon, authenticated;

-- Log in with a Company ID: resolve it to the account's email so the app can
-- sign in with email + password. Only verified accounts resolve.
create or replace function get_login_email(p_company_id text)
returns text
language sql security definer set search_path = public as $$
  select u.email::text
  from staff_accounts sa
  join auth.users u on u.id = sa.user_id
  where sa.company_id = upper(trim(p_company_id))
    and u.email_confirmed_at is not null
  limit 1
$$;

grant execute on function get_login_email(text) to anon, authenticated;

-- When someone signs up with a company_id in their sign-up details, record it
-- (and enforce the allowed range + uniqueness). Sign-ups without a company_id
-- (e.g. caregivers accepting an invitation) are left alone.
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

  insert into staff_accounts (user_id, company_id, organisation, first_name, last_name, job_title, phone)
  values (
    new.id,
    cid,
    coalesce(new.raw_user_meta_data->>'organisation', ''),
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'job_title',
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_staff on auth.users;
create trigger on_auth_user_created_staff
  after insert on auth.users
  for each row execute function public.handle_new_staff();
