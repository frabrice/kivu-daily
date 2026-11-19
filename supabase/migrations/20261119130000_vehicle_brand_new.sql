/*
# "Brand new car" instead of an inspection document (19 Nov 2026)

A brand new car has no Kivu Ride inspection document: ticking "Brand new
car" takes its place. The rule starts with NGABONZIZA Karekezi's car
(RAG260T) - every car from it on needs the inspection document or the
tick. The 8 cars we had before it were all brand new, so they are marked
so here.
*/

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS brand_new boolean NOT NULL DEFAULT false;

UPDATE vehicles SET brand_new = true WHERE id IN (
  '280f141a-c5cb-4b8c-a47f-55c46fdd226e', -- RAD 413 L
  '223c6ab5-cc3b-4864-bf72-af257dce412c', -- RAK 679 J
  'bee0f380-ee54-4de4-a9fc-ab74c51e108e', -- RAK 676 J
  '0edf50a0-ba52-454c-9500-0ef02d7e62f0', -- RAK 678 J
  '0f211e43-602c-4092-b502-8c68d9b69eaa', -- RAK 238 L
  '09263915-4add-46d6-9baa-d8d1dddacfc6', -- RAK 239 L
  '43a088fe-af10-4e6d-9872-f7a46b8a278f', -- RAC 407 I
  '027c5287-2cd5-473b-bc89-a4eff3e7912f'  -- RAF 936 C
);

-- Add a car with its inspection document, or as a brand new car (both or neither).
CREATE OR REPLACE FUNCTION create_vehicle_with_inspection(p jsonb, d jsonb)
RETURNS vehicles LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v vehicles;
  v_new boolean := COALESCE((p->>'brand_new')::boolean, false);
  v_doc boolean := d IS NOT NULL AND NULLIF(d->>'file_path', '') IS NOT NULL;
BEGIN
  IF NOT v_new AND NOT v_doc THEN RAISE EXCEPTION 'Attach the Kivu Ride inspection document, or tick "Brand new car"'; END IF;
  IF NULLIF(trim(p->>'plate_number'), '') IS NULL THEN RAISE EXCEPTION 'Enter the plate number'; END IF;
  INSERT INTO vehicles (id, plate_number, make, model, color, device_label, documents, notes, given_date, operation_start_date,
                        rura_license_status, rura_license_issued_date, rura_license_expiry_date, brand_new, created_by)
  VALUES (COALESCE(NULLIF(p->>'id', '')::uuid, gen_random_uuid()), upper(trim(p->>'plate_number')),
          NULLIF(trim(p->>'make'), ''), NULLIF(trim(p->>'model'), ''), NULLIF(trim(p->>'color'), ''), NULLIF(trim(p->>'device_label'), ''),
          COALESCE(p->'documents', '[]'::jsonb), NULLIF(trim(p->>'notes'), ''),
          NULLIF(p->>'given_date', '')::date, NULLIF(p->>'operation_start_date', '')::date,
          COALESCE(NULLIF(p->>'rura_license_status', ''), 'pending'),
          NULLIF(p->>'rura_license_issued_date', '')::date, NULLIF(p->>'rura_license_expiry_date', '')::date, v_new, auth.uid())
  RETURNING * INTO v;
  IF v_doc THEN PERFORM add_vehicle_inspection(v.id, d); END IF;
  RETURN v;
END $$;
