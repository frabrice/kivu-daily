/*
# Call Center gets full read visibility into Fleet

Call Center now gets a "Fleet" page that's the exact same bundled,
tabbed view the MD sees (Driver Pipeline / Vehicles / Deposits / Fines /
Non-Insider) - not fragmented into separate sidebar pages the way Fleet's
own staff see it. Drivers and vehicles were already readable by Call
Center (Phase 2.1); deposits and fines were fleet-only, which would have
left those two tabs silently empty for Call Center. Extending SELECT
only - write access to deposits/fines stays fleet + MD, same as before,
so this is visibility, not new editing ability.
*/

DROP POLICY IF EXISTS "driver_deposits_select" ON driver_deposits;
CREATE POLICY "driver_deposits_select" ON driver_deposits FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_select" ON driver_fines;
CREATE POLICY "driver_fines_select" ON driver_fines FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director());
