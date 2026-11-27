-- A caregiver who is off shift can no longer change today's symptom check-in.
--
-- Migration 039 stopped an off-shift caregiver STARTING a check-in (a before-insert rule). The app saves a check-in as an
-- "upsert", which runs that insert rule even when it ends up changing an existing row, so changes through the app were already
-- refused. But a direct update of an existing check-in was not covered. This adds the same rule for updates. Administrators and
-- family proxies are not shift-bound, and a caregiver with no shifts for the patient is never blocked (caregiver_on_shift
-- already says so), exactly as for inserts.

drop trigger if exists check_shift_for_checkin_update on checkins;
create trigger check_shift_for_checkin_update before update on checkins for each row execute function trg_check_shift_for_checkin();
