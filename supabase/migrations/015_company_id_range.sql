-- Registration accepts only Company IDs C4XXXXX to C4XXXXX (C4XXXXX is the administrator).
-- Any other number, or an ID that is already registered, makes the sign-up fail and creates no account.
-- Sign-ups with no Company ID at all (family members joining through an invitation link) are still allowed.

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
    raise exception 'company_id_not_accepted';
  end if;
  if substring(cid from 2)::int not between 427535 and 427540 then
    raise exception 'company_id_not_accepted';
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
    -- Already registered: same answer as an invalid number, so the two can't be told apart.
    raise exception 'company_id_not_accepted';
  end;
  return new;
end;
$$;
