-- Proactive "it's time" medication reminders, on top of the existing 45-minutes-late missed-dose alert. When a
-- scheduled dose (or several due at the same moment) comes due, the caregiver currently on shift is pushed a single
-- reminder naming what's due — one push per time slot, not one per medication, and never sent at all if every
-- medicine in that slot was already logged (even a few minutes early). This table only records that one specific
-- slot's reminder was already sent, so the per-minute check (send-reminders) never sends it twice. Never exposed to
-- anon/authenticated; only the edge function (service role) touches it.

create table if not exists medication_due_reminders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  scheduled_for timestamptz not null,
  created_at timestamptz not null default now(),
  unique (patient_id, scheduled_for)
);
create index if not exists medication_due_reminders_patient_idx on medication_due_reminders (patient_id, created_at desc);
alter table medication_due_reminders enable row level security;
revoke all on medication_due_reminders from anon, authenticated;

-- The reminder function (running as the edge function's service role) needs to ask, for each caregiver assigned to
-- a patient, whether they're on shift right now, reusing the exact same rule the check-in gate already enforces.
grant execute on function caregiver_on_shift(uuid, uuid) to service_role;
