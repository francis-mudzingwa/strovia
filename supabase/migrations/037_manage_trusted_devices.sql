-- Lets an administrator see and revoke their own "remembered" devices (see migration 035), so a lost or stolen
-- device is never just a 30-day wait. Nobody can see or touch another user's devices; everything here is scoped
-- to auth.uid().

alter table trusted_devices add column if not exists id uuid not null default gen_random_uuid();
alter table trusted_devices add column if not exists last_used_at timestamptz not null default now();
create unique index if not exists trusted_devices_id_idx on trusted_devices (id);

-- The auth hook's trusted-device check keeps last_used_at current, so the list means something.
-- (company-login updates this directly; nothing here depends on it, this index just makes that lookup fast.)

create or replace function list_my_trusted_devices()
returns table (id uuid, created_at timestamptz, last_used_at timestamptz, expires_at timestamptz, token_suffix text)
language sql stable security definer set search_path = public as $$
  select id, created_at, last_used_at, expires_at, right(token, 6)
  from trusted_devices
  where user_id = auth.uid() and expires_at > now()
  order by last_used_at desc
$$;
revoke execute on function list_my_trusted_devices() from public, anon;
grant execute on function list_my_trusted_devices() to authenticated;

create or replace function forget_my_trusted_device(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  delete from trusted_devices where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'That device was not found.';
  end if;
  perform log_activity(null, 'forgot a remembered sign-in device', null);
end;
$$;
revoke execute on function forget_my_trusted_device(uuid) from public, anon;
grant execute on function forget_my_trusted_device(uuid) to authenticated;

create or replace function forget_all_my_trusted_devices()
returns int
language plpgsql security definer set search_path = public as $$
declare
  removed int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  delete from trusted_devices where user_id = auth.uid();
  get diagnostics removed = row_count;
  if removed > 0 then
    perform log_activity(null, 'forgot all remembered sign-in devices', removed || ' device(s)');
  end if;
  return removed;
end;
$$;
revoke execute on function forget_all_my_trusted_devices() from public, anon;
grant execute on function forget_all_my_trusted_devices() to authenticated;
