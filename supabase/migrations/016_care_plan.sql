-- Each patient gets their own care plan, written by the administrator.
-- Caregivers and family can read it (they can already read the patient) but cannot change it.
-- A patient with no saved plan shows the standard stroke care plan built into the app.

alter table patients add column if not exists care_plan jsonb;

create or replace function trg_guard_care_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for the database owner (SQL editor / migrations), which is allowed.
  if new.care_plan is distinct from old.care_plan and auth.uid() is not null and not is_admin() then
    raise exception 'Only an administrator can change the care plan.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_care_plan on patients;
create trigger guard_care_plan before update on patients
  for each row execute function trg_guard_care_plan();

create or replace function trg_log_patient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.care_plan is distinct from old.care_plan then
    perform log_activity(new.id, 'updated the care plan', null);
  end if;
  if new.profile is distinct from old.profile or new.full_name is distinct from old.full_name then
    perform log_activity(new.id, 'updated the patient profile', null);
  end if;
  return new;
end;
$$;
