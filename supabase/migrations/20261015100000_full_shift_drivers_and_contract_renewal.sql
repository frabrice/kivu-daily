/*
# Full-shift drivers + contract renewal (MD, 15 Oct 2026)

1. Full shift: one driver can work BOTH the day and the night shift of a
   car ("shift = 'full'"). They pay 60,000 per working day - 360,000 for
   the week, by the start of their week - and take the whole car (no other
   driver on it). The payment maths lives in
   supabase/functions/_shared/depositRules.ts (rate by shift).

2. Seats: a car has a day seat and a night seat; a full-shift driver takes
   both. A trigger refuses any active assignment that would double-book a
   seat, whoever writes it.

3. Contract renewal: a driver whose contract ended can start a NEW
   contract: new start date, a new first payment and/or credit carried from
   days they had already paid for, car/shift/rest day, and what changed.
   drivers.payments_from marks where the current contract's payments start
   (older payments belong to the old contract); drivers.opening_credit is
   the carried-over credit, counted as paid on the new start date.

4. Ending a contract records a reason code (for analytics), who decided,
   whether they can come back, and what they still owed - in one step.
*/

-- ---------------------------------------------------------------- drivers
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_shift_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_shift_check CHECK (shift IS NULL OR shift IN ('day', 'night', 'full'));
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS payments_from date;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0 CHECK (opening_credit >= 0);

COMMENT ON COLUMN drivers.shift IS 'day, night, or full (both shifts of the car: pays 60,000/working day, 360,000/week)';
COMMENT ON COLUMN drivers.payments_from IS 'Current contract: only deposits paid on/after this date count (null = all). Set on renewal.';
COMMENT ON COLUMN drivers.opening_credit IS 'Current contract: credit carried from the previous contract, counted as paid on start_date.';

-- One car, two seats (day, night); a full-shift driver takes both.
CREATE OR REPLACE FUNCTION check_driver_seat() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_clash text;
BEGIN
  IF NEW.contract_status <> 'active' OR NEW.vehicle_id IS NULL OR NEW.shift IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT d.full_name INTO v_clash
  FROM drivers d
  WHERE d.vehicle_id = NEW.vehicle_id AND d.id <> NEW.id AND d.contract_status = 'active' AND d.shift IS NOT NULL
    AND (NEW.shift = 'full' OR d.shift = 'full' OR d.shift = NEW.shift)
  LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'That seat on this car is taken by %. A car has one day and one night driver, or one driver on both shifts.', v_clash
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS drivers_check_seat ON drivers;
CREATE TRIGGER drivers_check_seat BEFORE INSERT OR UPDATE OF vehicle_id, shift, contract_status ON drivers
FOR EACH ROW EXECUTE FUNCTION check_driver_seat();

