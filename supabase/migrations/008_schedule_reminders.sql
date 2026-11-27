-- Runs the send-reminders function every minute.
-- Replace __CRON_SECRET__ with the same value stored as the function's CRON_SECRET secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('strovia-send-reminders')
where exists (select 1 from cron.job where jobname = 'strovia-send-reminders');

select cron.schedule(
  'strovia-send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://tbxgxbfxndegkbqwebis.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{}'::jsonb
  );
  $$
);
