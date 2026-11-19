/*
# Driver Adjust: confirm a terminated driver (MD, 19 Nov 2026)

"The driver's contract might be terminated, in that case we just confirm
that the driver was terminated and nothing else ever changes at all."

- confirm_driver_terminated(): the MD confirms the contract was terminated
  on a date, and why. The contract ends the usual way (end_driver_contract:
  off the car, contract ended) and the review is recorded with outcome
  'terminated' and the numbers as they stood. Nothing about the money is
  corrected: no start date, deposit, paid-until or fine changes.
- From then on the driver's money is closed for everyone, the MD included:
  no payment, fine, fine payment or Adjust entry can be added, changed or
  removed while the contract stays ended. Renewing the contract opens it
  again.
*/

ALTER TABLE driver_money_reviews ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'confirmed';
ALTER TABLE driver_money_reviews DROP CONSTRAINT IF EXISTS driver_money_reviews_outcome_check;
ALTER TABLE driver_money_reviews ADD CONSTRAINT driver_money_reviews_outcome_check CHECK (outcome IN ('confirmed', 'terminated'));
ALTER TABLE driver_money_reviews ADD COLUMN IF NOT EXISTS terminated_on date;
ALTER TABLE driver_money_reviews ADD COLUMN IF NOT EXISTS termination_reason text;

-- A driver confirmed terminated whose contract is still ended: money closed.
CREATE OR REPLACE FUNCTION driver_money_closed(p_driver uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM drivers d
    WHERE d.id = p_driver AND d.contract_status = 'ended'
      AND (SELECT m.outcome FROM driver_money_reviews m WHERE m.driver_id = d.id ORDER BY m.created_at DESC LIMIT 1) = 'terminated'
  );
$$;
REVOKE ALL ON FUNCTION driver_money_closed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION driver_money_closed(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION driver_money_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_md boolean := is_managing_director();
  r jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_driver uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'driver_fine_payments' THEN
    SELECT driver_id INTO v_driver FROM driver_fines WHERE id = (r->>'fine_id')::uuid;
  ELSE
    v_driver := (r->>'driver_id')::uuid;
  END IF;
  IF driver_money_closed(v_driver) THEN
    RAISE EXCEPTION 'This driver was confirmed terminated: their money records are closed';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_md THEN
      NEW.status := 'confirmed'; NEW.confirmed_by := auth.uid(); NEW.confirmed_at := now();
    ELSE
      NEW.status := 'pending'; NEW.confirmed_by := NULL; NEW.confirmed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF v_md THEN RETURN COALESCE(NEW, OLD); END IF;
  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'The MD has confirmed this entry: only the MD can change or remove it';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by) THEN
    RAISE EXCEPTION 'Only the MD confirms driver money';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Adjust entries: closed too, and still only through the Adjust button.
CREATE OR REPLACE FUNCTION guard_balance_adjustments()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance_adjustments IS DISTINCT FROM OLD.balance_adjustments THEN
    IF coalesce(current_setting('kivu.adjusting', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Adjustments are recorded with the Adjust button only';
    END IF;
    IF NEW.contract_status = 'ended' AND driver_money_closed(NEW.id) THEN
      RAISE EXCEPTION 'This driver was confirmed terminated: their money records are closed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION confirm_driver_terminated(p_driver uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d drivers%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_date date := NULLIF(p->>'event_date', '')::date;
  v_reason text := NULLIF(trim(p->>'reason'), '');
  v_id uuid;
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD confirms a driver''s money'; END IF;
  SELECT * INTO d FROM drivers WHERE id = p_driver FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF d.contract_status = 'ended' THEN RAISE EXCEPTION '%''s contract has already ended', d.full_name; END IF;
  IF v_date IS NULL THEN RAISE EXCEPTION 'Enter the date the contract was terminated'; END IF;
  IF v_date > v_today THEN RAISE EXCEPTION 'The termination date can''t be in the future'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Say why the contract was terminated'; END IF;

  PERFORM end_driver_contract(jsonb_build_object(
    'driver_id', p_driver, 'event_date', v_date, 'reason_key', NULLIF(p->>'reason_key', ''), 'reason', v_reason,
    'details', NULLIF(trim(p->>'notes'), ''),
    'meta', COALESCE(p->'meta', '{}'::jsonb) || jsonb_build_object('confirmed_in', 'driver_adjust')));

  INSERT INTO driver_money_reviews (driver_id, reviewed_on, outcome, terminated_on, termination_reason, start_date, deposit_amount, deposit_date,
    model, rest_day, notes, before, after, created_by)
  VALUES (p_driver, v_today, 'terminated', v_date, v_reason, d.start_date, COALESCE(d.initial_deposit_amount, 0), d.initial_deposit_date,
    d.model, d.rest_day, NULLIF(trim(p->>'notes'), ''), p->'before', p->'before', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT department_id FROM profiles WHERE id = auth.uid()), 'confirmed a driver terminated', 'driver', p_driver, d.full_name,
    jsonb_build_object('review', v_id, 'terminated_on', v_date, 'reason', v_reason));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION confirm_driver_terminated(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_driver_terminated(uuid, jsonb) TO authenticated;
