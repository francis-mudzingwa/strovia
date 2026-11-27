-- Ordinary logged-in users must not be able to write to the activity log directly (they could plant fake entries).
-- The log is still written by the database's own triggers and by log_care_plan_print, which run as the owner.
revoke execute on function log_activity(uuid, text, text) from public, anon, authenticated;
