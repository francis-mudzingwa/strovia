-- The built-in daily task list is now Breakfast, Lunch, Dinner and Fluids (medicines and exercises are recorded in their own tabs).
-- A patient whose care plan has no task list of its own uses that built-in list, so Lunch opens at 12 noon and Dinner at 5 PM for them
-- too. A care plan that has its own task list uses only its own time tags (care_plan.taskTimes), exactly as before (migration 062).

create or replace function trg_task_time_of_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e timestamp := now() at time zone 'America/New_York';
  plan jsonb;
  w text;
  opens integer;
begin
  select care_plan into plan from patients where id = new.patient_id;
  if plan is not null and plan ? 'tasks' then
    w := plan->'taskTimes'->>new.task;
  else
    w := case new.task when 'Lunch' then 'afternoon' when 'Dinner' then 'evening' else null end;
  end if;
  opens := case w when 'afternoon' then 12 when 'evening' then 17 else 0 end;
  if opens > 0 and not time_gate_open(opens, new.task_date, e) then
    if not is_admin() then
      raise exception 'This task opens at %.', case when opens = 12 then '12 noon' else '5 PM' end;
    end if;
    if new.early_reason is null or btrim(new.early_reason) = '' then
      raise exception 'Write why this is being recorded early.';
    end if;
    new.early_reason := left(btrim(new.early_reason), 300);
  else
    new.early_reason := null;
  end if;
  return new;
end;
$$;

-- Walter Bennett and Eleanor Whitfield were the only two care plans that saved their own copy of the old four tasks. Dropping
-- the copy makes them use the built-in list like everyone else (the administrator can still write a custom list at any time).
update patients
   set care_plan = care_plan - 'tasks' - 'taskTimes'
 where archived_at is null
   and care_plan->'tasks' = '["Morning medicines given","Evening medicines given","Meals and fluids","Exercises from the therapists"]'::jsonb;
