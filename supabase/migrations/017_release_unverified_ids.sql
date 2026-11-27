-- A Company ID held by a caregiver who never verified their email is released after one hour, so an
-- unfinished registration (for example a verification email that never arrived) can never lock the
-- real person out. A verified holder, an approved caregiver and the administrator are never affected.

create or replace function handle_new_staff()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid text;
  stale uuid;
begin
  cid := upper(trim(coalesce(new.raw_user_meta_data->>'company_id', '')));
  if cid = '' then
    return new;
  end if;

  if cid !~ '^C[0-9]{6}$' then
    raise exception 'company_id_not_accepted';
  end if;
  if substring(cid from 2)::int not between 427535 and 427540 then
    raise exception 'company_id_not_accepted';
  end if;

  select s.user_id into stale
  from staff_accounts s join auth.users u on u.id = s.user_id
  where s.company_id = cid
    and s.role = 'caregiver'
    and u.email_confirmed_at is null
    and u.created_at < now() - interval '1 hour'
  limit 1;
  if stale is not null then
    delete from auth.users where id = stale;
  end if;

  begin
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
    );
  exception when unique_violation then
    raise exception 'company_id_not_accepted';
  end;
  return new;
end;
$$;
