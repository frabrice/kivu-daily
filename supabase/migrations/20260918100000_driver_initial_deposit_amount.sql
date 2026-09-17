/*
# Initial deposit amount

initial_deposit_paid/initial_deposit_date recorded THAT a driver paid
their first deposit and WHEN, but never HOW MUCH - so "Total Deposited"
on the driver profile could only ever sum driver_deposits (the weekly
payments logged through the app since), silently leaving every
driver's real first payment out of their own total.

Backfilled to the standard 180,000 RWF weekly amount for every driver
already marked as paid, since the initial deposit is described as the
same weekly deposit made in advance when a driver starts - editable
going forward in case a specific driver's was actually different.
*/

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS initial_deposit_amount numeric;

UPDATE drivers SET initial_deposit_amount = 180000
WHERE initial_deposit_paid = true AND initial_deposit_amount IS NULL;

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_initial_deposit_amount_matches_paid;
ALTER TABLE drivers ADD CONSTRAINT drivers_initial_deposit_amount_matches_paid
  CHECK (
    (initial_deposit_paid = false AND initial_deposit_amount IS NULL)
    OR (initial_deposit_paid = true AND initial_deposit_amount IS NOT NULL)
  );
