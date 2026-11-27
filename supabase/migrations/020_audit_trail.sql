-- Audit trail for the administrator: who signed in (and out), next to everything already recorded about changes.
-- Supabase's own auth log table is empty on this project, so sign-ins are recorded by the login hook itself,
-- on the server, the moment a session is issued. The app cannot skip it or fake it.

create table if not exists sign_in_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  actor_label text,
  event text not null,            -- 'signed in' | 'signed out'
  method text,                    -- password | recovery | email link | app | earlier
  ip text,
  note text,
  at timestamptz not null default now()
);
create index if not exists sign_in_log_at_idx on sign_in_log (at desc);
create index if not exists sign_in_log_user_idx on sign_in_log (user_id, at desc);
alter table sign_in_log enable row level security;

-- Each person's most recent sign-in from before the audit trail existed (only the latest one is known).
insert into sign_in_log (user_id, actor_label, event, method, note, at)
select u.id,
       coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), u.email::text),
       'signed in', 'earlier', 'Most recent sign-in, recorded before the audit trail started', u.last_sign_in_at
from auth.users u left join staff_accounts s on s.user_id = u.id
where u.last_sign_in_at is not null
  and not exists (select 1 from sign_in_log l where l.user_id = u.id);

-- The login hook still enforces "caregivers log in with their Company ID"; it now also writes the sign-in record.
-- Logging can never block a login: every insert is wrapped so a failure is swallowed.
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (event->>'user_id')::uuid;
  method text := coalesce(event->>'authentication_method', '');
  must_use_company_id boolean;
  permitted boolean;
  label text;
begin
  if method = 'token_refresh' then
    return event;
  end if;

  if method = 'password' then
    select exists (
      select 1 from staff_accounts where user_id = uid and role = 'caregiver' and company_id is not null
    ) into must_use_company_id;
    if must_use_company_id then
      delete from login_permits where expires_at < now();
      delete from login_permits where user_id = uid returning true into permitted;
      if not coalesce(permitted, false) then
        return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Please log in with your Company ID.'));
      end if;
    end if;
  end if;

  begin
    select coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), u.email::text)
      into label from auth.users u left join staff_accounts s on s.user_id = u.id where u.id = uid;
    insert into sign_in_log (user_id, actor_label, event, method)
    values (uid, label, 'signed in', case when method = 'password' then 'password' when method = 'recovery' then 'recovery' else 'email link' end);
  exception when others then
    null;
  end;

  return event;
end;
$$;

grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function custom_access_token_hook(jsonb) from authenticated, anon, public;

-- The app tells us when someone signs out, or is signed out for being idle.
create or replace function log_session_end(p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  if auth.uid() is null then
    return;
  end if;
  select coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), u.email::text)
    into label from auth.users u left join staff_accounts s on s.user_id = u.id where u.id = auth.uid();
  insert into sign_in_log (user_id, actor_label, event, method, note)
  values (auth.uid(), label, 'signed out', 'app', left(coalesce(p_reason, ''), 120));
end;
$$;
grant execute on function log_session_end(text) to authenticated;

-- One timeline for the administrator: changes, sign-ins, sign-outs and recent failed sign-in attempts.
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
             case l.method when 'password' then 'With password' when 'recovery' then 'Through a password-reset link' when 'email link' then 'Through an email link' end,
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

drop function if exists admin_list_accounts();
create or replace function admin_list_accounts()
returns table (user_id uuid, email text, role text, first_name text, last_name text, company_id text,
               organisation text, job_title text, phone text, confirmed boolean, approved boolean,
               created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  return query
    select u.id, u.email::text, s.role, s.first_name, s.last_name, s.company_id, s.organisation, s.job_title, s.phone,
           (u.email_confirmed_at is not null), coalesce(s.approved, false), u.created_at, u.last_sign_in_at
    from auth.users u left join staff_accounts s on s.user_id = u.id
    order by u.created_at;
end;
$$;

create or replace function update_my_details(p_first text, p_last text, p_job_title text, p_phone text, p_organisation text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  update staff_accounts
  set first_name = nullif(trim(p_first), ''),
      last_name = nullif(trim(p_last), ''),
      job_title = nullif(trim(p_job_title), ''),
      phone = nullif(trim(p_phone), ''),
      organisation = coalesce(trim(p_organisation), '')
  where user_id = auth.uid();
  if not found then
    raise exception 'No account found.';
  end if;
  perform log_activity(null, 'updated their own details', nullif(trim(coalesce(p_job_title, '')), ''));
end;
$$;
