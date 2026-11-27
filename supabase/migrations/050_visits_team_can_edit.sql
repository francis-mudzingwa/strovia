-- Anyone assigned to a patient (caregiver or family proxy) can now change or remove any of that patient's visits, including
-- ones the administrator added. Before, a caregiver could only change a visit they had added themselves, so a visit set up by
-- the office could not be corrected when a therapist moved the time. This matches who can already add a visit (migration 044).
-- The administrator is unaffected: the existing admin policies stay as they are.
--
-- can_edit_patient() is the same check the insert policy uses. The `with check` also stops a visit being moved to a patient the
-- person has no access to.

drop policy if exists "creator changes own visit" on visits;
drop policy if exists "creator removes own visit" on visits;

create policy "assigned team changes visits" on visits for update
  using (can_edit_patient(patient_id)) with check (can_edit_patient(patient_id));
create policy "assigned team removes visits" on visits for delete
  using (can_edit_patient(patient_id));
