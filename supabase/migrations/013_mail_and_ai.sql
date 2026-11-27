-- Usage log that caps AI calls per account per hour (only the analyze-checkin function touches it).
create table if not exists ai_calls (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists ai_calls_lookup_idx on ai_calls (user_id, at);
alter table ai_calls enable row level security;

-- Log of registration notices, so a flood of fake sign-ups can't flood the administrator's inbox.
create table if not exists mail_log (
  id bigserial primary key,
  type text not null,
  at timestamptz not null default now()
);
alter table mail_log enable row level security;

-- Email every administrator when a caregiver registers. It must never block a sign-up, so any failure is swallowed.
-- Replace __CRON_SECRET__ with the value stored as the send-mail function's CRON_SECRET secret.
create extension if not exists pg_net;

create or replace function notify_admin_new_registration()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'caregiver' and not new.approved then
    perform net.http_post(
      url := 'https://tbxgxbfxndegkbqwebis.supabase.co/functions/v1/send-mail',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
      body := jsonb_build_object('type', 'new_registration', 'userId', new.user_id)
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists notify_new_registration on staff_accounts;
create trigger notify_new_registration after insert on staff_accounts
  for each row execute function notify_admin_new_registration();
