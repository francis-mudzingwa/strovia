-- Staff messages: caregivers and administrators can message each other. Family members and health proxies never can,
-- and the database (not just the screen) refuses to show them anything.
--
-- Three kinds of conversation:
--   all     one group for every caregiver and administrator
--   patient one group per patient: the caregivers assigned to that patient, plus every administrator
--   direct  a private conversation between two staff members (nobody else, not even an administrator, can read it)

-- 1. Who counts as staff ---------------------------------------------------------------------------------
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'caregiver') and approved and not coalesce(suspended, false)
                   from staff_accounts where user_id = auth.uid()), false)
$$;
revoke execute on function is_staff() from public, anon;
grant execute on function is_staff() to authenticated;

-- 2. Tables ----------------------------------------------------------------------------------------------
create table if not exists message_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('all', 'patient', 'direct')),
  patient_id uuid references patients(id) on delete cascade,
  user_a uuid references auth.users(id) on delete cascade,
  user_b uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check (
    (kind = 'all' and patient_id is null and user_a is null and user_b is null)
    or (kind = 'patient' and patient_id is not null and user_a is null and user_b is null)
    or (kind = 'direct' and patient_id is null and user_a is not null and user_b is not null and user_a < user_b)
  )
);
create unique index if not exists message_threads_one_all on message_threads ((kind)) where kind = 'all';
create unique index if not exists message_threads_one_per_patient on message_threads (patient_id) where kind = 'patient';
create unique index if not exists message_threads_one_per_pair on message_threads (user_a, user_b) where kind = 'direct';

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references message_threads(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  urgent boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_by_thread on messages (thread_id, created_at desc);

create table if not exists message_reads (
  thread_id uuid not null references message_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- 3. Who may open which conversation ----------------------------------------------------------------------
create or replace function can_access_thread(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() and exists (
    select 1 from message_threads th
    where th.id = t and (
      th.kind = 'all'
      or (th.kind = 'patient'
          and exists (select 1 from patients x where x.id = th.patient_id and x.archived_at is null)
          and (is_admin() or exists (select 1 from patient_assignments pa where pa.patient_id = th.patient_id and pa.user_id = auth.uid())))
      or (th.kind = 'direct' and auth.uid() in (th.user_a, th.user_b))
    )
  )
$$;
revoke execute on function can_access_thread(uuid) from public, anon;
grant execute on function can_access_thread(uuid) to authenticated;

alter table message_threads enable row level security;
alter table messages enable row level security;
alter table message_reads enable row level security;

drop policy if exists "staff see their conversations" on message_threads;
create policy "staff see their conversations" on message_threads for select using (can_access_thread(id));
drop policy if exists "staff read their messages" on messages;
create policy "staff read their messages" on messages for select using (can_access_thread(thread_id));
drop policy if exists "staff see who has read" on message_reads;
create policy "staff see who has read" on message_reads for select using (can_access_thread(thread_id));

-- Nothing is written straight to these tables: sending, reading and starting a conversation go through the functions below.
revoke insert, update, delete on message_threads, messages, message_reads from anon, authenticated;
revoke all on message_threads, messages, message_reads from anon;

-- 4. The conversations that already exist: everyone, and one per patient ------------------------------------
insert into message_threads (kind) select 'all' where not exists (select 1 from message_threads where kind = 'all');
insert into message_threads (kind, patient_id)
select 'patient', p.id from patients p
where not exists (select 1 from message_threads t where t.kind = 'patient' and t.patient_id = p.id);

create or replace function trg_patient_thread() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into message_threads (kind, patient_id) values ('patient', new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists patient_thread on patients;
create trigger patient_thread after insert on patients for each row execute function trg_patient_thread();

-- 5. The staff directory (names and photos for the people you can message) ----------------------------------
create or replace function staff_directory()
returns table (user_id uuid, name text, role text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select s.user_id,
         coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), 'Team member'),
         s.role, s.avatar_path
  from staff_accounts s
  where is_staff() and s.role in ('admin', 'caregiver') and s.approved and not coalesce(s.suspended, false)
$$;
revoke execute on function staff_directory() from public, anon;
grant execute on function staff_directory() to authenticated;

-- Staff can see each other's photos (the Messages screen shows everyone's); family still sees only their own care team's.
create or replace function can_see_avatar_of(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    auth.uid() = p_owner
    or is_admin()
    or (is_staff() and exists (select 1 from staff_accounts o where o.user_id = p_owner and o.role in ('admin', 'caregiver') and o.approved))
    or exists (
      select 1 from patient_assignments mine
      join patient_assignments theirs on theirs.patient_id = mine.patient_id
      join patients x on x.id = mine.patient_id
      where mine.user_id = auth.uid() and theirs.user_id = p_owner and x.archived_at is null
    )
  )
$$;

-- 6. The inbox ------------------------------------------------------------------------------------------
create or replace function my_threads()
returns table (id uuid, kind text, patient_id uuid, other_user uuid, last_body text, last_sender uuid, last_urgent boolean,
               last_at timestamptz, unread integer, unread_urgent boolean)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid, (select created_at from staff_accounts where user_id = auth.uid()) as joined)
  select th.id, th.kind, th.patient_id,
         case when th.kind = 'direct' then (case when th.user_a = me.uid then th.user_b else th.user_a end) end,
         lm.body, lm.sender_id, lm.urgent, lm.created_at,
         coalesce(u.n, 0)::integer, coalesce(u.urgent, false)
  from message_threads th
  cross join me
  left join message_reads r on r.thread_id = th.id and r.user_id = me.uid
  left join lateral (select m.body, m.sender_id, m.urgent, m.created_at from messages m where m.thread_id = th.id order by m.created_at desc limit 1) lm on true
  left join lateral (select count(*) as n, bool_or(m.urgent) as urgent from messages m
                     where m.thread_id = th.id and m.sender_id is distinct from me.uid
                       and m.created_at > coalesce(r.last_read_at, me.joined, '-infinity'::timestamptz)) u on true
  where can_access_thread(th.id)
$$;
revoke execute on function my_threads() from public, anon;
grant execute on function my_threads() to authenticated;

-- 7. Send, mark read, start a private conversation -----------------------------------------------------------
-- Everyone who should hear about something in this conversation (for the phone alert on an urgent message).
create or replace function thread_members(t uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select s.user_id from staff_accounts s
  join message_threads th on th.id = t
  where s.role in ('admin', 'caregiver') and s.approved and not coalesce(s.suspended, false)
    and (
      th.kind = 'all'
      or (th.kind = 'direct' and s.user_id in (th.user_a, th.user_b))
      or (th.kind = 'patient' and (s.role = 'admin' or exists (select 1 from patient_assignments pa where pa.patient_id = th.patient_id and pa.user_id = s.user_id)))
    )
$$;
revoke execute on function thread_members(uuid) from public, anon, authenticated;

create or replace function send_message(p_thread uuid, p_body text, p_urgent boolean default false)
returns messages
language plpgsql security definer set search_path = public as $$
declare
  msg messages;
  secret text;
  who text;
  recipients uuid[];
begin
  if auth.uid() is null or not can_access_thread(p_thread) then
    raise exception 'You cannot send messages here.';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'Write a message first.';
  end if;
  if char_length(p_body) > 2000 then
    raise exception 'That message is too long.';
  end if;

  insert into messages (thread_id, sender_id, body, urgent)
  values (p_thread, auth.uid(), btrim(p_body), coalesce(p_urgent, false))
  returning * into msg;

  update message_threads set last_message_at = msg.created_at where id = p_thread;
  insert into message_reads (thread_id, user_id, last_read_at) values (p_thread, auth.uid(), msg.created_at)
  on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;

  if msg.urgent then
    begin
      select value into secret from app_secrets where name = 'cron_secret';
      select array_agg(m.user_id) into recipients from thread_members(p_thread) m where m.user_id <> auth.uid();
      if secret is not null and recipients is not null then
        select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') into who from staff_accounts where user_id = auth.uid();
        perform net.http_post(
          url := 'https://tbxgxbfxndegkbqwebis.supabase.co/functions/v1/send-reminders',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
          body := jsonb_build_object('event', 'message_urgent', 'user_ids', to_jsonb(recipients), 'thread_id', p_thread, 'actor_name', coalesce(who, 'A colleague'))
        );
      end if;
    exception when others then
      null; -- a phone-alert problem must never stop the message from being sent
    end;
  end if;
  return msg;
end;
$$;
revoke execute on function send_message(uuid, text, boolean) from public, anon;
grant execute on function send_message(uuid, text, boolean) to authenticated;

create or replace function mark_thread_read(p_thread uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not can_access_thread(p_thread) then
    return;
  end if;
  insert into message_reads (thread_id, user_id, last_read_at) values (p_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update set last_read_at = greatest(message_reads.last_read_at, excluded.last_read_at);
end;
$$;
revoke execute on function mark_thread_read(uuid) from public, anon;
grant execute on function mark_thread_read(uuid) to authenticated;

create or replace function start_direct(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a uuid;
  b uuid;
  tid uuid;
begin
  if not is_staff() then
    raise exception 'Only caregivers and administrators can send messages.';
  end if;
  if p_other is null or p_other = auth.uid() then
    raise exception 'Choose someone else.';
  end if;
  if not exists (select 1 from staff_accounts where user_id = p_other and role in ('admin', 'caregiver') and approved and not coalesce(suspended, false)) then
    raise exception 'That person is not on the care staff.';
  end if;
  a := least(auth.uid(), p_other);
  b := greatest(auth.uid(), p_other);
  select id into tid from message_threads where kind = 'direct' and user_a = a and user_b = b;
  if tid is null then
    insert into message_threads (kind, user_a, user_b) values ('direct', a, b) returning id into tid;
  end if;
  return tid;
end;
$$;
revoke execute on function start_direct(uuid) from public, anon;
grant execute on function start_direct(uuid) to authenticated;

-- 8. Live updates: new messages reach open screens straight away (the table's own privacy rule still applies) -----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table messages;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
