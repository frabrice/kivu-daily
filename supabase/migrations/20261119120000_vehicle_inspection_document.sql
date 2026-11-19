/*
# Kivu Ride inspection document for every car (19 Nov 2026)

Every car we manage has Kivu Ride's inspection document. It is uploaded
when the car is added under Fleet, in the same step: the car can't be
saved without it. Cars added before today show "Inspection missing" until
Fleet adds theirs (on the car's page or Fleet -> Contracts -> Missing).

- contract_documents gets vehicle_id and the kind 'vehicle_inspection'.
  A document now belongs to exactly one of: a driver, an owner, a car.
- Like a termination letter, an inspection document is not "signed and
  stamped" by both sides, so that rule doesn't apply to it.
- Files go in the same private 'legal-docs' bucket; who can see and add
  them is unchanged (Fleet, IT, MD add; Fleet, IT, Finance, MD see).
- A car can have several over time (re-inspections); the newest counts.
*/

ALTER TABLE contract_documents ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS contract_documents_vehicle_idx ON contract_documents (vehicle_id);

ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_kind_check;
ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_kind_check
  CHECK (kind IN ('driver_contract', 'driver_contract_amendment', 'driver_termination_letter', 'owner_management_agreement', 'vehicle_inspection'));

-- One subject per document: a driver, an owner or a car.
ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_check;
ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_one_subject;
ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_one_subject CHECK (num_nonnulls(driver_id, owner_id, vehicle_id) = 1);
ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_vehicle_kind;
ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_vehicle_kind CHECK ((kind = 'vehicle_inspection') = (vehicle_id IS NOT NULL));

-- Contracts, amendments and agreements only count when signed and stamped.
ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_check2;
ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_sealed;
ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_sealed
  CHECK (kind IN ('driver_termination_letter', 'vehicle_inspection') OR (signed AND stamped));

-- An inspection document for a car (a missing one, or a re-inspection).
CREATE OR REPLACE FUNCTION add_vehicle_inspection(p_vehicle uuid, d jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF d IS NULL OR NULLIF(d->>'file_path', '') IS NULL THEN RAISE EXCEPTION 'Attach the Kivu Ride inspection document'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle) THEN RAISE EXCEPTION 'Car not found'; END IF;
  INSERT INTO contract_documents (kind, vehicle_id, document_date, signed, stamped, file_path, file_name, notes)
  VALUES ('vehicle_inspection', p_vehicle, COALESCE(NULLIF(d->>'document_date', '')::date, (now() AT TIME ZONE 'Africa/Kigali')::date),
          false, false, d->>'file_path', COALESCE(NULLIF(d->>'file_name', ''), 'inspection'), NULLIF(trim(d->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Add a car and its inspection document in one step (both or neither).
CREATE OR REPLACE FUNCTION create_vehicle_with_inspection(p jsonb, d jsonb)
RETURNS vehicles LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v vehicles;
BEGIN
  IF d IS NULL OR NULLIF(d->>'file_path', '') IS NULL THEN RAISE EXCEPTION 'Attach the Kivu Ride inspection document'; END IF;
  IF NULLIF(trim(p->>'plate_number'), '') IS NULL THEN RAISE EXCEPTION 'Enter the plate number'; END IF;
  INSERT INTO vehicles (id, plate_number, make, model, color, device_label, documents, notes, given_date, operation_start_date,
                        rura_license_status, rura_license_issued_date, rura_license_expiry_date, created_by)
  VALUES (COALESCE(NULLIF(p->>'id', '')::uuid, gen_random_uuid()), upper(trim(p->>'plate_number')),
          NULLIF(trim(p->>'make'), ''), NULLIF(trim(p->>'model'), ''), NULLIF(trim(p->>'color'), ''), NULLIF(trim(p->>'device_label'), ''),
          COALESCE(p->'documents', '[]'::jsonb), NULLIF(trim(p->>'notes'), ''),
          NULLIF(p->>'given_date', '')::date, NULLIF(p->>'operation_start_date', '')::date,
          COALESCE(NULLIF(p->>'rura_license_status', ''), 'pending'),
          NULLIF(p->>'rura_license_issued_date', '')::date, NULLIF(p->>'rura_license_expiry_date', '')::date, auth.uid())
  RETURNING * INTO v;
  PERFORM add_vehicle_inspection(v.id, d);
  RETURN v;
END $$;

REVOKE EXECUTE ON FUNCTION add_vehicle_inspection(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_vehicle_inspection(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION create_vehicle_with_inspection(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_vehicle_with_inspection(jsonb, jsonb) TO authenticated;
