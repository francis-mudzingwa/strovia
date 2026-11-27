-- Automatic training reminders. Every 15 minutes a job looks for trainings still waiting on a carer (status 'assigned') and sends a
-- Strovia message from the administrator who set the training:
--   * the day before the due date   ("is due tomorrow")
--   * on the due date               ("is due today")
--   * after the due date            ("is overdue"), then again every 3 days, for up to 30 days
-- Rules: only between 9 AM and 8 PM Eastern (never at night); one message per carer per step (the table below remembers what was
-- sent); nothing for work already sent in, finished, archived or without a due date; nothing within 2 hours of the training being
-- set (the "set for you" message just went out). The message holds no patient details, like the other training messages.

create table if not exists training_reminders_sent (
  assignment_id uuid not null references training_assignments(id) on delete cascade,
  step text not null,
  sent_at timestamptz not null default now(),
  primary key (assignment_id, step)
);
alter table training_reminders_sent enable row level security; -- no policies: only the job itself touches it

create or replace function run_training_reminders(p_now timestamptz default now())
returns integer
language plpgsql security definer set search_path = public as $$
declare
  e timestamp := p_now at time zone 'America/New_York';
  today date := (p_now at time zone 'America/New_York')::date;
  r record;
  days_left integer;
  which text;
  sender uuid;
  msg text;
  sent integer := 0;
begin
  if extract(hour from e) < 9 or extract(hour from e) >= 20 then
    return 0;
  end if;
  for r in
    select a.id as aid, a.user_id, a.due_date, a.created_at, t.title, t.created_by
      from training_assignments a
      join trainings t on t.id = a.training_id
     where a.status = 'assigned' and a.due_date is not null and t.archived_at is null
       and a.created_at <= p_now - interval '2 hours'
  loop
    days_left := r.due_date - today;
    which := case
      when days_left = 1 then 'day_before'
      when days_left = 0 then 'due_day'
      when days_left < 0 and days_left >= -30 then 'overdue_' || ((-days_left + 2) / 3)::text
      else null
    end;
    continue when which is null;
    continue when exists (select 1 from training_reminders_sent s where s.assignment_id = r.aid and s.step = which);
    sender := coalesce(r.created_by, (select user_id from staff_accounts where role = 'admin' and approved order by created_at limit 1));
    continue when sender is null;
    msg := case
      when which = 'day_before' then 'Reminder: the training "' || r.title || '" is due tomorrow (' || to_char(r.due_date, 'Mon FMDD, YYYY') || '). Open Strovia and look under Training.'
      when which = 'due_day' then 'Reminder: the training "' || r.title || '" is due today. Open Strovia and look under Training.'
      else 'The training "' || r.title || '" was due ' || to_char(r.due_date, 'Mon FMDD, YYYY') || ' and is still waiting. Please complete it as soon as you can. Open Strovia and look under Training.'
    end;
    insert into training_reminders_sent (assignment_id, step) values (r.aid, which);
    perform training_notify(sender, r.user_id, msg);
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;
revoke execute on function run_training_reminders(timestamptz) from public, anon, authenticated;

select cron.unschedule('strovia-training-reminders') where exists (select 1 from cron.job where jobname = 'strovia-training-reminders');
select cron.schedule('strovia-training-reminders', '*/15 * * * *', 'select run_training_reminders()');
