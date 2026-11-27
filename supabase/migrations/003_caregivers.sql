-- Caregiver invitations: created by a patient, consumed once by a new or
-- existing caregiver account. Never exposed directly to anon/other users —
-- all cross-account access goes through the security definer functions below.
create table if not exists caregiver_invitations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id),
  patient_name text not null,
  caregiver_name text not null,
  caregiver_email text not null,
  relationship text,
  permissions jsonb not null default '{}'::jsonb,
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id)
);

alter table caregiver_invitations enable row level security;

drop policy if exists "patients manage own invitations" on caregiver_invitations;
create policy "patients manage own invitations" on caregiver_invitations
  for all using (auth.uid() = patient_id) with check (auth.uid() = patient_id);

-- The confirmed patient <-> caregiver relationship, with the permissions
-- actually granted (copied from the invitation at acceptance time).
create table if not exists caregiver_links (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id),
  patient_name text not null,
  caregiver_id uuid not null references auth.users(id),
  caregiver_name text,
  caregiver_email text,
  relationship text,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (patient_id, caregiver_id)
);

alter table caregiver_links enable row level security;

drop policy if exists "patients view own caregiver links" on caregiver_links;
create policy "patients view own caregiver links" on caregiver_links
  for select using (auth.uid() = patient_id);
drop policy if exists "patients revoke own caregiver links" on caregiver_links;
create policy "patients revoke own caregiver links" on caregiver_links
  for delete using (auth.uid() = patient_id);
drop policy if exists "caregivers view own links" on caregiver_links;
create policy "caregivers view own links" on caregiver_links
  for select using (auth.uid() = caregiver_id);

-- Safe, narrow preview for whoever holds the invitation link — works even
-- before they've signed up, and never exposes anything beyond these fields.
create or replace function get_invitation_preview(p_token uuid)
returns table (patient_name text, caregiver_name text, caregiver_email text, relationship text, permissions jsonb, status text)
language sql security definer set search_path = public as $$
  select patient_name, caregiver_name, caregiver_email, relationship, permissions, status
  from caregiver_invitations
  where token = p_token
$$;

grant execute on function get_invitation_preview(uuid) to anon, authenticated;

-- Consumes a pending invitation for the CURRENTLY authenticated caller,
-- creating the caregiver_links row. This is the only way caregiver_links
-- rows get created — a caregiver can never self-link to a patient.
drop function if exists accept_caregiver_invitation(uuid);
create or replace function accept_caregiver_invitation(p_token uuid)
returns table (out_patient_id uuid, out_patient_name text)
language plpgsql security definer set search_path = public as $$
declare
  inv caregiver_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept an invitation.';
  end if;

  select * into inv from caregiver_invitations where token = p_token and status = 'pending';
  if not found then
    raise exception 'This invitation is invalid or has already been used.';
  end if;

  insert into caregiver_links (patient_id, patient_name, caregiver_id, caregiver_name, caregiver_email, relationship, permissions)
  values (inv.patient_id, inv.patient_name, auth.uid(), inv.caregiver_name, inv.caregiver_email, inv.relationship, inv.permissions)
  on conflict (patient_id, caregiver_id) do update
    set permissions = excluded.permissions, relationship = excluded.relationship,
        caregiver_name = excluded.caregiver_name, caregiver_email = excluded.caregiver_email;

  update caregiver_invitations
  set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  out_patient_id := inv.patient_id;
  out_patient_name := inv.patient_name;
  return next;
end;
$$;

grant execute on function accept_caregiver_invitation(uuid) to authenticated;

-- Let a linked caregiver read exactly the patient data their granted
-- permissions allow — nothing more.
drop policy if exists "caregiver view linked checkins" on checkins;
create policy "caregiver view linked checkins" on checkins
  for select using (
    exists (
      select 1 from caregiver_links cl
      where cl.patient_id = checkins.user_id
        and cl.caregiver_id = auth.uid()
        and coalesce((cl.permissions->>'view_symptoms')::boolean, false)
    )
  );

drop policy if exists "caregiver view linked profile" on profiles;
create policy "caregiver view linked profile" on profiles
  for select using (
    exists (
      select 1 from caregiver_links cl
      where cl.patient_id = profiles.user_id
        and cl.caregiver_id = auth.uid()
        and coalesce((cl.permissions->>'view_progress')::boolean, false)
    )
  );

drop policy if exists "caregiver view linked ai_insights" on ai_insights;
create policy "caregiver view linked ai_insights" on ai_insights
  for select using (
    exists (
      select 1 from caregiver_links cl
      where cl.patient_id = ai_insights.user_id
        and cl.caregiver_id = auth.uid()
        and coalesce((cl.permissions->>'view_progress')::boolean, false)
    )
  );

-- Observations a caregiver records about a patient, gated by the
-- "record_observations" permission.
create table if not exists caregiver_observations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id),
  caregiver_id uuid not null references auth.users(id),
  note text not null,
  created_at timestamptz not null default now()
);

alter table caregiver_observations enable row level security;

drop policy if exists "patients view observations about them" on caregiver_observations;
create policy "patients view observations about them" on caregiver_observations
  for select using (auth.uid() = patient_id);
drop policy if exists "caregiver view own observations" on caregiver_observations;
create policy "caregiver view own observations" on caregiver_observations
  for select using (auth.uid() = caregiver_id);
drop policy if exists "caregiver insert observations if permitted" on caregiver_observations;
create policy "caregiver insert observations if permitted" on caregiver_observations
  for insert with check (
    auth.uid() = caregiver_id
    and exists (
      select 1 from caregiver_links cl
      where cl.patient_id = caregiver_observations.patient_id
        and cl.caregiver_id = auth.uid()
        and coalesce((cl.permissions->>'record_observations')::boolean, false)
    )
  );
