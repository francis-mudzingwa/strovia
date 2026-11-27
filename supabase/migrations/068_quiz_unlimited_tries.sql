-- A carer can retake a quiz as many times as they like. A failed try never goes to the administrator: the quiz simply stays open for the
-- carer with the last mark shown. Only a pass goes to the administrator (to issue the certificate). Every try is still kept in
-- training_attempts, and `fails` now simply counts the failed tries in a row (reset when the administrator sends it back).

create or replace function submit_training_quiz(p_assignment uuid, p_answers jsonb, p_signed text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a training_assignments;
  t trainings;
  total integer;
  right_count integer := 0;
  i integer := 0;
  r record;
  chosen integer;
  mark integer;
  passed boolean;
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

  insert into training_attempts (assignment_id, attempt_no, score) values (a.id, a.attempts + 1, mark);

  if passed then
    update training_assignments set status = 'submitted', answers = p_answers, score = mark, last_score = mark, fails = 0,
           attempts = attempts + 1, signed_name = left(btrim(p_signed), 120), submission_path = null, submission_name = null,
           submitted_at = now(), returned_note = null
     where id = a.id;
    perform training_tell_admins(auth.uid(), 'I passed the quiz "' || t.title || '" with ' || mark || '%.');
  else
    -- Not passed: the carer can go again straight away, as often as they like. The administrator is not asked to check anything.
    update training_assignments set last_score = mark, fails = fails + 1, attempts = attempts + 1, returned_note = null
     where id = a.id;
  end if;

  return jsonb_build_object('score', mark, 'passed', passed, 'status', case when passed then 'submitted' else 'assigned' end, 'pass_mark', t.pass_mark);
end;
$$;
revoke execute on function submit_training_quiz(uuid, jsonb, text) from public, anon;
grant execute on function submit_training_quiz(uuid, jsonb, text) to authenticated;
