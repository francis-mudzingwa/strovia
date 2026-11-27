-- Birthdays, round two:
--  1. the card also lists birthdays that happened in the past week;
--  2. a birthday is required for caregivers and administrators (it can no longer be cleared for them);
--  3. a birthday typed on the registration form is carried over to the new account the first time they sign in.

-- 1. The most recent birthday before today (29 February is kept on 28 February in years without one) ----------------
create or replace function previous_birthday(p_month integer, p_day integer, p_today date)
returns date language plpgsql immutable as $$
declare
  y integer := extract(year from p_today);
  d date;
begin
  for i in 0..8 loop
    if p_month = 2 and p_day = 29 and (make_date(y - i, 3, 1) - make_date(y - i, 2, 1)) <> 29 then
      d := make_date(y - i, 2, 28);
    else
      d := make_date(y - i, p_month, p_day);
    end if;
    if d < p_today then return d; end if;
  end loop;
  return null;
end;
$$;

-- Upcoming birthdays (days_until 0 or more) and those from the past p_back days (days_until below 0, "turning" is the age they turned).
drop function if exists upcoming_birthdays(integer);
create or replace function upcoming_birthdays(p_days integer default 31, p_back integer default 7)
returns table (kind text, person_id uuid, name text, role text, on_date date, days_until integer, turning integer)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'America/New_York')::date as d),
  clients as (
    select 'client'::text as kind, p.id as person_id, p.full_name as name, null::text as role,
           (p.profile->>'dob')::date as born
    from patients p
    where is_staff() and can_view_patient(p.id) and p.archived_at is null
      and (p.profile->>'dob') ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  carers as (
    select 'carer'::text as kind, s.user_id as person_id,
           coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), 'Team member') as name,
           s.role as role, s.birthday_month, s.birthday_day
    from staff_accounts s
    where is_staff() and s.role in ('admin', 'caregiver') and s.approved and not coalesce(s.suspended, false)
      and s.birthday_month is not null
  ),
  both_kinds as (
    select kind, person_id, name, role, extract(month from born)::int as m, extract(day from born)::int as dd, extract(year from born)::int as born_year from clients
    union all
    select kind, person_id, name, role, birthday_month::int, birthday_day::int, null::int from carers
  ),
  dates as (
    select b.*, t.d as today, next_birthday(b.m, b.dd, t.d) as nxt, previous_birthday(b.m, b.dd, t.d) as prv
    from both_kinds b cross join today t
  ),
  picked as (
    select kind, person_id, name, role, born_year, today, nxt as on_date from dates
      where nxt is not null and nxt - today <= greatest(p_days, 0)
    union all
    select kind, person_id, name, role, born_year, today, prv from dates
      where prv is not null and today - prv <= greatest(p_back, 0)
  )
  select kind, person_id, name, role, on_date, (on_date - today)::integer,
         case when born_year is not null then (extract(year from on_date)::int - born_year) end
  from picked
  order by (on_date < today), case when on_date >= today then on_date end, on_date desc, name
$$;
revoke execute on function upcoming_birthdays(integer, integer) from public, anon;
grant execute on function upcoming_birthdays(integer, integer) to authenticated;

-- 2. Required for caregivers and administrators ---------------------------------------------------------------
create or replace function set_my_birthday(p_month integer, p_day integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if (p_month is null) <> (p_day is null) then
    raise exception 'Choose both a month and a day.';
  end if;
  select role into r from staff_accounts where user_id = auth.uid();
  if r is null then
    raise exception 'No account found.';
  end if;
  if p_month is null and r in ('admin', 'caregiver') then
    raise exception 'Your birthday is required.';
  end if;
  update staff_accounts set birthday_month = p_month, birthday_day = p_day where user_id = auth.uid();
end;
$$;

create or replace function admin_set_birthday(p_user uuid, p_month integer, p_day integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if (p_month is null) <> (p_day is null) then
    raise exception 'Choose both a month and a day.';
  end if;
  select role into r from staff_accounts where user_id = p_user;
  if p_month is null and r in ('admin', 'caregiver') then
    raise exception 'A birthday is required for caregivers and administrators.';
  end if;
  update staff_accounts set birthday_month = p_month, birthday_day = p_day where user_id = p_user;
end;
$$;

-- 3. The birthday typed on the registration form -----------------------------------------------------------------
-- Registration stores what was typed in the account's sign-up details. The first time they sign in, copy a valid month and
-- day into their profile (only when they have none yet). Returns the birthday now on file, or nothing.
create or replace function claim_signup_birthday()
returns table (birthday_month smallint, birthday_day smallint)
language plpgsql security definer set search_path = public as $$
declare
  m_text text;
  d_text text;
  m integer;
  d integer;
begin
  if auth.uid() is null then
    return;
  end if;
  if exists (select 1 from staff_accounts where user_id = auth.uid() and staff_accounts.birthday_month is not null) then
    return query select s.birthday_month, s.birthday_day from staff_accounts s where s.user_id = auth.uid();
    return;
  end if;
  select u.raw_user_meta_data->>'birthday_month', u.raw_user_meta_data->>'birthday_day' into m_text, d_text
    from auth.users u where u.id = auth.uid();
  if m_text ~ '^\d{1,2}$' and d_text ~ '^\d{1,2}$' then
    m := m_text::integer;
    d := d_text::integer;
    begin
      update staff_accounts set birthday_month = m, birthday_day = d where user_id = auth.uid() and staff_accounts.birthday_month is null;
    exception when others then
      return;
    end;
    return query select s.birthday_month, s.birthday_day from staff_accounts s where s.user_id = auth.uid();
  end if;
end;
$$;
revoke execute on function claim_signup_birthday() from public, anon;
grant execute on function claim_signup_birthday() to authenticated;
