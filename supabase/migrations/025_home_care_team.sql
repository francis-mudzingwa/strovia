-- Home page: who is on each patient's care team, and who checked in and when.

-- 1. When a check-in was last saved. The app saves a check-in as "insert or update", and it records who saved
--    it last, so the time has to be the last save too, or the two would not match.
alter table checkins add column if not exists updated_at timestamptz;
update checkins set updated_at = created_at where updated_at is null;

create or replace function trg_checkin_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists checkin_touch on checkins;
create trigger checkin_touch before insert or update on checkins for each row execute function trg_checkin_touch();

-- 2. The people around each patient the caller may open: the approved caregivers and family assigned to
--    them, plus anyone who recorded a check-in in the last 14 days (so a name can be shown even if that
--    person, for example the administrator, is not on the team). Name and role only: no email, phone or
--    Company ID. Administrators see every patient; everyone else only the patients assigned to them.
create or replace function home_people()
returns table (patient_id uuid, user_id uuid, name text, role text, on_team boolean)
language sql stable security definer set search_path = public as $$
  with visible as (select p.id from patients p where can_view_patient(p.id)),
  ppl as (
    select pa.patient_id, pa.user_id, true as on_team
      from patient_assignments pa join visible v on v.id = pa.patient_id
    union all
    select c.patient_id, c.recorded_by, false
      from checkins c join visible v on v.id = c.patient_id
      where c.recorded_by is not null and c.entry_date >= current_date - 14
  )
  select p.patient_id, p.user_id,
         coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), 'Team member'),
         s.role,
         bool_or(p.on_team)
  from ppl p join staff_accounts s on s.user_id = p.user_id and s.approved
  group by p.patient_id, p.user_id, s.first_name, s.last_name, s.role
$$;
revoke execute on function home_people() from public, anon;
grant execute on function home_people() to authenticated;
