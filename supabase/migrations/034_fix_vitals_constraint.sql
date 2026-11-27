-- 033's cleanup of the old "at least one reading" check used a case-sensitive search that didn't match
-- pg_get_constraintdef's uppercase output, so the old constraint (vitals_check1, which didn't know about
-- temperature or oxygen_saturation) was left in place alongside the new one. A reading of only temperature or only
-- oxygen would have been wrongly rejected. This drops the old one, now found by its exact known name.

alter table vitals drop constraint if exists vitals_check1;

-- Safety net in case the name above ever differs (e.g. on a database where 033 ran cleanly the first time):
-- drop any check constraint that still requires the four original fields without knowing about the two new ones.
do $$
declare
  old_name text;
begin
  loop
    select conname into old_name from pg_constraint
    where conrelid = 'vitals'::regclass and contype = 'c' and conname <> 'vitals_has_a_reading'
      and pg_get_constraintdef(oid) ilike '%weight_lb IS NOT NULL%'
      and pg_get_constraintdef(oid) not ilike '%temperature%';
    exit when old_name is null;
    execute format('alter table vitals drop constraint %I', old_name);
  end loop;
end $$;
