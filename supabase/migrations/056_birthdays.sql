-- Birthdays in the next month, for clients (from their date of birth) and carers (an optional day and month they or an
-- administrator enter; no year is kept). Only caregivers and administrators are shown them.

-- 1. A carer's birthday: month and day only ---------------------------------------------------------------
alter table staff_accounts add column if not exists birthday_month smallint;
alter table staff_accounts add column if not exists birthday_day smallint;
alter table staff_accounts drop constraint if exists staff_birthday_valid;
alter table staff_accounts add constraint staff_birthday_valid check (
  (birthday_month is null and birthday_day is null)
  or (birthday_month between 1 and 12 and birthday_day between 1 and 31 and make_date(2000, birthday_month, birthday_day) is not null)
);

create or replace function set_my_birthday(p_month integer, p_day integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if (p_month is null) <> (p_day is null) then
    raise exception 'Choose both a month and a day.';
  end if;
  update staff_accounts set birthday_month = p_month, birthday_day = p_day where user_id = auth.uid();
  if not found then
    raise exception 'No account found.';
  end if;
end;
$$;
revoke execute on function set_my_birthday(integer, integer) from public, anon;
grant execute on function set_my_birthday(integer, integer) to authenticated;

create or replace function admin_set_birthday(p_user uuid, p_month integer, p_day integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if (p_month is null) <> (p_day is null) then
    raise exception 'Choose both a month and a day.';
  end if;
  update staff_accounts set birthday_month = p_month, birthday_day = p_day where user_id = p_user;
end;
$$;
revoke execute on function admin_set_birthday(uuid, integer, integer) from public, anon;
grant execute on function admin_set_birthday(uuid, integer, integer) to authenticated;

-- The administrator's accounts list carries the birthday too.
drop function if exists admin_list_accounts();
create or replace function admin_list_accounts()
returns table (user_id uuid, email text, role text, first_name text, last_name text, company_id text,
               organisation text, job_title text, phone text, confirmed boolean, approved boolean,
               created_at timestamptz, last_sign_in_at timestamptz, suspended boolean, avatar_path text,
               birthday_month smallint, birthday_day smallint)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  return query
    select u.id, u.email::text, s.role, s.first_name, s.last_name, s.company_id, s.organisation, s.job_title, s.phone,
           (u.email_confirmed_at is not null), coalesce(s.approved, false), u.created_at, u.last_sign_in_at,
           coalesce(s.suspended, false), s.avatar_path, s.birthday_month, s.birthday_day
    from auth.users u left join staff_accounts s on s.user_id = u.id
    order by u.created_at;
end;
$$;
revoke execute on function admin_list_accounts() from public, anon;
grant execute on function admin_list_accounts() to authenticated;

-- 2. Who has a birthday soon -------------------------------------------------------------------------------
-- The next time a month/day comes round on or after `today` (29 February is kept on 28 February in years without one).
create or replace function next_birthday(p_month integer, p_day integer, p_today date)
returns date language plpgsql immutable as $$
declare
  y integer := extract(year from p_today);
  d date;
begin
  for i in 0..8 loop
    if p_month = 2 and p_day = 29 and (make_date(y + i, 3, 1) - make_date(y + i, 2, 1)) <> 29 then
      d := make_date(y + i, 2, 28);
    else
      d := make_date(y + i, p_month, p_day);
    end if;
    if d >= p_today then return d; end if;
  end loop;
  return null;
end;
$$;

create or replace function upcoming_birthdays(p_days integer default 31)
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
  )
  select b.kind, b.person_id, b.name, b.role, nb.d as on_date, (nb.d - t.d)::integer as days_until,
         case when b.born_year is not null then (extract(year from nb.d)::int - b.born_year) end
  from both_kinds b
  cross join today t
  cross join lateral (select next_birthday(b.m, b.dd, t.d) as d) nb
  where nb.d is not null and nb.d - t.d <= greatest(p_days, 0)
  order by nb.d, b.name
$$;
revoke execute on function upcoming_birthdays(integer) from public, anon;
grant execute on function upcoming_birthdays(integer) to authenticated;
