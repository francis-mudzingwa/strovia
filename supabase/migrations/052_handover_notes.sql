-- A note from the caregiver who is leaving, for the one arriving: the human part of a handover that no record captures
-- (she was tired after therapy, ate half her lunch, the family visits tomorrow). Written in a short "Before you go" box when
-- the caregiver taps "I'm leaving"; the next caregiver sees the latest one at the top of the Shift handover card.
--
-- Anyone assigned to the patient and the administrator can add one. Only the author (or an administrator) can change or
-- remove it. The quick tags are a fixed list so they can be shown and counted reliably.

create table if not exists handover_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  note text check (note is null or char_length(note) <= 600),
  tags text[] not null default '{}' check (cardinality(tags) <= 5 and tags <@ array['ate_well', 'tired', 'mood_low', 'follow_up', 'quiet']::text[]),
  created_at timestamptz not null default now(),
  constraint handover_note_has_content check ((note is not null and char_length(btrim(note)) > 0) or cardinality(tags) > 0)
);
create index if not exists handover_notes_patient_idx on handover_notes (patient_id, created_at desc);

alter table handover_notes enable row level security;
revoke all on handover_notes from anon;

drop policy if exists "view handover notes" on handover_notes;
create policy "view handover notes" on handover_notes for select using (can_view_patient(patient_id));
drop policy if exists "add handover note" on handover_notes;
create policy "add handover note" on handover_notes for insert with check (can_edit_patient(patient_id) and author_id = auth.uid());
drop policy if exists "change own handover note" on handover_notes;
create policy "change own handover note" on handover_notes for update
  using (author_id = auth.uid() or is_admin()) with check (can_edit_patient(patient_id) and (author_id = auth.uid() or is_admin()));
drop policy if exists "remove own handover note" on handover_notes;
create policy "remove own handover note" on handover_notes for delete using (author_id = auth.uid() or is_admin());
