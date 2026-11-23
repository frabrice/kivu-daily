/*
# Pay for the next day + each driver's usual pay day (MD, 23 Nov 2026)

From 23 Nov 2026 drivers no longer all pay the whole week by Sunday: each
pays for the day they are going to work, the day before (the same day is
tolerated), any amount, so each has their own pay day. The rule itself is
in supabase/functions/_shared/depositRules.ts (DAILY_RULE_START).

drivers.payment_day: the weekday a driver usually pays on, set by Fleet or
the MD. It's a reminder for whoever follows up payments; who is cleared to
drive still comes from what they have actually paid.
*/

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS payment_day text
  CHECK (payment_day IS NULL OR payment_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'));
