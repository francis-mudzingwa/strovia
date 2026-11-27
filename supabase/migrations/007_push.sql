-- Web push: one row per device that has alerts turned on. A device belongs to
-- whichever account turned alerts on last (endpoint is unique).
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "users view own push subscriptions" on push_subscriptions;
create policy "users view own push subscriptions" on push_subscriptions
  for select using (auth.uid() = user_id);

create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

grant execute on function save_push_subscription(text, text, text, text) to authenticated;

create or replace function remove_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

grant execute on function remove_push_subscription(text) to authenticated;

-- Which reminders have already been pushed, so each goes out exactly once.
-- No policies on purpose: only the server function (service role) touches it.
create table if not exists reminder_sends (
  id bigserial primary key,
  appointment_id uuid not null references appointments(id) on delete cascade,
  kind text not null,
  reminder_at timestamptz not null,
  sent_at timestamptz not null default now(),
  unique (appointment_id, kind, reminder_at)
);

alter table reminder_sends enable row level security;
