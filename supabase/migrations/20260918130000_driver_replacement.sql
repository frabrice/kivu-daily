/*
# Driver replacement link

When a new driver is added to replace someone whose contract ended,
this records that directly on the new driver's row rather than
inventing a separate join table - one new driver replaces at most one
ended driver, and the unique partial index below guarantees an ended
driver can be claimed as "replaced" by only one new hire, which is
exactly what keeps them out of the replacement dropdown once picked.
*/

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS replaced_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_replaced_driver_id_idx
  ON drivers(replaced_driver_id) WHERE replaced_driver_id IS NOT NULL;
