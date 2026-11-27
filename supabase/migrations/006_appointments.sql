-- Appointments for a patient: doctor, time, address, what to bring, and a
-- reminder time (the day before). Owners manage their own; linked caregivers
-- with the "view_appointments" permission can read them.
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_name text not null,
  doctor text not null,
  specialty text,
  starts_at timestamptz not null,
  place_name text,
  address text not null,
  notes text,
  bring_items jsonb not null default '[]'::jsonb,
  remind boolean not null default true,
  reminder_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists appointments_user_starts_idx on appointments (user_id, starts_at);

alter table appointments enable row level security;

drop policy if exists "owners manage appointments" on appointments;
create policy "owners manage appointments" on appointments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "caregivers view linked appointments" on appointments;
create policy "caregivers view linked appointments" on appointments
  for select using (
    exists (
      select 1 from caregiver_links cl
      where cl.patient_id = appointments.user_id
        and cl.caregiver_id = auth.uid()
        and coalesce((cl.permissions->>'view_appointments')::boolean, false)
    )
  );
