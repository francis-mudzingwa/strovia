-- A 6-digit code emailed to the administrator on every sign-in, as a second factor on top of the password.
-- Caregivers and family proxies are unaffected.
--
-- Safety valve: this is gated by staff_accounts.login_code_enabled (default true). If email delivery ever breaks
-- and locks the only administrator out, running
--   update staff_accounts set login_code_enabled = false where role = 'admin';
-- restores plain password sign-in immediately, with no code changes or deploy needed.
--
-- How it works, reusing the mechanism already in this project for "caregivers must use their Company ID"
-- (migration 014): company-login validates the password first (a real, ordinary sign-in attempt). If the account
-- needs a code, the access-token hook refuses to actually issue that first token (a distinguishable error), which
-- tells company-login the password was right without ever handing out a session. It then emails a code. Once the
-- code is verified, company-login mints the real session itself (an emailed Supabase magic-link token, generated
-- and immediately redeemed server-side — nothing is emailed twice, and the customer never sees that link).

alter table staff_accounts add column if not exists login_code_enabled boolean not null default true;

-- One row per code sent. Never exposed to anon/authenticated; only the edge functions (service role) touch it.
create table if not exists admin_login_codes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_codes_user_idx on admin_login_codes (user_id, created_at desc);
alter table admin_login_codes enable row level security;
revoke all on admin_login_codes from anon, authenticated;

-- "Remember this device for 30 days": an opaque token kept in the browser, checked instead of sending a new code.
create table if not exists trusted_devices (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists trusted_devices_user_idx on trusted_devices (user_id);
alter table trusted_devices enable row level security;
revoke all on trusted_devices from anon, authenticated;

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
    select (role = 'caregiver' and company_id is not null), (role = 'admin' and login_code_enabled)
      into must_use_company_id, must_use_code
      from staff_accounts where user_id = uid;

    -- Roles are mutually exclusive, so at most one of these ever actually runs for a given account.
    if coalesce(must_use_company_id, false) then
      delete from login_permits where user_id = uid returning true into permitted;
      if not coalesce(permitted, false) then
        return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Please log in with your Company ID.'));
      end if;
    end if;

    if coalesce(must_use_code, false) then
      delete from login_permits where user_id = uid returning true into permitted;
      if not coalesce(permitted, false) then
        return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'A sign-in code has been emailed. Enter it to continue.'));
      end if;
    end if;
  end if;

  -- A verified emailed code and an ordinary "click the link in your email" both arrive here as method 'otp' —
  -- Supabase does not distinguish them. company-login leaves a momentary marker for the one case that is really
  -- a login code, so the audit trail can tell them apart. This never blocks anything either way.
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

-- The audit trail's description of a sign-in gains a branch for the new method.
create or replace function admin_activity_feed(p_limit int default 400)
returns table (at timestamptz, actor_id uuid, actor_name text, actor_role text, action text, detail text, patient_name text, source text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  return query
  select f.at, f.actor_id, f.actor_name, f.actor_role, f.action, f.detail, f.patient_name, f.source
  from (
    select a.created_at as at, a.actor_id, a.actor_name, a.actor_role, a.action, a.detail, a.patient_name, 'app'::text as source
    from activity_log a
    union all
    select l.at, l.user_id,
           coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), l.actor_label),
           s.role,
           l.event,
           nullif(concat_ws(' · ',
             case l.method
               when 'password' then 'With password'
               when 'recovery' then 'Through a password-reset link'
               when 'login code' then 'With password and an emailed code'
               when 'email link' then 'Through an email link'
             end,
             case when nullif(l.ip, '') is not null then 'From address ' || l.ip end,
             nullif(l.note, '')), ''),
           null::text,
           'auth'::text
    from sign_in_log l left join staff_accounts s on s.user_id = l.user_id
    union all
    select la.at, s.user_id,
           coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), s.company_id),
           s.role,
           'had a failed sign-in attempt',
           'Wrong Company ID or password, from address ' || la.ip,
           null::text,
           'auth'::text
    from login_attempts la join staff_accounts s on s.company_id = la.identifier
  ) f
  order by f.at desc
  limit greatest(1, least(p_limit, 1000));
end;
$$;
