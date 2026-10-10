/*
# Call Center: no insider-driver details

The MD (10 Oct 2026): the Call Center must not have deposits or other
details about our own (insider) drivers. They still need to call drivers
and link a caller's complaint to the right driver, so they get only:
name, phone, car plate, contract status and pipeline stage - through
call_center_drivers(), never the drivers table itself.

- drivers, vehicles and driver_contract_events: Call Center removed from
  read access (deposits/fines/fine payments were removed on 8 Oct).
- call_center_drivers(): the minimal directory. The stage is computed here
  (active = active contract + car + initial deposit paid), so the deposit
  fact itself never leaves the database.
- call_tickets.driver_label: "name · plate" stored on the ticket when a
  driver is linked, so every department sees who a case is about without
  reading the drivers table.
*/

CREATE OR REPLACE FUNCTION call_center_drivers()
RETURNS TABLE (id uuid, full_name text, phone text, stage text, contract_status text, plate_number text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (current_department_slug() IN ('call_center', 'fleet', 'it', 'finance') OR is_managing_director()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN QUERY
  SELECT d.id, d.full_name, d.phone,
    CASE WHEN d.contract_status = 'active' AND d.vehicle_id IS NOT NULL AND d.initial_deposit_paid THEN 'active'
         WHEN d.stage = 'active' THEN 'ready'
         ELSE d.stage END::text,
    d.contract_status::text, v.plate_number, d.created_at
  FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id
  ORDER BY d.full_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION call_center_drivers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION call_center_drivers() TO authenticated, service_role;

-- Who a ticket is about, kept on the ticket itself.
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS driver_label text;

CREATE OR REPLACE FUNCTION set_call_ticket_driver_label()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.driver_id IS NULL THEN
    NEW.driver_label := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.driver_label IS NULL THEN
    SELECT d.full_name || COALESCE(' · ' || v.plate_number, '') INTO NEW.driver_label
    FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION set_call_ticket_driver_label() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS call_tickets_driver_label ON call_tickets;
CREATE TRIGGER call_tickets_driver_label BEFORE INSERT OR UPDATE OF driver_id ON call_tickets
  FOR EACH ROW EXECUTE FUNCTION set_call_ticket_driver_label();

UPDATE call_tickets t SET driver_label = d.full_name || COALESCE(' · ' || v.plate_number, '')
FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id
WHERE d.id = t.driver_id AND t.driver_label IS NULL;

-- Read access without the Call Center.
DROP POLICY IF EXISTS "drivers_select" ON drivers;
CREATE POLICY "drivers_select" ON drivers FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'it', 'finance') OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select" ON vehicles FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'it', 'finance') OR is_managing_director());

DROP POLICY IF EXISTS "driver_contract_events_select" ON driver_contract_events;
CREATE POLICY "driver_contract_events_select" ON driver_contract_events FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'it') OR is_managing_director());
