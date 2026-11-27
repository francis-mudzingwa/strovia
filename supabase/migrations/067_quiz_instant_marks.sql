-- Quiz marks are shown to the carer straight away, and a carer can retake without waiting for the administrator.
--   * a pass: status becomes 'submitted' (the administrator issues the certificate, as before) and the carer sees the mark
--   * a fail with tries left: the quiz stays open for the carer ('assigned') with the last mark shown; the administrator is not bothered
--   * a third fail in a row: it goes to the administrator ('submitted') to decide, who can send it back for more tries
--   * every try is kept (training_attempts) so the administrator sees how many tries and the mark of each
-- The carer sees only the mark and whether it passed, never which answers were wrong or the right answers.

alter table training_assignments add column if not exists last_score smallint;
alter table training_assignments add column if not exists fails smallint not null default 0;

create table if not exists training_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references training_assignments(id) on delete cascade,
  attempt_no smallint not null,
  score smallint not null,
  created_at timestamptz not null default now(),
  unique (assignment_id, attempt_no)
);
alter table training_attempts enable row level security;
drop policy if exists "view training attempts" on training_attempts;
create policy "view training attempts" on training_attempts for select using (
  is_admin() or exists (select 1 from training_assignments a where a.id = assignment_id and a.user_id = auth.uid())
);

drop function if exists submit_training_quiz(uuid, jsonb, text);
create or replace function submit_training_quiz(p_assignment uuid, p_answers jsonb, p_signed text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  max_fails constant integer := 3;
  a training_assignments;
  t trainings;
  total integer;
  right_count integer := 0;
  i integer := 0;
  r record;
  chosen integer;
  mark integer;
  passed boolean;
  new_fails integer;
  new_status text;
  who text;
begin
  select * into a from training_assignments where id = p_assignment and user_id = auth.uid() and status = 'assigned';
  if not found then
    raise exception 'That training is not waiting for you.';
  end if;
  select * into t from trainings where id = a.training_id and archived_at is null;
  if not found or t.method <> 'quiz' then
    raise exception 'That training is not a quiz.';
  end if;
  select count(*) into total from training_questions where training_id = t.id;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> total then
    raise exception 'Answer every question first.';
  end if;
  if p_signed is null or char_length(btrim(p_signed)) = 0 then
    raise exception 'Type your name to confirm this is your own work.';
  end if;
  for r in select q.id, q.options, k.correct from training_questions q join training_answer_key k on k.question_id = q.id
           where q.training_id = t.id order by q.position loop
    chosen := (p_answers->>i)::integer;
    if chosen is null or chosen < 0 or chosen >= jsonb_array_length(r.options) then
      raise exception 'Answer every question first.';
    end if;
    if chosen = r.correct then
      right_count := right_count + 1;
    end if;
    i := i + 1;
  end loop;

  mark := round(100.0 * right_count / total);
  passed := mark >= t.pass_mark;
  new_fails := case when passed then 0 else a.fails + 1 end;
  new_status := case when passed or new_fails >= max_fails then 'submitted' else 'assigned' end;
  who := training_person_name(auth.uid());

  insert into training_attempts (assignment_id, attempt_no, score) values (a.id, a.attempts + 1, mark);

  if new_status = 'submitted' then
    update training_assignments set status = 'submitted', answers = p_answers, score = mark, last_score = mark, fails = new_fails,
           attempts = attempts + 1, signed_name = left(btrim(p_signed), 120), submission_path = null, submission_name = null,
           submitted_at = now(), returned_note = null
     where id = a.id;
    if passed then
      perform training_tell_admins(auth.uid(), 'I passed the quiz "' || t.title || '" with ' || mark || '%.');
    else
      perform training_tell_admins(auth.uid(), 'I did not pass the quiz "' || t.title || '" after ' || new_fails || ' tries (my last mark was ' || mark || '%). Please send it back or speak to me.');
    end if;
  else
    -- Not passed, tries left: the carer can go again straight away. The administrator is not asked to check anything.
    update training_assignments set last_score = mark, fails = new_fails, attempts = attempts + 1, returned_note = null
     where id = a.id;
  end if;

  return jsonb_build_object('score', mark, 'passed', passed, 'status', new_status, 'pass_mark', t.pass_mark, 'tries_left', greatest(max_fails - new_fails, 0));
end;
$$;
revoke execute on function submit_training_quiz(uuid, jsonb, text) from public, anon;
grant execute on function submit_training_quiz(uuid, jsonb, text) to authenticated;

-- Sending back resets the run of fails, so the carer gets a fresh set of tries.
create or replace function return_training(p_assignment uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a training_assignments;
  t trainings;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  select * into a from training_assignments where id = p_assignment and status = 'submitted';
  if not found then
    raise exception 'There is nothing to send back.';
  end if;
  select * into t from trainings where id = a.training_id;
  update training_assignments set status = 'assigned', attempts = attempts + 1, submission_path = null, submission_name = null,
         answers = null, score = null, last_score = null, fails = 0, signed_name = null, submitted_at = null,
         returned_note = nullif(btrim(coalesce(p_note, '')), ''), returned_at = now()
   where id = p_assignment;
  perform training_notify(auth.uid(), a.user_id, 'Your work for "' || t.title || '" was sent back for another try.' ||
    case when nullif(btrim(coalesce(p_note, '')), '') is null then '' else ' Note: ' || btrim(p_note) end);
end;
$$;
revoke execute on function return_training(uuid, text) from public, anon;
grant execute on function return_training(uuid, text) to authenticated;
