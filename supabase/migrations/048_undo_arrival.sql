-- Lets a caregiver take back an "I've arrived" tapped by mistake. Only their own open arrival, and only within two
-- minutes of tapping it, so it can't be used to rewrite the record afterwards. The arrival row is removed (not marked
-- as left), so the administrator never sees a false "arrived and left" entry. The audit trail records that it happened.

create or replace function undo_clock_in(p_attendance uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a shift_attendance%rowtype;
begin
  if auth.uid() is null or not is_approved_caregiver() then
    raise exception 'Only an approved caregiver can do this.';
  end if;
  select * into a from shift_attendance
    where id = p_attendance and caregiver_id = auth.uid() and left_at is null and arrived_at > now() - interval '2 minutes';
  if not found then
    raise exception 'That arrival can no longer be undone.';
  end if;
  delete from shift_attendance where id = p_attendance;
  perform log_activity(a.patient_id, 'cancelled an arrival tapped by mistake', null);
end;
$$;
revoke execute on function undo_clock_in(uuid) from public, anon;
grant execute on function undo_clock_in(uuid) to authenticated;
