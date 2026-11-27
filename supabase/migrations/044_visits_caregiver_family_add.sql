-- A caregiver or family proxy assigned to the patient can now add a visit too, not just the administrator -- they
-- often learn about a scheduled therapist or nurse visit directly and shouldn't have to relay it through the office
-- first. Editing or removing an existing visit stays administrator-only, unchanged. Viewing was already open to
-- anyone who can see the patient (can_view_patient), so only the insert policy changes here.

drop policy if exists "admin adds visits" on visits;
create policy "assigned team adds visits" on visits for insert with check (can_edit_patient(patient_id));
