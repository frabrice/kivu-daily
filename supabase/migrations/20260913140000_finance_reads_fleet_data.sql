/*
# Let Finance read drivers/vehicles

The Finance module needs to attribute a vehicle-owner payment to a real
vehicle, a fleet collection to a real driver, and compute "active/
operational cars" and "drivers" for the dashboard - all read-only.
Call Center already has this same read-only grant for its own reasons;
extending it to Finance follows the same precedent rather than opening
these tables further.
*/

DROP POLICY IF EXISTS "drivers_select" ON drivers;
CREATE POLICY "drivers_select" ON drivers FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'finance') OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select" ON vehicles FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'finance') OR is_managing_director());
