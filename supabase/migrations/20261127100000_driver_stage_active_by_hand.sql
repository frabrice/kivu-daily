/*
# Drivers can be made Active by hand (MD, 27 Nov 2026)

'Active' can be picked again on the driver form. It still only counts
while the driver is on a car with a running contract; otherwise they show
as Ready (effectiveStage() in src/lib/fleet.ts, and call_center_drivers()
below, follow the same rule).
*/

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_stage_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_stage_check
  CHECK (stage IN ('applying', 'raw', 'ready', 'active', 'flagged', 'inactive'));

CREATE OR REPLACE FUNCTION call_center_drivers()
RETURNS TABLE (id uuid, full_name text, phone text, stage text, contract_status text, plate_number text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (current_department_slug() IN ('call_center', 'fleet', 'it', 'finance') OR is_managing_director()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN QUERY
  SELECT d.id, d.full_name, d.phone,
    CASE WHEN d.contract_status = 'active' AND d.vehicle_id IS NOT NULL AND (d.initial_deposit_paid OR d.opening_credit > 0 OR d.stage = 'active') THEN 'active'
         WHEN d.stage = 'active' THEN 'ready'
         ELSE d.stage END::text,
    d.contract_status::text, v.plate_number, d.created_at
  FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id
  ORDER BY d.full_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION call_center_drivers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION call_center_drivers() TO authenticated, service_role;
