-- 1. Email notices for messages ---------------------------------------------------------------------------
-- When a staff message is sent, the people it is for get a short email that says only that a message is waiting. The email never
-- carries the message, the sender's name or a link to the message: they have to open Strovia to read it. To avoid flooding anyone:
-- at most one email per person per conversation every 30 minutes (an urgent message always goes), and none to someone who has
-- read that conversation in the last 2 minutes (they have it open). Each person can switch the emails off on their Profile.
alter table staff_accounts add column if not exists email_message_notices boolean not null default true;

create table if not exists message_email_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references message_threads(id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index if not exists message_email_log_recent on message_email_log (user_id, thread_id, sent_at desc);
alter table message_email_log enable row level security;
revoke all on message_email_log from anon, authenticated;

create or replace function set_my_email_notices(p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  update staff_accounts set email_message_notices = coalesce(p_on, true) where user_id = auth.uid();
end;
$$;
revoke execute on function set_my_email_notices(boolean) from public, anon;
grant execute on function set_my_email_notices(boolean) to authenticated;

create or replace function trg_message_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  recipients uuid[];
  secret text;
begin
  select array_agg(m.user_id) into recipients
  from thread_members(new.thread_id) m
  join staff_accounts s on s.user_id = m.user_id
  where m.user_id is distinct from new.sender_id
    and s.email_message_notices
    and not exists (select 1 from message_reads r where r.thread_id = new.thread_id and r.user_id = m.user_id and r.last_read_at > now() - interval '2 minutes')
    and (new.urgent or not exists (select 1 from message_email_log l where l.thread_id = new.thread_id and l.user_id = m.user_id and l.sent_at > now() - interval '30 minutes'));
  if recipients is null then
    return new;
  end if;
  insert into message_email_log (user_id, thread_id) select u, new.thread_id from unnest(recipients) u;
  delete from message_email_log where sent_at < now() - interval '2 days';
  select value into secret from app_secrets where name = 'cron_secret';
  if secret is not null then
    perform net.http_post(
      url := 'https://tbxgxbfxndegkbqwebis.supabase.co/functions/v1/send-mail',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      body := jsonb_build_object('type', 'message_notice', 'user_ids', to_jsonb(recipients), 'urgent', new.urgent)
    );
  end if;
  return new;
exception when others then
  return new; -- an email problem must never stop a message from being sent
end;
$$;
drop trigger if exists message_email on messages;
create trigger message_email after insert on messages for each row execute function trg_message_email();

-- 2. Changing profile details: once on your own, then ask the administrator ------------------------------------------------
-- Caregivers and family members may change their name, job title, organisation and birthday once. After that a change goes to an
-- administrator as a request. A phone number can always be changed, a first-time birthday does not use up the one change, and
-- administrators are not limited. (The rule lives here in the database, not only on the screen.)
alter table staff_accounts add column if not exists details_edited_at timestamptz;

create table if not exists profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested jsonb not null,
  current jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists profile_change_one_pending on profile_change_requests (user_id) where status = 'pending';
alter table profile_change_requests enable row level security;
drop policy if exists "read my profile requests" on profile_change_requests;
create policy "read my profile requests" on profile_change_requests for select using (is_admin() or user_id = auth.uid());
revoke insert, update, delete on profile_change_requests from anon, authenticated;
revoke all on profile_change_requests from anon;

create or replace function update_my_details(p_first text, p_last text, p_job_title text, p_phone text, p_organisation text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me staff_accounts;
  nf text := nullif(trim(p_first), '');
  nl text := nullif(trim(p_last), '');
  nj text := nullif(trim(p_job_title), '');
  np text := nullif(trim(p_phone), '');
  no text := coalesce(trim(p_organisation), '');
  locked_change boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  select * into me from staff_accounts where user_id = auth.uid();
  if not found then
    raise exception 'No account found.';
  end if;
  locked_change := nf is distinct from me.first_name or nl is distinct from me.last_name or nj is distinct from me.job_title
                   or no is distinct from coalesce(me.organisation, '');
  if me.role <> 'admin' and locked_change and me.details_edited_at is not null then
    raise exception 'Further changes to your name, job title or organisation need your administrator''s approval.';
  end if;
  update staff_accounts
  set first_name = nf, last_name = nl, job_title = nj, phone = np, organisation = no,
      details_edited_at = case when me.role <> 'admin' and locked_change then coalesce(details_edited_at, now()) else details_edited_at end
  where user_id = auth.uid();
end;
$$;

create or replace function set_my_birthday(p_month integer, p_day integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me staff_accounts;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if (p_month is null) <> (p_day is null) then
    raise exception 'Choose both a month and a day.';
  end if;
  select * into me from staff_accounts where user_id = auth.uid();
  if not found then
    raise exception 'No account found.';
  end if;
  if p_month is null and me.role in ('admin', 'caregiver') then
    raise exception 'Your birthday is required.';
  end if;
  -- A first-time birthday is free. Changing one already on file uses the one self-service change.
  if me.role <> 'admin' and me.birthday_month is not null
     and (p_month is distinct from me.birthday_month::integer or p_day is distinct from me.birthday_day::integer) then
    if me.details_edited_at is not null then
      raise exception 'Changing your birthday now needs your administrator''s approval.';
    end if;
    update staff_accounts set details_edited_at = now() where user_id = auth.uid();
  end if;
  update staff_accounts set birthday_month = p_month, birthday_day = p_day where user_id = auth.uid();
end;
$$;

create or replace function request_profile_change(p_first text, p_last text, p_job_title text, p_organisation text, p_month integer, p_day integer)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me staff_accounts;
  cur jsonb;
  req jsonb;
  rid uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  select * into me from staff_accounts where user_id = auth.uid();
  if not found then
    raise exception 'No account found.';
  end if;
  if me.role = 'admin' then
    raise exception 'Administrators change their own details directly.';
  end if;
  if me.details_edited_at is null then
    raise exception 'You can still change your details yourself.';
  end if;
  if nullif(trim(p_first), '') is null then
    raise exception 'A first name is required.';
  end if;
  if (p_month is null) <> (p_day is null) then
    raise exception 'Choose both a month and a day.';
  end if;
  if p_month is null and me.role = 'caregiver' then
    raise exception 'A birthday is required.';
  end if;
  if p_month is not null and make_date(2000, p_month, p_day) is null then
    raise exception 'That birthday is not a real date.';
  end if;
  cur := jsonb_build_object('first_name', me.first_name, 'last_name', me.last_name, 'job_title', me.job_title,
                            'organisation', coalesce(me.organisation, ''), 'birthday_month', me.birthday_month, 'birthday_day', me.birthday_day);
  req := jsonb_build_object('first_name', nullif(trim(p_first), ''), 'last_name', nullif(trim(p_last), ''), 'job_title', nullif(trim(p_job_title), ''),
                            'organisation', coalesce(trim(p_organisation), ''), 'birthday_month', p_month, 'birthday_day', p_day);
  if req = cur then
    raise exception 'Nothing is different from what is on file.';
  end if;
  delete from profile_change_requests where user_id = auth.uid() and status = 'pending';
  insert into profile_change_requests (user_id, requested, current) values (auth.uid(), req, cur) returning id into rid;
  return rid;
end;
$$;
revoke execute on function request_profile_change(text, text, text, text, integer, integer) from public, anon;
grant execute on function request_profile_change(text, text, text, text, integer, integer) to authenticated;

create or replace function decide_profile_change(p_request uuid, p_approve boolean, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r profile_change_requests;
  target_role text;
  secret text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  select * into r from profile_change_requests where id = p_request and status = 'pending';
  if not found then
    raise exception 'That request has already been answered.';
  end if;
  select role into target_role from staff_accounts where user_id = r.user_id;
  if p_approve then
    update staff_accounts set
      first_name = r.requested->>'first_name',
      last_name = r.requested->>'last_name',
      job_title = r.requested->>'job_title',
      organisation = coalesce(r.requested->>'organisation', ''),
      birthday_month = (r.requested->>'birthday_month')::smallint,
      birthday_day = (r.requested->>'birthday_day')::smallint
    where user_id = r.user_id;
  end if;
  update profile_change_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_by = auth.uid(), decided_at = now()
   where id = r.id;
  if target_role in ('admin', 'caregiver') then
    perform training_notify(auth.uid(), r.user_id, case when p_approve then 'Your request to change your details was approved.'
      else 'Your request to change your details was not approved.' || case when nullif(btrim(coalesce(p_note, '')), '') is null then '' else ' Note: ' || btrim(p_note) end end);
  else
    -- Family members have no Messages, so they get a short email that tells them to look at their Profile.
    select value into secret from app_secrets where name = 'cron_secret';
    if secret is not null then
      begin
        perform net.http_post(
          url := 'https://tbxgxbfxndegkbqwebis.supabase.co/functions/v1/send-mail',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
          body := jsonb_build_object('type', 'profile_change_result', 'user_id', r.user_id, 'approved', p_approve)
        );
      exception when others then null;
      end;
    end if;
  end if;
end;
$$;
revoke execute on function decide_profile_change(uuid, boolean, text) from public, anon;
grant execute on function decide_profile_change(uuid, boolean, text) to authenticated;

create or replace function dismiss_profile_request(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update profile_change_requests set seen_at = now() where id = p_request and user_id = auth.uid() and status <> 'pending';
end;
$$;
revoke execute on function dismiss_profile_request(uuid) from public, anon;
grant execute on function dismiss_profile_request(uuid) to authenticated;
