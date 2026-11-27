-- A second (or third, etc.) administrator: an existing administrator can promote an approved caregiver to full
-- administrator, and demote one back, from Manage Accounts. There must always be at least one administrator, and
-- nobody can remove their own access.
--
-- Restricted to caregivers (not family proxies), on purpose: every caregiver already has a Company ID, and the
-- emailed sign-in code (migration 035) only exists on the Company ID login path. Promoting an email-only family
-- proxy would create an account that the code step could never actually reach, and no way back in.
--
-- While in here: the "please log in with your Company ID" rule (migration 014) only ever checked caregivers,
-- because at the time only caregivers had a Company ID. An administrator has one too but was never covered by that
-- check, so typing their email instead by habit failed with a bare, confusing refusal, and no code was ever sent
-- (the code is only issued by the company-login function, which only runs for something that looks like a Company
-- ID). Widened to cover anyone with a Company ID, admin included.

create or replace function admin_promote_to_admin(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  acct staff_accounts%rowtype;
  who text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  select * into acct from staff_accounts where user_id = p_user;
  if not found or acct.role <> 'caregiver' or not acct.approved or acct.suspended then
    raise exception 'Only an approved, active caregiver can be made an administrator.';
  end if;
  update staff_accounts set role = 'admin' where user_id = p_user;
  who := coalesce(nullif(trim(coalesce(acct.first_name, '') || ' ' || coalesce(acct.last_name, '')), ''), (select email::text from auth.users where id = p_user));
  perform log_activity(null, 'made an account an administrator', who);
end;
$$;
revoke execute on function admin_promote_to_admin(uuid) from public, anon;
grant execute on function admin_promote_to_admin(uuid) to authenticated;

create or replace function admin_demote_admin(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  acct staff_accounts%rowtype;
  admin_count int;
  who text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot remove your own administrator access.';
  end if;
  select * into acct from staff_accounts where user_id = p_user;
  if not found or acct.role <> 'admin' then
    raise exception 'That account is not an administrator.';
  end if;
  select count(*) into admin_count from staff_accounts where role = 'admin';
  if admin_count <= 1 then
    raise exception 'There must always be at least one administrator.';
  end if;
  update staff_accounts set role = 'caregiver' where user_id = p_user;
  who := coalesce(nullif(trim(coalesce(acct.first_name, '') || ' ' || coalesce(acct.last_name, '')), ''), (select email::text from auth.users where id = p_user));
  perform log_activity(null, 'removed administrator access', who);
end;
$$;
revoke execute on function admin_demote_admin(uuid) from public, anon;
grant execute on function admin_demote_admin(uuid) to authenticated;

create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (event->>'user_id')::uuid;
  method text := coalesce(event->>'authentication_method', '');
  must_use_company_id boolean;
  must_use_code boolean;
  permitted boolean;
  is_code_verification boolean := false;
  label text;
begin
  if method = 'token_refresh' then
    return event;
  end if;

  delete from login_permits where expires_at < now();

  if method = 'password' then
    select (company_id is not null), (role = 'admin' and login_code_enabled)
      into must_use_company_id, must_use_code
      from staff_accounts where user_id = uid;

    -- One permit covers both rules for an account with a Company ID: company-login withholds it deliberately
    -- when a code is still owed (that absence IS the signal that tells company-login the password was right),
    -- so the two rules cannot each demand and consume their own permit — there is only ever one to find.
    if coalesce(must_use_company_id, false) or coalesce(must_use_code, false) then
      delete from login_permits where user_id = uid returning true into permitted;
      if not coalesce(permitted, false) then
        if coalesce(must_use_code, false) then
          return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'A sign-in code has been emailed. Enter it to continue.'));
        else
          return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Please log in with your Company ID.'));
        end if;
      end if;
    end if;
  end if;

  if method = 'otp' then
    delete from login_permits where user_id = uid returning true into is_code_verification;
    is_code_verification := coalesce(is_code_verification, false);
  end if;

  begin
    select coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), u.email::text)
      into label from auth.users u left join staff_accounts s on s.user_id = u.id where u.id = uid;
    insert into sign_in_log (user_id, actor_label, event, method)
    values (uid, label, 'signed in',
      case
        when method = 'password' then 'password'
        when method = 'recovery' then 'recovery'
        when method = 'otp' and is_code_verification then 'login code'
        else 'email link'
      end);
  exception when others then
    null;
  end;

  return event;
end;
$$;
