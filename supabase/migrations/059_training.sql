-- Training: an administrator sets a training for particular caregivers or all of them (never family members or health proxies).
-- Three ways to finish it:
--   upload     read a document (Word / PDF), then send back a completed copy
--   quiz       answer multiple choice / true-or-false questions in the app, scored by the app
--   in_person  the administrator marks it done
-- The administrator checks each one and issues a certificate of completion. A carer sees only their own training.

-- 1. Tables ---------------------------------------------------------------------------------------------------
create sequence if not exists training_certificate_seq;

create table if not exists trainings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text check (char_length(coalesce(notes, '')) <= 2000),
  method text not null check (method in ('upload', 'quiz', 'in_person')),
  due_date date,
  repeat_months smallint check (repeat_months is null or repeat_months between 1 and 60),
  pass_mark smallint not null default 80 check (pass_mark between 1 and 100),
  doc_path text,
  doc_name text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists training_questions (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references trainings(id) on delete cascade,
  position smallint not null,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 600),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6)
);
create index if not exists training_questions_by_training on training_questions (training_id, position);

-- The correct answers live apart from the questions, so a carer who may read the questions can never read the answers.
create table if not exists training_answer_key (
  question_id uuid primary key references training_questions(id) on delete cascade,
  correct smallint not null check (correct >= 0)
);

