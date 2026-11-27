-- Meals log: for each meal of the day (breakfast, lunch, dinner) the carer records how much was eaten, how much was drunk, and whether
-- there was coughing, choking or trouble swallowing. It replaces the Breakfast / Lunch / Dinner / Fluids tick-list, which could only
-- say "done". Strovia sets no targets: nothing here says how much someone should eat or drink.
--   * anyone who can view the patient can read it (carers, administrators, and the family on that patient)
--   * only carers and administrators can add one, a carer only while on shift for the patient (same rule as readings and tasks)
--   * lunch opens at 12 noon and dinner at 5 PM (Eastern time); only an administrator can record one early, with a reason
--   * one entry per meal per day; undo (delete) is always open to whoever recorded it and to an administrator, then it can be redone

create table if not exists meal_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  log_date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner')),
  amount text not null check (amount in ('all', 'most', 'half', 'little', 'none')),
  drinks text not null check (drinks in ('well', 'some', 'little')),
  trouble boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz not null default now(),
  early_reason text check (early_reason is null or char_length(early_reason) <= 300),
  unique (patient_id, log_date, meal)
);
create index if not exists meal_log_by_patient on meal_log (patient_id, log_date desc);

alter table meal_log enable row level security;

drop policy if exists "view meal log" on meal_log;
create policy "view meal log" on meal_log for select using (can_view_patient(patient_id));
drop policy if exists "add meal log" on meal_log;
create policy "add meal log" on meal_log for insert with check (is_staff() and can_edit_patient(patient_id) and done_by = auth.uid());
drop policy if exists "undo meal log" on meal_log;
create policy "undo meal log" on meal_log for delete using (is_admin() or (is_staff() and done_by = auth.uid() and can_edit_patient(patient_id)));

-- The day must be today or one of the last two days (Eastern); lunch and dinner open at their time on the day itself.
create or replace function trg_meal_time_of_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e timestamp := now() at time zone 'America/New_York';
  opens integer := case new.meal when 'lunch' then 12 when 'dinner' then 17 else 0 end;
begin
  if new.log_date > e::date then
    raise exception 'That day has not started yet.';
  end if;
  if new.log_date < e::date - 2 then
    raise exception 'That was too long ago to add here.';
  end if;
  if opens > 0 and not time_gate_open(opens, new.log_date, e) then
    if not is_admin() then
      raise exception 'This meal opens at %.', case when opens = 12 then '12 noon' else '5 PM' end;
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
drop trigger if exists meal_time_of_day on meal_log;
create trigger meal_time_of_day before insert on meal_log for each row execute function trg_meal_time_of_day();

drop trigger if exists check_shift_for_meal_log on meal_log;
create trigger check_shift_for_meal_log before insert on meal_log for each row execute function trg_check_shift_for_care_action();

-- The built-in daily task list no longer has meals on it (meals have their own log), so the built-in time rule for tasks goes too.
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
