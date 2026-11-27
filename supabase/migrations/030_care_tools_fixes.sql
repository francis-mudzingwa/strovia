-- Two fixes to the care tools:
--  * marking a question as answered a second time no longer adds a second audit entry
--  * "I'll take them" can only name yourself (or clear it); an administrator can name anyone

create or replace function answer_question(p_note uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  n patient_notes%rowtype;
  changed int;
begin
  select * into n from patient_notes where id = p_note and kind = 'question';
  if not found then
    raise exception 'That question was not found.';
  end if;
  if not can_edit_patient(n.patient_id) then
    raise exception 'You cannot answer questions for this patient.';
  end if;
  update patient_notes set answered_at = now(), answered_by = auth.uid() where id = p_note and answered_at is null;
  get diagnostics changed = row_count;
  if changed > 0 then
    perform log_activity(n.patient_id, 'marked a question as answered', left(n.note, 120));
  end if;
end;
$$;
revoke execute on function answer_question(uuid) from public, anon;
grant execute on function answer_question(uuid) to authenticated;

create or replace function trg_check_escort() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.escort_id is not null
     and new.escort_id is distinct from old.escort_id
     and auth.uid() is not null
     and new.escort_id <> auth.uid()
     and not is_admin() then
    raise exception 'You can only put your own name down to take them.';
  end if;
  return new;
end;
$$;
drop trigger if exists check_escort on appointments;
create trigger check_escort before update on appointments for each row execute function trg_check_escort();
