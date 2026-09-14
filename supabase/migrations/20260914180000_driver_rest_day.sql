/*
# Driver weekly rest day

Every driver must take one fixed day off each week - set once when the
driver is added (or edited later by Fleet) and shown prominently on
their profile so it's obvious at a glance rather than buried in notes.
Nullable at the database level so existing drivers aren't broken by
this migration; the app's driver form requires a choice going forward.
*/

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rest_day text
  CHECK (rest_day IS NULL OR rest_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'));