create table if not exists training_assignments (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references trainings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  due_date date,
  status text not null default 'assigned' check (status in ('assigned', 'submitted', 'completed')),
  attempts smallint not null default 0,
  submission_path text,
  submission_name text,
  signed_name text,
  answers jsonb,
  score smallint,
  submitted_at timestamptz,
  returned_note text,
  returned_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists training_assignments_by_user on training_assignments (user_id);
create index if not exists training_assignments_by_training on training_assignments (training_id);
create unique index if not exists training_one_open_per_carer on training_assignments (training_id, user_id) where status <> 'completed';

create table if not exists training_certificates (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid unique references training_assignments(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  training_id uuid references trainings(id) on delete set null,
  number text not null unique,
  holder_name text not null,
  training_title text not null,
  score smallint,
  issued_on date not null,
  valid_until date,
  issued_by uuid references auth.users(id) on delete set null,
  issuer_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists training_certificates_by_user on training_certificates (user_id);

-- 2. Who may read what -----------------------------------------------------------------------------------------
alter table trainings enable row level security;
alter table training_questions enable row level security;
alter table training_answer_key enable row level security;
alter table training_assignments enable row level security;
alter table training_certificates enable row level security;

drop policy if exists "read my trainings" on trainings;
create policy "read my trainings" on trainings for select using (
  is_admin() or exists (select 1 from training_assignments a where a.training_id = trainings.id and a.user_id = auth.uid())
);
drop policy if exists "read my training questions" on training_questions;
create policy "read my training questions" on training_questions for select using (
  is_admin() or exists (select 1 from training_assignments a where a.training_id = training_questions.training_id and a.user_id = auth.uid())
);
drop policy if exists "administrators read the answer key" on training_answer_key;
create policy "administrators read the answer key" on training_answer_key for select using (is_admin());
drop policy if exists "read my training assignments" on training_assignments;
create policy "read my training assignments" on training_assignments for select using (is_admin() or user_id = auth.uid());
drop policy if exists "read my certificates" on training_certificates;
create policy "read my certificates" on training_certificates for select using (is_admin() or user_id = auth.uid());

-- Nothing is written straight to these tables: everything goes through the functions below.
revoke insert, update, delete on trainings, training_questions, training_answer_key, training_assignments, training_certificates from anon, authenticated;
revoke all on trainings, training_questions, training_answer_key, training_assignments, training_certificates from anon;

-- 3. Files: the training document, and the completed copies carers send back ------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-files', 'training-files', false, 10485760, array[
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "view training files" on storage.objects;
create policy "view training files" on storage.objects for select using (
  bucket_id = 'training-files' and (
    ((storage.foldername(name))[1] = 'docs' and (is_admin() or exists (
      select 1 from training_assignments a where a.user_id = auth.uid() and a.training_id::text = (storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = 'sub' and (is_admin() or (storage.foldername(name))[2] = auth.uid()::text))
  )
);
drop policy if exists "add training files" on storage.objects;
create policy "add training files" on storage.objects for insert with check (
  bucket_id = 'training-files' and (
    ((storage.foldername(name))[1] = 'docs' and is_admin())
    or ((storage.foldername(name))[1] = 'sub' and (storage.foldername(name))[2] = auth.uid()::text and is_staff())
  )
);
drop policy if exists "remove training files" on storage.objects;
create policy "remove training files" on storage.objects for delete using (
  bucket_id = 'training-files' and (is_admin() or ((storage.foldername(name))[1] = 'sub' and (storage.foldername(name))[2] = auth.uid()::text))
);

-- 4. Messages the training sends (uses the staff messaging) -----------------------------------------------------------
create or replace function training_notify(p_from uuid, p_to uuid, p_text text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a uuid;
  b uuid;
  tid uuid;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return;
  end if;
  a := least(p_from, p_to);
  b := greatest(p_from, p_to);
  select id into tid from message_threads where kind = 'direct' and user_a = a and user_b = b;
  if tid is null then
    insert into message_threads (kind, user_a, user_b) values ('direct', a, b) returning id into tid;
  end if;
  insert into messages (thread_id, sender_id, body, urgent) values (tid, p_from, left(p_text, 1900), false);
  update message_threads set last_message_at = now() where id = tid;
exception when others then
  null; -- a message problem must never stop the training action itself
end;
$$;
revoke execute on function training_notify(uuid, uuid, text) from public, anon, authenticated;

create or replace function training_person_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  -- A name typed entirely in lowercase is tidied for the certificate ("Sample Admin" becomes "Sample Admin").
  select case when n = lower(n) then initcap(n) else n end
  from (select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'A colleague') as n
        from staff_accounts where user_id = p_user) x
$$;
revoke execute on function training_person_name(uuid) from public, anon, authenticated;

-- 5. Set a training for particular carers (p_users) or all of them (p_users null) ------------------------------------
create or replace function create_training(
  p_id uuid, p_title text, p_notes text, p_method text, p_due date, p_repeat integer, p_pass integer,
  p_doc_path text, p_doc_name text, p_questions jsonb, p_users uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  carers uuid[];
  q jsonb;
  qid uuid;
  pos integer := 0;
  opt_count integer;
  cr integer;
  uid uuid;
  who text;
  due_text text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if p_id is null or p_method not in ('upload', 'quiz', 'in_person') then
    raise exception 'That training is not valid.';
  end if;
  if p_doc_path is not null and p_doc_path not like ('docs/' || p_id::text || '/%') then
    raise exception 'That document does not belong to this training.';
  end if;

  -- Who: only active caregivers, never family members, health proxies or administrators.
  if p_users is null then
    select array_agg(user_id) into carers from staff_accounts where role = 'caregiver' and approved and not coalesce(suspended, false);
  else
    select array_agg(user_id) into carers from staff_accounts
      where user_id = any (p_users) and role = 'caregiver' and approved and not coalesce(suspended, false);
    if coalesce(array_length(carers, 1), 0) <> coalesce(array_length(p_users, 1), 0) then
      raise exception 'Only active caregivers can be chosen.';
    end if;
  end if;
  if carers is null or array_length(carers, 1) = 0 then
    raise exception 'There are no carers to send this to.';
  end if;

  if p_method = 'quiz' and (p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0) then
    raise exception 'Add at least one question.';
  end if;

  insert into trainings (id, title, notes, method, due_date, repeat_months, pass_mark, doc_path, doc_name, created_by)
  values (p_id, btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_method, p_due, p_repeat, coalesce(p_pass, 80), p_doc_path, p_doc_name, auth.uid());

  if p_method = 'quiz' then
    for q in select * from jsonb_array_elements(p_questions) loop
      opt_count := jsonb_array_length(q->'options');
      cr := (q->>'correct')::integer;
      if opt_count < 2 or opt_count > 6 or cr is null or cr < 0 or cr >= opt_count then
        raise exception 'Each question needs 2 to 6 answers and one correct answer.';
      end if;
      pos := pos + 1;
      insert into training_questions (training_id, position, prompt, options)
      values (p_id, pos, btrim(q->>'prompt'), q->'options') returning id into qid;
      insert into training_answer_key (question_id, correct) values (qid, cr);
    end loop;
  end if;

  who := training_person_name(auth.uid());
  due_text := case when p_due is null then '' else ' It is due ' || to_char(p_due, 'Mon FMDD, YYYY') || '.' end;
  foreach uid in array carers loop
    insert into training_assignments (training_id, user_id, due_date) values (p_id, uid, p_due);
    perform training_notify(auth.uid(), uid, 'A training was set for you: ' || btrim(p_title) || '.' || due_text || ' Open Strovia and look under Training on your Home page.');
  end loop;
  return p_id;
end;
$$;
revoke execute on function create_training(uuid, text, text, text, date, integer, integer, text, text, jsonb, uuid[]) from public, anon;
grant execute on function create_training(uuid, text, text, text, date, integer, integer, text, text, jsonb, uuid[]) to authenticated;

-- 6. A carer sends back a completed copy, or their quiz answers ---------------------------------------------------------
create or replace function training_tell_admins(p_from uuid, p_text text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  adm uuid;
begin
  for adm in select user_id from staff_accounts where role = 'admin' and approved and not coalesce(suspended, false) loop
    perform training_notify(p_from, adm, p_text);
  end loop;
end;
$$;
revoke execute on function training_tell_admins(uuid, text) from public, anon, authenticated;

create or replace function submit_training_upload(p_assignment uuid, p_path text, p_name text, p_signed text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a training_assignments;
  t trainings;
begin
  select * into a from training_assignments where id = p_assignment and user_id = auth.uid() and status = 'assigned';
  if not found then
    raise exception 'That training is not waiting for you.';
  end if;
  select * into t from trainings where id = a.training_id and archived_at is null;
  if not found or t.method <> 'upload' then
    raise exception 'That training is not finished by sending a file.';
  end if;
  if p_path is null or p_path !~ ('^sub/' || auth.uid()::text || '/' || p_assignment::text || '/[^/]+$') then
    raise exception 'That file does not belong to you.';
  end if;
  if p_signed is null or char_length(btrim(p_signed)) = 0 then
    raise exception 'Type your name to confirm this is your own work.';
  end if;
  update training_assignments set status = 'submitted', submission_path = p_path, submission_name = left(p_name, 200),
         signed_name = left(btrim(p_signed), 120), answers = null, score = null, submitted_at = now(), returned_note = null
   where id = p_assignment;
  perform training_tell_admins(auth.uid(), 'I have sent back my completed copy of: ' || t.title || '.');
end;
$$;
revoke execute on function submit_training_upload(uuid, text, text, text) from public, anon;
grant execute on function submit_training_upload(uuid, text, text, text) to authenticated;

create or replace function submit_training_quiz(p_assignment uuid, p_answers jsonb, p_signed text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a training_assignments;
  t trainings;
  total integer;
  right_count integer := 0;
  i integer := 0;
  r record;
  chosen integer;
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
  update training_assignments set status = 'submitted', answers = p_answers, score = round(100.0 * right_count / total),
         signed_name = left(btrim(p_signed), 120), submission_path = null, submission_name = null, submitted_at = now(), returned_note = null
   where id = p_assignment;
  perform training_tell_admins(auth.uid(), 'I have sent back my answers for the quiz: ' || t.title || '.');
end;
$$;
revoke execute on function submit_training_quiz(uuid, jsonb, text) from public, anon;
grant execute on function submit_training_quiz(uuid, jsonb, text) to authenticated;

-- 7. The administrator sends it back, reminds, or issues the certificate -----------------------------------------------
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
         answers = null, score = null, signed_name = null, submitted_at = null,
         returned_note = nullif(btrim(coalesce(p_note, '')), ''), returned_at = now()
   where id = p_assignment;
  perform training_notify(auth.uid(), a.user_id, 'Your work for "' || t.title || '" was sent back for another try.' ||
    case when nullif(btrim(coalesce(p_note, '')), '') is null then '' else ' Note: ' || btrim(p_note) end);
end;
$$;
revoke execute on function return_training(uuid, text) from public, anon;
grant execute on function return_training(uuid, text) to authenticated;

create or replace function remind_training(p_assignment uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a training_assignments;
  t trainings;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  select * into a from training_assignments where id = p_assignment and status = 'assigned';
  if not found then
    raise exception 'That training is not waiting for the carer.';
  end if;
  select * into t from trainings where id = a.training_id and archived_at is null;
  if not found then
    raise exception 'That training is no longer active.';
  end if;
  perform training_notify(auth.uid(), a.user_id, 'Reminder: please complete the training "' || t.title || '".' ||
    case when a.due_date is null then '' else ' It is due ' || to_char(a.due_date, 'Mon FMDD, YYYY') || '.' end);
end;
$$;
revoke execute on function remind_training(uuid) from public, anon;
grant execute on function remind_training(uuid) to authenticated;

create or replace function issue_training_certificate(p_assignment uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a training_assignments;
  t trainings;
  today date := (now() at time zone 'America/New_York')::date;
  valid date;
  cert uuid;
  num text;
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  select * into a from training_assignments where id = p_assignment and status <> 'completed';
  if not found then
    raise exception 'That training is already complete.';
  end if;
  select * into t from trainings where id = a.training_id;
  if t.method <> 'in_person' and a.status <> 'submitted' then
    raise exception 'The carer has not sent this back yet.';
  end if;
  if t.method = 'quiz' and coalesce(a.score, 0) < t.pass_mark then
    raise exception 'The score is below the pass mark, so no certificate can be issued. Send it back instead.';
  end if;
  valid := case when t.repeat_months is null then null else (today + make_interval(months => t.repeat_months))::date end;
  num := 'STR-' || extract(year from today)::int || '-' || lpad(nextval('training_certificate_seq')::text, 4, '0');
  insert into training_certificates (assignment_id, user_id, training_id, number, holder_name, training_title, score, issued_on, valid_until, issued_by, issuer_name)
  values (a.id, a.user_id, t.id, num, training_person_name(a.user_id), t.title, case when t.method = 'quiz' then a.score end, today, valid, auth.uid(), training_person_name(auth.uid()))
  returning id into cert;
  update training_assignments set status = 'completed', completed_at = now() where id = a.id;
  -- A training that repeats starts the next round for the same carer, due when this certificate runs out.
  if valid is not null and t.archived_at is null then
    insert into training_assignments (training_id, user_id, due_date) values (t.id, a.user_id, valid) on conflict do nothing;
  end if;
  perform training_notify(auth.uid(), a.user_id, 'Your certificate for "' || t.title || '" is ready (' || num || '). You can print it from Profile, under Training.');
  return cert;
end;
$$;
revoke execute on function issue_training_certificate(uuid) from public, anon;
grant execute on function issue_training_certificate(uuid) to authenticated;

create or replace function archive_training(p_training uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  update trainings set archived_at = now() where id = p_training and archived_at is null;
end;
$$;
revoke execute on function archive_training(uuid) from public, anon;
grant execute on function archive_training(uuid) to authenticated;
