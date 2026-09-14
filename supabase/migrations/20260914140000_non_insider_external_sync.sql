/*
# External sync identity for Non-Insider drivers/cars

Adds a stable link back to the rider-facing platform's own driver/vehicle
ids so a repeat sync can update an existing row instead of creating a
duplicate every time it runs. Nullable, since a driver or car added by
hand inside Daily (not sourced from the platform) has no external
counterpart.
*/

ALTER TABLE platform_drivers ADD COLUMN IF NOT EXISTS external_id integer UNIQUE;
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS external_id integer UNIQUE;
