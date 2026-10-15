/*
# Contract documents travel with the action (MD, 15 Oct 2026)

Every contract moment needs its paper, saved in the same step:
- a driver put on a car / a renewed contract  -> signed + stamped contract
- a contract ended                            -> termination letter
- a driver moved between one and both shifts  -> signed + stamped amendment
- an owner's car taken under management       -> signed + stamped agreement

The file is uploaded to the private 'legal-docs' bucket first; these
wrappers then run the action and record the document in ONE transaction,
so an action can't be saved without its document (or the reverse).
All SECURITY INVOKER: the caller's own rights (RLS) apply.
*/

CREATE OR REPLACE FUNCTION add_contract_document(p_kind text, p_driver uuid, p_owner uuid, p_event uuid, p_period date, d jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_signed boolean := COALESCE((d->>'signed')::boolean, false);
  v_stamped boolean := COALESCE((d->>'stamped')::boolean, false);
BEGIN
  IF d IS NULL OR NULLIF(d->>'file_path', '') IS NULL THEN RAISE EXCEPTION 'Attach the document file'; END IF;
  IF p_kind <> 'driver_termination_letter' AND NOT (v_signed AND v_stamped) THEN
    RAISE EXCEPTION 'The document must be signed and stamped before it can be saved';
  END IF;
  INSERT INTO contract_documents (kind, driver_id, owner_id, contract_event_id, period_start, document_date, signed, stamped, delivered_how, file_path, file_name, notes)
  VALUES (p_kind, p_driver, p_owner, p_event, p_period, COALESCE(NULLIF(d->>'document_date', '')::date, (now() AT TIME ZONE 'Africa/Kigali')::date),
          v_signed, v_stamped, NULLIF(d->>'delivered_how', ''), d->>'file_path', COALESCE(NULLIF(d->>'file_name', ''), 'document'), NULLIF(trim(d->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- A contract document for a driver's current contract (new driver on a car, or a missing one added later).
CREATE OR REPLACE FUNCTION add_driver_document(p_driver uuid, p_kind text, d jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_start date; v_event uuid;
BEGIN
  IF p_kind NOT IN ('driver_contract', 'driver_contract_amendment', 'driver_termination_letter') THEN RAISE EXCEPTION 'Unknown document type'; END IF;
  SELECT start_date INTO v_start FROM drivers WHERE id = p_driver;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF p_kind = 'driver_termination_letter' THEN
    SELECT id INTO v_event FROM driver_contract_events WHERE driver_id = p_driver AND event_type = 'ended' ORDER BY event_date DESC, created_at DESC LIMIT 1;
  END IF;
  RETURN add_contract_document(p_kind, p_driver, NULL, v_event, v_start, d);
END $$;

CREATE OR REPLACE FUNCTION add_owner_agreement(p_owner uuid, d jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_start date;
BEGIN
  SELECT min(operation_start_date) INTO v_start FROM vehicles WHERE owner_id = p_owner;
  RETURN add_contract_document('owner_management_agreement', NULL, p_owner, NULL, v_start, d);
END $$;

CREATE OR REPLACE FUNCTION end_driver_contract_with_letter(p jsonb, doc jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_start date; v_event uuid;
BEGIN
  SELECT start_date INTO v_start FROM drivers WHERE id = (p->>'driver_id')::uuid;
  v_event := end_driver_contract(p);
  PERFORM add_contract_document('driver_termination_letter', (p->>'driver_id')::uuid, NULL, v_event, v_start, doc);
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION renew_driver_contract_with_contract(p jsonb, doc jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_start date; v_event uuid;
BEGIN
  v_event := renew_driver_contract(p);
  SELECT start_date INTO v_start FROM drivers WHERE id = (p->>'driver_id')::uuid;
  PERFORM add_contract_document('driver_contract', (p->>'driver_id')::uuid, NULL, v_event, v_start, doc);
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION change_driver_shift_with_amendment(p jsonb, doc jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_start date; v_event uuid;
BEGIN
  v_event := change_driver_shift(p);
  SELECT start_date INTO v_start FROM drivers WHERE id = (p->>'driver_id')::uuid;
  PERFORM add_contract_document('driver_contract_amendment', (p->>'driver_id')::uuid, NULL, v_event, v_start, doc);
  RETURN v_event;
END $$;

-- Owner onboarding: the agreement is required unless the owner already has one.
CREATE OR REPLACE FUNCTION onboard_vehicle_owner_with_agreement(
  p_vehicle_id uuid, p_owner_id uuid, p_operation_start_date date,
  p_weekly_owner_payout numeric DEFAULT NULL, p_monthly_management_fee numeric DEFAULT NULL, p_doc jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM onboard_vehicle_owner(p_vehicle_id, p_owner_id, p_operation_start_date, p_weekly_owner_payout, p_monthly_management_fee);
  IF p_doc IS NOT NULL THEN
    PERFORM add_contract_document('owner_management_agreement', NULL, p_owner_id, NULL, p_operation_start_date, p_doc);
  ELSIF NOT EXISTS (SELECT 1 FROM contract_documents WHERE owner_id = p_owner_id AND kind = 'owner_management_agreement') THEN
    RAISE EXCEPTION 'Attach the signed and stamped management agreement';
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'add_contract_document(text, uuid, uuid, uuid, date, jsonb)', 'add_driver_document(uuid, text, jsonb)', 'add_owner_agreement(uuid, jsonb)',
    'end_driver_contract_with_letter(jsonb, jsonb)', 'renew_driver_contract_with_contract(jsonb, jsonb)', 'change_driver_shift_with_amendment(jsonb, jsonb)',
    'onboard_vehicle_owner_with_agreement(uuid, uuid, date, numeric, numeric, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