-- ---------------------------------------------------------------- contract events
ALTER TABLE driver_contract_events DROP CONSTRAINT IF EXISTS driver_contract_events_event_type_check;
ALTER TABLE driver_contract_events ADD CONSTRAINT driver_contract_events_event_type_check CHECK (event_type IN ('ended', 'reactivated', 'renewed'));
ALTER TABLE driver_contract_events ADD COLUMN IF NOT EXISTS reason_key text;
ALTER TABLE driver_contract_events ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- End a contract in one step (runs as the caller: table permissions apply).
-- p: driver_id, event_date, reason_key, reason, details, meta {decided_by, can_return, owed, fines_unpaid, paid_through}
CREATE OR REPLACE FUNCTION end_driver_contract(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
BEGIN
  SELECT * INTO v_driver FROM drivers WHERE id = (p->>'driver_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_driver.contract_status = 'ended' THEN RAISE EXCEPTION 'This contract has already ended'; END IF;
  INSERT INTO driver_contract_events (driver_id, event_type, reason, reason_key, details, event_date, meta, created_by)
  VALUES (v_driver.id, 'ended', p->>'reason', p->>'reason_key', NULLIF(p->>'details', ''), (p->>'event_date')::date,
          COALESCE(p->'meta', '{}'::jsonb) || jsonb_build_object('vehicle_id', v_driver.vehicle_id, 'shift', v_driver.shift, 'start_date', v_driver.start_date),
          auth.uid());
  UPDATE drivers SET contract_status = 'ended', stage = 'inactive', vehicle_id = NULL, shift = NULL, updated_at = now() WHERE id = v_driver.id;
END $$;

-- Renew an ended contract in one step.
-- p: driver_id, start_date, reason_key, reason, details, vehicle_id, shift, rest_day,
--    first_payment (number|null), first_payment_date, opening_credit (number), changes (text[]), agreed_next_payment (date|null)
CREATE OR REPLACE FUNCTION renew_driver_contract(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
  v_last_end date;
  v_first numeric := NULLIF(p->>'first_payment', '')::numeric;
  v_credit numeric := COALESCE(NULLIF(p->>'opening_credit', '')::numeric, 0);
  v_vehicle uuid := NULLIF(p->>'vehicle_id', '')::uuid;
  v_shift text := NULLIF(p->>'shift', '');
BEGIN
  SELECT * INTO v_driver FROM drivers WHERE id = (p->>'driver_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_driver.contract_status <> 'ended' THEN RAISE EXCEPTION 'Only an ended contract can be renewed'; END IF;
  IF (p->>'start_date') IS NULL THEN RAISE EXCEPTION 'Pick the new start date'; END IF;
  IF v_vehicle IS NOT NULL AND v_shift IS NULL THEN RAISE EXCEPTION 'Pick a shift for the car'; END IF;
  SELECT max(event_date) INTO v_last_end FROM driver_contract_events WHERE driver_id = v_driver.id AND event_type = 'ended';

  INSERT INTO driver_contract_events (driver_id, event_type, reason, reason_key, details, event_date, meta, created_by)
  VALUES (v_driver.id, 'renewed', p->>'reason', p->>'reason_key', NULLIF(p->>'details', ''), (p->>'start_date')::date,
          jsonb_build_object(
            'previous_start', v_driver.start_date, 'previous_end', v_last_end,
            'first_payment', v_first, 'first_payment_date', p->>'first_payment_date', 'opening_credit', v_credit,
            'vehicle_id', v_vehicle, 'shift', v_shift, 'rest_day', p->>'rest_day',
            'changes', COALESCE(p->'changes', '[]'::jsonb), 'agreed_next_payment', p->>'agreed_next_payment'),
          auth.uid());

  UPDATE drivers SET
    contract_status = 'active',
    stage = 'ready',
    start_date = (p->>'start_date')::date,
    -- Payments made after the old contract ended belong to the new one.
    payments_from = COALESCE(v_last_end + 1, (p->>'start_date')::date),
    opening_credit = v_credit,
    initial_deposit_paid = v_first IS NOT NULL AND v_first > 0,
    initial_deposit_amount = CASE WHEN v_first IS NOT NULL AND v_first > 0 THEN v_first END,
    initial_deposit_date = CASE WHEN v_first IS NOT NULL AND v_first > 0 THEN COALESCE(NULLIF(p->>'first_payment_date', '')::date, (p->>'start_date')::date) END,
    vehicle_id = v_vehicle,
    shift = CASE WHEN v_vehicle IS NULL THEN NULL ELSE v_shift END,
    rest_day = COALESCE(NULLIF(p->>'rest_day', ''), v_driver.rest_day),
    updated_at = now()
  WHERE id = v_driver.id;
END $$;

REVOKE EXECUTE ON FUNCTION end_driver_contract(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION renew_driver_contract(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION end_driver_contract(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION renew_driver_contract(jsonb) TO authenticated;

-- ---------------------------------------------------------------- stage rule
-- A renewed driver with only carried-over credit (no new first payment) is
-- still active on the road. Same rule as effectiveStage() in src/lib/fleet.ts.
CREATE OR REPLACE FUNCTION call_center_drivers()
RETURNS TABLE (id uuid, full_name text, phone text, stage text, contract_status text, plate_number text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (current_department_slug() IN ('call_center', 'fleet', 'it', 'finance') OR is_managing_director()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN QUERY
  SELECT d.id, d.full_name, d.phone,
    CASE WHEN d.contract_status = 'active' AND d.vehicle_id IS NOT NULL AND (d.initial_deposit_paid OR d.opening_credit > 0) THEN 'active'
         WHEN d.stage = 'active' THEN 'ready'
         ELSE d.stage END::text,
    d.contract_status::text, v.plate_number, d.created_at
  FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id
  ORDER BY d.full_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION call_center_drivers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION call_center_drivers() TO authenticated, service_role;
