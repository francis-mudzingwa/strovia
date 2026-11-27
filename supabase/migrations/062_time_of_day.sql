-- Time of day for exercises and daily tasks (Eastern time, like shifts and doses):
--   * a PM exercise cannot be ticked before 12 noon on the day it is for;
--   * a daily task the care plan tags Afternoon opens at 12 noon, one tagged Evening at 5 PM (Morning and "any time" are always open;
--     the tags live in the care plan as care_plan.taskTimes = { "<task text>": "morning" | "afternoon" | "evening" });
--   * only an administrator can record one early, and must give a reason, which is kept with the record.
-- Medication is deliberately NOT limited by time of day: a patient may need a dose when they are in pain at any hour.
-- Past days are never limited, and nothing here stops anyone from undoing a tick.

alter table exercise_log add column if not exists early_reason text check (early_reason is null or char_length(early_reason) <= 300);
alter table task_log add column if not exists early_reason text check (early_reason is null or char_length(early_reason) <= 300);

-- Is a thing for `p_date` open yet at `p_at` (Eastern clock time)? Anything not for today is open; opens-at 0 means always.
create or replace function time_gate_open(p_opens_hour integer, p_date date, p_at timestamp)
returns boolean language sql immutable as $$
  select p_opens_hour <= 0 or p_date is distinct from p_at::date or extract(hour from p_at) >= p_opens_hour
$$;

create or replace function trg_exercise_time_of_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e timestamp := now() at time zone 'America/New_York';
begin
  if new.slot = 'pm' and not time_gate_open(12, new.log_date, e) then
    if not is_admin() then
      raise exception 'The PM exercises open at 12 noon.';
    end if;
    if new.early_reason is null or btrim(new.early_reason) = '' then
      raise exception 'Write why this is being recorded early.';
    end if;
    new.early_reason := left(btrim(new.early_reason), 300);
  else
    new.early_reason := null; -- a reason only means something when the record really was early
  end if;
  return new;
end;
$$;
drop trigger if exists exercise_time_of_day on exercise_log;
create trigger exercise_time_of_day before insert on exercise_log for each row execute function trg_exercise_time_of_day();

create or replace function trg_task_time_of_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e timestamp := now() at time zone 'America/New_York';
  w text;
  opens integer;
begin
  select care_plan->'taskTimes'->>new.task into w from patients where id = new.patient_id;
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
drop trigger if exists task_time_of_day on task_log;
create trigger task_time_of_day before insert on task_log for each row execute function trg_task_time_of_day();
