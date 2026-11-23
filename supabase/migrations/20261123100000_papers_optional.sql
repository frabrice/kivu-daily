/*
# Papers are optional when a car is added (MD, 23 Nov 2026)

A car can now be saved without its Kivu Ride inspection document, an owner
onboarded without the management agreement (and, in the app, a driver linked
to a car without the contract on file): what's missing shows under
Admin -> Missing until it's added. A document that is attached is still saved
in the same step.
*/

CREATE OR REPLACE FUNCTION create_vehicle_with_inspection(p jsonb, d jsonb)
RETURNS vehicles LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v vehicles;
  v_new boolean := COALESCE((p->>'brand_new')::boolean, false);
  v_doc boolean := d IS NOT NULL AND NULLIF(d->>'file_path', '') IS NOT NULL;
BEGIN
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
  IF v_doc AND NOT v_new THEN PERFORM add_vehicle_inspection(v.id, d); END IF;
  RETURN v;
END $$;

REVOKE EXECUTE ON FUNCTION create_vehicle_with_inspection(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_vehicle_with_inspection(jsonb, jsonb) TO authenticated;

-- Owner onboarding: the management agreement is saved when attached, optional otherwise.
CREATE OR REPLACE FUNCTION onboard_vehicle_owner_with_agreement(
  p_vehicle_id uuid, p_owner_id uuid, p_operation_start_date date,
  p_weekly_owner_payout numeric DEFAULT NULL, p_monthly_management_fee numeric DEFAULT NULL, p_doc jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM onboard_vehicle_owner(p_vehicle_id, p_owner_id, p_operation_start_date, p_weekly_owner_payout, p_monthly_management_fee);
  IF p_doc IS NOT NULL THEN
    PERFORM add_contract_document('owner_management_agreement', NULL, p_owner_id, NULL, p_operation_start_date, p_doc);
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION onboard_vehicle_owner_with_agreement(uuid, uuid, date, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION onboard_vehicle_owner_with_agreement(uuid, uuid, date, numeric, numeric, jsonb) TO authenticated;
