-- A medication dose that is 45 minutes overdue and never logged (given or refused) alerts the whole care team,
-- the same way a refused dose already does. This table only records that the alert for one specific dose was
-- already sent, so the per-minute check (send-reminders) never sends it twice. Never exposed to anon/authenticated;
-- only the edge function (service role) touches it.

create table if not exists medication_missed_alerts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  med_name text not null,
  scheduled_for timestamptz not null,
  created_at timestamptz not null default now(),
  unique (patient_id, med_name, scheduled_for)
);
create index if not exists medication_missed_alerts_patient_idx on medication_missed_alerts (patient_id, created_at desc);
alter table medication_missed_alerts enable row level security;
revoke all on medication_missed_alerts from anon, authenticated;
