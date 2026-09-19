/*
# Vehicle owner payment day

A contractual reference field Finance can log per owner - which day of
the week they're paid. This is informational only: the actual weekly
payout/margin schedule (sync_vehicle_obligations) still counts from
each vehicle's own operation_start_date, since an owner can have more
than one car with different start dates. If payment day should instead
drive the schedule, that's a separate follow-up.
*/

ALTER TABLE vehicle_owners ADD COLUMN IF NOT EXISTS payment_day text
  CHECK (payment_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'));
