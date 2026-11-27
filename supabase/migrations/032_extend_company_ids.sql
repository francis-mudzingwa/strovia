-- Extends the accepted Company ID range from C4XXXXX-C4XXXXX to C4XXXXX-C4XXXXX: C4XXXXX stays the administrator,
-- C4XXXXX-C4XXXXX are caregiver IDs (15 in total, was 5). The range is checked in two places: at registration
-- (keeping the release of an unverified ID after an hour, added in migration 017) and when the administrator
-- edits an account's Company ID (added in migration 027). Both are reproduced here verbatim except for the range.

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
  if substring(cid from 2)::int not between 427535 and 427550 then
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
    -- Already registered: same answer as an invalid number, so the two can't be told apart.
    raise exception 'company_id_not_accepted';
  end;
  return new;
end;
$$;

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
    if cid !~ '^C[0-9]{6}$' or substring(cid from 2)::int not between 427535 and 427550 or cid = 'C4XXXXX' then
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
