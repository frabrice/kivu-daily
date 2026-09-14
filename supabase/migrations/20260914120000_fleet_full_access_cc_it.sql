/*
# Full Fleet access for Call Center and IT

Call Center and IT both now get the exact same bundled Fleet page the MD
sees (Driver Pipeline / Vehicles / Deposits / Fines / Non-Insider), with
the same read AND write access as Fleet's own staff - not a read-only
mirror. Extends every Fleet-related write policy (drivers, vehicles,
driver_deposits, driver_fines) and the Non-Insider tables
(platform_drivers, platform_cars) from fleet-only (or fleet+call_center)
to fleet + call_center + it, alongside the MD.
*/

DROP POLICY IF EXISTS "drivers_select" ON drivers;
CREATE POLICY "drivers_select" ON drivers FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "drivers_insert" ON drivers;
CREATE POLICY "drivers_insert" ON drivers FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "drivers_update" ON drivers;
CREATE POLICY "drivers_update" ON drivers FOR UPDATE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "drivers_delete" ON drivers;
CREATE POLICY "drivers_delete" ON drivers FOR DELETE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select" ON vehicles FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_insert" ON vehicles;
CREATE POLICY "vehicles_insert" ON vehicles FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_update" ON vehicles;
CREATE POLICY "vehicles_update" ON vehicles FOR UPDATE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_delete" ON vehicles;
CREATE POLICY "vehicles_delete" ON vehicles FOR DELETE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_deposits_select" ON driver_deposits;
CREATE POLICY "driver_deposits_select" ON driver_deposits FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_deposits_insert" ON driver_deposits;
CREATE POLICY "driver_deposits_insert" ON driver_deposits FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_deposits_update" ON driver_deposits;
CREATE POLICY "driver_deposits_update" ON driver_deposits FOR UPDATE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_deposits_delete" ON driver_deposits;
CREATE POLICY "driver_deposits_delete" ON driver_deposits FOR DELETE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_select" ON driver_fines;
CREATE POLICY "driver_fines_select" ON driver_fines FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_insert" ON driver_fines;
CREATE POLICY "driver_fines_insert" ON driver_fines FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_update" ON driver_fines;
CREATE POLICY "driver_fines_update" ON driver_fines FOR UPDATE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_delete" ON driver_fines;
CREATE POLICY "driver_fines_delete" ON driver_fines FOR DELETE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "platform_cars_select" ON platform_cars;
CREATE POLICY "platform_cars_select" ON platform_cars FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "platform_cars_write" ON platform_cars;
CREATE POLICY "platform_cars_write" ON platform_cars FOR ALL TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "platform_drivers_select" ON platform_drivers;
CREATE POLICY "platform_drivers_select" ON platform_drivers FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "platform_drivers_write" ON platform_drivers;
CREATE POLICY "platform_drivers_write" ON platform_drivers FOR ALL TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());
