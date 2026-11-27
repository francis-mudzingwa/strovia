-- A pain score (0-10 self-reported scale) alongside the existing readings. Left out when readings were first built
-- because, unlike BP/pulse/temperature, it needs no device -- just asking the patient -- but the administrator asked
-- for it, so it now follows the exact same care-plan-range pattern as everything else in RANGE_FIELDS (ranges.js):
-- nothing is flagged unless the administrator sets a threshold in the care plan.

alter table vitals add column if not exists pain_score smallint check (pain_score between 0 and 10);

-- A reading of pain alone (with nothing else) is still a valid reading, so it must satisfy the existing
-- "at least one reading present" rule too.
alter table vitals drop constraint if exists vitals_has_a_reading;
alter table vitals add constraint vitals_has_a_reading check (
  systolic is not null or pulse is not null or glucose is not null or weight_lb is not null
  or temperature is not null or oxygen_saturation is not null or pain_score is not null
);
