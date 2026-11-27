-- Profile pictures: anyone with an account (caregiver, family, administrator) can add a photo of themselves.
-- The photo lives in a private bucket under a folder named for its owner; people see the photos of
-- the people they share a patient with, and administrators see everyone's. Nobody else can.

-- 1. Where the photo is kept ---------------------------------------------------------------------------
alter table staff_accounts add column if not exists avatar_path text;

-- 2. The bucket: small pictures only (the app shrinks them to 320 x 320 before sending) ----------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Do I share a patient's care team with this person? (Administrators and the person themselves always count.)
create or replace function can_see_avatar_of(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    auth.uid() = p_owner
    or is_admin()
    or exists (
      select 1 from patient_assignments mine
      join patient_assignments theirs on theirs.patient_id = mine.patient_id
      join patients x on x.id = mine.patient_id
      where mine.user_id = auth.uid() and theirs.user_id = p_owner and x.archived_at is null
    )
  )
$$;
revoke execute on function can_see_avatar_of(uuid) from public, anon;
grant execute on function can_see_avatar_of(uuid) to authenticated;

drop policy if exists "view profile pictures" on storage.objects;
create policy "view profile pictures" on storage.objects for select using (
  bucket_id = 'avatars'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then can_see_avatar_of(((storage.foldername(name))[1])::uuid) else false end
);
drop policy if exists "add my profile picture" on storage.objects;
create policy "add my profile picture" on storage.objects for insert with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "remove profile pictures" on storage.objects;
create policy "remove profile pictures" on storage.objects for delete using (
  bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
);

-- 3. Set or clear my own picture -------------------------------------------------------------------------
create or replace function set_my_avatar(p_path text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if p_path is not null and p_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'That picture does not belong to you.';
  end if;
  update staff_accounts set avatar_path = p_path where user_id = auth.uid();
  if not found then
    raise exception 'No account found.';
  end if;
end;
$$;
revoke execute on function set_my_avatar(text) from public, anon;
grant execute on function set_my_avatar(text) to authenticated;

-- An administrator can take down a picture that should not be there.
create or replace function admin_clear_avatar(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  update staff_accounts set avatar_path = null where user_id = p_user;
end;
$$;
revoke execute on function admin_clear_avatar(uuid) from public, anon;
grant execute on function admin_clear_avatar(uuid) to authenticated;

-- 4. Hand the picture's location out with the people lists ---------------------------------------------------
drop function if exists home_people();
create or replace function home_people()
returns table (patient_id uuid, user_id uuid, name text, role text, on_team boolean, is_primary boolean, avatar_path text)
language sql stable security definer set search_path = public as $$
  with visible as (select p.id from patients p where can_view_patient(p.id) and p.archived_at is null),
  ppl as (
    select pa.patient_id, pa.user_id, true as on_team, pa.is_primary
      from patient_assignments pa join visible v on v.id = pa.patient_id
    union all
    select c.patient_id, c.recorded_by, false, false
      from checkins c join visible v on v.id = c.patient_id
      where c.recorded_by is not null and c.entry_date >= current_date - 14
    union all
    select sa.patient_id, sa.recorded_by, false, false
      from symptom_actions sa join visible v on v.id = sa.patient_id
      where sa.recorded_by is not null and sa.entry_date >= current_date - 14
  )
  select p.patient_id, p.user_id,
         coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), 'Team member'),
         s.role,
         bool_or(p.on_team),
         bool_or(p.is_primary),
         s.avatar_path
  from ppl p join staff_accounts s on s.user_id = p.user_id and s.approved
  group by p.patient_id, p.user_id, s.first_name, s.last_name, s.role, s.avatar_path
$$;
revoke execute on function home_people() from public, anon;
grant execute on function home_people() to authenticated;

drop function if exists admin_list_accounts();
create or replace function admin_list_accounts()
returns table (user_id uuid, email text, role text, first_name text, last_name text, company_id text,
               organisation text, job_title text, phone text, confirmed boolean, approved boolean,
               created_at timestamptz, last_sign_in_at timestamptz, suspended boolean, avatar_path text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  return query
    select u.id, u.email::text, s.role, s.first_name, s.last_name, s.company_id, s.organisation, s.job_title, s.phone,
           (u.email_confirmed_at is not null), coalesce(s.approved, false), u.created_at, u.last_sign_in_at,
           coalesce(s.suspended, false), s.avatar_path
    from auth.users u left join staff_accounts s on s.user_id = u.id
    order by u.created_at;
end;
$$;
revoke execute on function admin_list_accounts() from public, anon;
grant execute on function admin_list_accounts() to authenticated;
