-- DEMO PROJECT ONLY. Never run this in the real Strovia project.
-- It fills a separate, throw-away Supabase project with made-up staff and sample history so that anyone can try the app.
-- demo_reset() wipes every record the demo visitors may have changed and rebuilds the sample history from scratch.
-- It runs nightly (see the cron job at the bottom), so one visitor's edits never confuse the next.

create or replace function demo_noise(seed text) returns numeric
language sql immutable as $$ select (abs(hashtext(seed)) % 1000) / 1000.0 $$;

create or replace function demo_reset() returns void
language plpgsql security definer set search_path = public as $$
declare
  adm uuid := '4afc5359-73c8-42c4-a81a-c17da09e1e09';
  sam uuid := '8ed1bc28-141c-422f-b5b4-9cea8d88efb1';
  jordan uuid := '54912a8a-5984-46d1-a92b-b79e0413e321';
  riley uuid := 'e5937c1e-276c-4e7c-bd56-982c1937f1b5';
  eleanor uuid; marcus uuid; ingrid uuid; naomi uuid;
  today date := (now() at time zone 'America/New_York')::date;
  p record; d int; k text; v int; sym jsonb; prog numeric; pid uuid;
begin
  select id into eleanor from patients where full_name = 'Eleanor Whitfield';
  select id into marcus from patients where full_name = 'Marcus Delgado';
  select id into ingrid from patients where full_name = 'Ingrid Halvorsen';
  select id into naomi from patients where full_name = 'Naomi Fairweather';
  if eleanor is null or marcus is null or ingrid is null or naomi is null then
    raise exception 'The sample patients are missing.';
  end if;

  -- 1. Wipe everything visitors can create or change ---------------------------------------------------------------
  delete from messages; delete from message_reads; delete from message_threads where kind = 'direct';
  delete from checkins; delete from checkin_versions; delete from symptom_actions; delete from incidents;
  delete from vitals; delete from medication_log; delete from medication_missed_alerts; delete from medication_due_reminders;
  delete from task_log; delete from meal_log; delete from bowel_log; delete from exercise_log;
  delete from patient_notes; delete from handover_notes; delete from shift_attendance;
  delete from appointments; delete from visits; delete from visit_log;
  delete from activity_log; delete from sign_in_log; delete from login_attempts; delete from push_subscriptions;
  delete from profile_change_requests; delete from ai_insights; delete from ai_calls;
  delete from shifts; delete from patient_assignments where user_id in (sam, jordan, riley);

  -- 2. The made-up people -----------------------------------------------------------------------------------------------
  insert into staff_accounts (user_id, company_id, organisation, first_name, last_name, job_title, phone, role, approved, suspended, login_code_enabled, birthday_month, birthday_day)
  values
    (adm, null, 'Strovia demo', 'Alex', 'Rivera', 'Care coordinator (demo administrator)', '', 'admin', true, false, false, extract(month from today + 40)::int, extract(day from today + 40)::int),
    (sam, null, 'Strovia demo', 'Sam', 'Carter', 'Caregiver (demo)', '', 'caregiver', true, false, false, extract(month from today + 9)::int, extract(day from today + 9)::int),
    (jordan, null, 'Strovia demo', 'Jordan', 'Lee', 'Caregiver (demo)', '', 'caregiver', true, false, false, extract(month from today + 21)::int, extract(day from today + 21)::int),
    (riley, null, '', 'Riley', 'Whitfield', 'Family member (demo)', '', 'relative', true, false, false, null, null)
  on conflict (user_id) do update set role = excluded.role, approved = true, suspended = false, login_code_enabled = false,
    first_name = excluded.first_name, last_name = excluded.last_name, job_title = excluded.job_title,
    birthday_month = excluded.birthday_month, birthday_day = excluded.birthday_day;

  insert into patient_assignments (patient_id, user_id, assigned_by, is_primary) values
    (eleanor, sam, adm, true), (marcus, sam, adm, false), (ingrid, sam, adm, false),
    (marcus, jordan, adm, true), (naomi, jordan, adm, false),
    (eleanor, riley, adm, false)
  on conflict do nothing;

  -- Only four sample patients are shown in the demo; the rest are archived (hidden). The four get reading levels from a
  -- made-up "doctor", so the reading checks have something to compare against.
  update patients set archived_at = now() where id not in (eleanor, marcus, ingrid, naomi) and archived_at is null;
  update patients
     set care_plan = coalesce(care_plan, '{}'::jsonb) || jsonb_build_object(
           'readingsNeeded', true,
           'ranges', '{"systolic_min":"100","systolic_max":"150","systolic_red_max":"170","diastolic_max":"95","diastolic_red_max":"110","pulse_min":"50","pulse_max":"100","glucose_min":"70","glucose_max":"180","glucose_red_max":"300"}'::jsonb)
   where id in (eleanor, marcus, ingrid, naomi);

  -- Sam is scheduled every day, all day, for Eleanor, so the Arrive button always works (the database refuses overlapping
  -- shifts, so one patient only). With no schedule for a patient, a caregiver is never blocked, so Sam's other patients and
  -- all of Jordan's patients stay open.
  insert into shifts (patient_id, caregiver_id, weekday, start_time, end_time, starts_on, ends_on, notes, created_by, ends_after_days)
  select eleanor, sam, wd, time '00:00', time '23:59', today - 1, null, 'Demo schedule: every day', adm, 0
    from generate_series(0, 6) as wd;

  -- 3. Sample symptom check-ins: gradual improvement with ordinary ups and downs ------------------------------------------
  for p in select * from (values
      (eleanor, 21, '{"balance":2,"vision":1,"face":1,"arm":2,"speech":2,"headache":1,"fatigue":2}'::jsonb),
      (marcus, 14, '{"balance":2,"vision":1,"face":1,"arm":2,"speech":1,"headache":1,"fatigue":2}'::jsonb),
      (ingrid, 14, '{"balance":1,"vision":1,"face":1,"arm":2,"speech":2,"headache":0,"fatigue":2}'::jsonb),
      (naomi, 10, '{"balance":2,"vision":1,"face":0,"arm":1,"speech":2,"headache":1,"fatigue":1}'::jsonb)
    ) as t(pid, n, base)
  loop
    for d in reverse p.n..1 loop
      prog := (p.n - d)::numeric / p.n;
      sym := '{}'::jsonb;
      for k in select jsonb_object_keys(p.base) loop
        v := greatest(0, least(2, round((p.base->>k)::numeric * (1 - 0.65 * prog) + (demo_noise(p.pid::text || d::text || k) - 0.5) * 1.4)::int));
        sym := sym || jsonb_build_object(k, v);
      end loop;
      insert into checkins (patient_id, recorded_by, entry_date, symptoms, feeling, notes, created_at, updated_at)
      values (p.pid, sam, today - d, sym,
              greatest(1, least(5, round(2 + 3 * prog + (demo_noise(p.pid::text || d::text || 'f') - 0.5) * 1.6)::int)),
              case when d = 15 and p.pid = eleanor then 'Walked to the kitchen with the walker and ate a good lunch.'
                   when d = 6 and p.pid = eleanor then 'A little tired after therapy but in good spirits.' end,
              ((today - d) + time '18:00') at time zone 'America/New_York',
              ((today - d) + time '18:00') at time zone 'America/New_York');
    end loop;
  end loop;

  -- 4. Sample readings (blood pressure, pulse, blood sugar), twice a day ------------------------------------------------------
  insert into vitals (patient_id, taken_at, recorded_by, systolic, diastolic, pulse, glucose)
  select pid2, ((today - dd) + tm) at time zone 'America/New_York', sam,
         case when pid2 = eleanor and dd = 5 and tm = time '07:30' then 168
              else 118 + (abs(hashtext(pid2::text || dd::text || tm::text)) % 26) - (dd / 3) end,
         case when pid2 = eleanor and dd = 5 and tm = time '07:30' then 98
              else 68 + (abs(hashtext('d' || pid2::text || dd::text || tm::text)) % 14) end,
         62 + (abs(hashtext('p' || pid2::text || dd::text || tm::text)) % 20),
         105 + (abs(hashtext('g' || pid2::text || dd::text || tm::text)) % 45)
    from unnest(array[eleanor, marcus]) as pid2, generate_series(1, 10) as dd, unnest(array[time '07:30', time '19:30']) as tm;

  -- The one high reading was followed up at the time
  update vitals set acknowledged_by = sam, acknowledged_at = taken_at + interval '20 minutes',
                    action_note = 'Rested for ten minutes and checked again; it came down. Told the nurse.'
   where level is not null and acknowledged_at is null;

  -- 5. A few notes, handovers, meals, visits and appointments ----------------------------------------------------------------
  insert into patient_notes (patient_id, author_id, author_name, author_role, note, kind, created_at) values
    (eleanor, sam, 'Sam Carter', 'caregiver', 'Practised standing from the chair three times. Steady with the walker.', 'note', now() - interval '2 days'),
    (eleanor, riley, 'Riley Whitfield', 'relative', 'Mum was cheerful on the phone today and found her words more easily.', 'note', now() - interval '1 day'),
    (marcus, jordan, 'Jordan Lee', 'caregiver', 'Enjoyed a short walk in the garden with supervision.', 'note', now() - interval '1 day');
  insert into handover_notes (patient_id, author_id, note, tags, created_at) values
    (eleanor, sam, 'Slept well. Ate most of breakfast. Please remind her to rest her right arm in the afternoon.', array['ate_well'], now() - interval '20 hours'),
    (marcus, jordan, 'A little tired this evening. Offered extra fluids.', array['tired'], now() - interval '18 hours');
  -- Meals for the past six days (a missing day or two keeps it believable). The "too long ago to add" rule is for real
  -- users, so it is paused for this one insert.
  alter table meal_log disable trigger meal_time_of_day;
  insert into meal_log (patient_id, log_date, meal, amount, drinks, trouble, note, done_by, done_at)
  select pid2, today - dd, m,
         (array['all', 'most', 'most', 'half'])[1 + (abs(hashtext(pid2::text || dd::text || m)) % 4)], 'well', false, null, sam,
         ((today - dd) + case m when 'breakfast' then time '08:30' when 'lunch' then time '12:45' else time '18:15' end) at time zone 'America/New_York'
    from unnest(array[eleanor, marcus]) as pid2, generate_series(1, 6) as dd, unnest(array['breakfast', 'lunch', 'dinner']) as m
   where not (dd = 4 and m = 'lunch');
  alter table meal_log enable trigger meal_time_of_day;
  insert into visits (patient_id, visitor_name, visit_type, weekday, start_time, end_time, starts_on, notes, created_by) values
    (eleanor, 'Pat Morgan', 'Physical therapy', 2, time '14:00', time '15:00', today - 30, 'Balance and walking practice.', adm),
    (eleanor, 'Dana Okafor', 'Occupational therapy', 4, time '11:00', time '12:00', today - 30, 'Right hand and arm exercises.', adm),
    (marcus, 'Chris Alvarez', 'Nurse visit', 1, time '10:00', time '10:45', today - 30, 'Blood pressure and medicine check.', adm);
  -- Mark each of this week's visits as having happened
  insert into visit_log (visit_id, patient_id, occurred_on, status, recorded_by, recorded_at)
  select v.id, v.patient_id, today - dd, 'happened', sam, ((today - dd) + v.end_time) at time zone 'America/New_York'
    from visits v, generate_series(0, 6) as dd
   where extract(dow from today - dd)::int = v.weekday and ((today - dd) + v.end_time) at time zone 'America/New_York' < now();
  insert into appointments (created_by, patient_name, patient_id, doctor, specialty, starts_at, place_name, address, notes, remind)
  values
    (adm, 'Eleanor Whitfield', eleanor, 'Dr. Amara Osei', 'Neurology', ((today + 6) + time '10:30') at time zone 'America/New_York', 'Springfield Neurology Clinic', '120 Example Avenue, Springfield, MA', 'Follow-up after the stroke. Bring the reading log.', false),
    (adm, 'Marcus Delgado', marcus, 'Dr. Lena Park', 'Cardiology', ((today + 9) + time '14:00') at time zone 'America/New_York', 'Riverside Heart Centre', '45 Sample Road, Worcester, MA', 'Blood pressure review.', false);

  -- 6. A sample AI-style note for each patient (the demo never calls an AI service) --------------------------------------------------
  insert into ai_insights (patient_id, explanation, mobility_progress, speech_progress, cognitive_progress, adl_progress, recovery_level, trend, updated_at)
  select pid2, null,
         'Balance and arm strength are slowly improving, with an ordinary off day now and then.',
         'Speech is clearer than two weeks ago; word-finding is still tiring late in the day.',
         'Thinking and attention look steady.',
         'Needs less help with dressing and meals than before.',
         'Mild', 'Improving', now()
    from unnest(array[eleanor, marcus, ingrid, naomi]) as pid2;
end;
$$;
revoke execute on function demo_reset() from public, anon, authenticated;

select demo_reset();

-- Rebuild the sample history every night at midnight Eastern (05:00 UTC; 04:00 in summer, close enough for a demo).
select cron.schedule('strovia-demo-reset', '0 5 * * *', 'select demo_reset()');
