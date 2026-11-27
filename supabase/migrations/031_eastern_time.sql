-- The office works in US Eastern Time (EST in winter, EDT in summer; the change is automatic).
--  * appointment entries in the audit trail now show Eastern Time instead of UTC (older entries keep the UTC they were written with)
--  * the weekly family summary is sent on Sunday at 9 AM Eastern: the schedule fires at 13:00 and 14:00 UTC, and the
--    function sends only in the one of those that is 9 AM in New York (so daylight saving needs no attention)

create or replace function trg_log_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform log_activity(old.patient_id, 'deleted an appointment',
      old.doctor || ' on ' || to_char(old.starts_at at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' ET');
    return old;
  end if;
  perform log_activity(
    new.patient_id,
    case when tg_op = 'INSERT' then 'added an appointment' else 'changed an appointment' end,
    new.doctor || ' on ' || to_char(new.starts_at at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' ET, ' || new.address
      || coalesce('. Notes: ' || nullif(new.notes, ''), '')
  );
  return new;
end;
$$;

select cron.unschedule('strovia-weekly-digest') where exists (select 1 from cron.job where jobname = 'strovia-weekly-digest');
do $$
declare
  secret text;
begin
  select value into secret from app_secrets where name = 'cron_secret';
  if secret is not null then
    perform cron.schedule(
      'strovia-weekly-digest',
      '0 13,14 * * 0',
      format($cmd$
        select net.http_post(
          url := 'https://tbxgxbfxndegkbqwebis.supabase.co/functions/v1/send-mail',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
          body := '{"type":"weekly_digest"}'::jsonb
        );
      $cmd$, secret)
    );
  end if;
end
$$;
