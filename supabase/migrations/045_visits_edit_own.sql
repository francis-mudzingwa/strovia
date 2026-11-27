-- A caregiver or family proxy can now change or remove a visit they created themselves (fixing a typo, or cancelling
-- one that was scheduled by mistake) -- but not anyone else's. Administrators can still change or remove any visit,
-- unchanged. These are additional permissive policies alongside the existing admin-only ones (Postgres ORs
-- permissive policies for the same command together), so nothing about the admin policies needs to change.

create policy "creator changes own visit" on visits for update
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "creator removes own visit" on visits for delete
  using (created_by = auth.uid());
