-- Extends the check-in shift gate (migration 039) to three more caregiver actions: adding a reading, logging
-- medication given/refused, and ticking off a daily task. Same rule, same exemptions: administrators and family
-- proxies are never shift-bound, and a caregiver/patient pairing with no shift schedule tracked at all is never
-- blocked. Reuses caregiver_on_shift(patient, caregiver) as-is — no changes to that function.
--
-- Only inserts are gated. Undoing an already-ticked task (a task_log delete) is left alone, matching the check-in
-- gate's own "editing/undoing is always open" rule — a caregiver correcting a mistake after their shift ends should
-- never be blocked from it.

create or replace function trg_check_shift_for_care_action() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  my_role text;
begin
  select role into my_role from staff_accounts where user_id = auth.uid();
  if my_role = 'caregiver' and not caregiver_on_shift(new.patient_id, auth.uid()) then
    raise exception 'You can only do this while you are on shift for this patient.';
  end if;
  return new;
end;
$$;

drop trigger if exists check_shift_for_vitals on vitals;
create trigger check_shift_for_vitals before insert on vitals for each row execute function trg_check_shift_for_care_action();

drop trigger if exists check_shift_for_medication_log on medication_log;
create trigger check_shift_for_medication_log before insert on medication_log for each row execute function trg_check_shift_for_care_action();

drop trigger if exists check_shift_for_task_log on task_log;
create trigger check_shift_for_task_log before insert on task_log for each row execute function trg_check_shift_for_care_action();
