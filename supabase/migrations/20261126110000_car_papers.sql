/*
# Every car's papers: yellow card, insurance, RURA licence (MD, 26 Nov 2026)

Besides Kivu Ride's inspection document, every car should have on file:
- its yellow card (the registration card),
- its insurance (with the date it expires),
- its RURA licence (with the date it expires).
Each is uploaded like the other papers (private 'legal-docs' bucket,
contract_documents with vehicle_id). A car without one - or whose insurance
or RURA licence has expired - shows under Admin -> Missing -> Cars.

- contract_documents.expires_on: when an insurance or a licence runs out.
- add_vehicle_document(car, kind, doc): records one; a RURA licence also
  updates the car's RURA licence status and dates.
*/

ALTER TABLE contract_documents ADD COLUMN IF NOT EXISTS expires_on date;

ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_kind_check;
ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_kind_check
  CHECK (kind IN ('driver_contract', 'driver_contract_amendment', 'driver_termination_letter', 'owner_management_agreement',
                  'vehicle_inspection', 'vehicle_yellow_card', 'vehicle_insurance', 'vehicle_rura_license'));

-- A car's papers belong to a car, and only to a car.
ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_vehicle_kind;
ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_vehicle_kind CHECK ((kind LIKE 'vehicle\_%') = (vehicle_id IS NOT NULL));

-- Car papers aren't "signed and stamped" by both sides.
ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_sealed;
ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_sealed
  CHECK (kind = 'driver_termination_letter' OR kind LIKE 'vehicle\_%' OR (signed AND stamped));

CREATE OR REPLACE FUNCTION add_vehicle_document(p_vehicle uuid, p_kind text, d jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_date date := COALESCE(NULLIF(d->>'document_date', '')::date, (now() AT TIME ZONE 'Africa/Kigali')::date);
  v_expires date := NULLIF(d->>'expires_on', '')::date;
BEGIN
  IF p_kind NOT IN ('vehicle_inspection', 'vehicle_yellow_card', 'vehicle_insurance', 'vehicle_rura_license') THEN RAISE EXCEPTION 'Unknown document type'; END IF;
  IF d IS NULL OR NULLIF(d->>'file_path', '') IS NULL THEN RAISE EXCEPTION 'Attach the document'; END IF;
  IF p_kind IN ('vehicle_insurance', 'vehicle_rura_license') AND v_expires IS NULL THEN RAISE EXCEPTION 'Enter the date it expires'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle) THEN RAISE EXCEPTION 'Car not found'; END IF;
  INSERT INTO contract_documents (kind, vehicle_id, document_date, expires_on, signed, stamped, file_path, file_name, notes)
  VALUES (p_kind, p_vehicle, v_date, v_expires, false, false, d->>'file_path', COALESCE(NULLIF(d->>'file_name', ''), 'document'), NULLIF(trim(d->>'notes'), ''))
  RETURNING id INTO v_id;
  -- The RURA licence on file is the car's licence.
  IF p_kind = 'vehicle_rura_license' THEN
    UPDATE vehicles SET rura_license_status = 'provided', rura_license_issued_date = v_date, rura_license_expiry_date = v_expires, updated_at = now()
    WHERE id = p_vehicle;
  END IF;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION add_vehicle_document(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_vehicle_document(uuid, text, jsonb) TO authenticated;
