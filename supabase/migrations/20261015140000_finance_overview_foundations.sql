/*
# Finance overview foundations (MD, 15 Oct 2026)

The Finance overview judges every car against its 360,000/week: what it
should have brought in, what it did, what went to the owner and why the
rest was lost. That needs four things the books didn't have:

1. driver_car_assignments - which car each driver was on, day by day.
   drivers.vehicle_id only says where a driver is now (ended drivers lose
   it), so a car's past collections couldn't be traced. Backfilled from
   the activity log ("assigned X to vehicle P" / "unassigned X") and,
   where the first car was set when the driver was created (never logged),
   from the driver's fines on that car. Drivers whose first car can't be
   proven get a row with no car (source 'unknown') for Finance to set -
   nothing is guessed. A trigger keeps it current from now on.

2. driver_pauses.owner_payout_paused - when a driver is paused, are the
   car owner's payments paused too? Paused days are a loss, unless the
   owner isn't paid for them either. The weekly owner payout still unpaid
   (pending) is reduced by 20,000 per paused shift-day (40,000/day for a
   car = 240,000/6), at the car's own rate.

3. Monthly management fee fix: month 0 is created at onboarding, and the
   sync only added month N once N+1 months had passed - each month's fee
   appeared a month late (no October fees yet). It is now due on the same
   date every month, from that date.

4. app_commission - the commissions collected through the app, entered by
   Finance every Friday for the Monday-Sunday week before. One entry per
   week; 0 is allowed so a week with none can be closed.
*/

-- ============================================================ 1. car history
CREATE TABLE IF NOT EXISTS driver_car_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  from_date date NOT NULL,
  to_date date,
  source text NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'log', 'fine', 'current', 'unknown', 'manual')),
  note text,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date IS NULL OR to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS driver_car_assignments_driver ON driver_car_assignments (driver_id, from_date);
CREATE INDEX IF NOT EXISTS driver_car_assignments_vehicle ON driver_car_assignments (vehicle_id, from_date);

ALTER TABLE driver_car_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_car_assignments_select ON driver_car_assignments;
CREATE POLICY driver_car_assignments_select ON driver_car_assignments FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance'));
-- No direct writes: the trigger below and set_assignment_car() only.

-- Backfill (only when the table is still empty, so re-running is harmless).
DO $$
DECLARE
  d record; e record;
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_end date; v_day date; v_car uuid; v_from date; v_first boolean; v_guess uuid; v_any boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM driver_car_assignments) THEN RETURN; END IF;
  FOR d IN SELECT * FROM drivers WHERE start_date IS NOT NULL LOOP
    v_end := CASE WHEN d.contract_status = 'ended' THEN (SELECT max(event_date) FROM driver_contract_events x WHERE x.driver_id = d.id AND x.event_type = 'ended') END;
    v_car := NULL; v_from := NULL; v_first := true; v_any := false;
    FOR e IN
      SELECT (a.created_at AT TIME ZONE 'Africa/Kigali')::date AS day, a.action
      FROM activity_log a
      WHERE a.entity_type = 'driver' AND a.entity_id = d.id AND (a.action LIKE 'assigned % to vehicle %' OR a.action LIKE 'unassigned % from their vehicle')
      ORDER BY a.created_at
    LOOP
      v_any := true;
      v_day := e.day;
      IF e.action LIKE 'unassigned %' THEN
        IF v_first THEN
          -- On a car since they were created (never logged): prove it from their fines.
          SELECT f.vehicle_id INTO v_guess FROM driver_fines f
          WHERE f.driver_id = d.id AND f.vehicle_id IS NOT NULL AND f.fine_date <= v_day ORDER BY f.fine_date DESC LIMIT 1;
          IF d.start_date <= (CASE WHEN v_end IS NOT NULL AND v_end <= v_day THEN v_end ELSE v_day - 1 END) THEN
            INSERT INTO driver_car_assignments (driver_id, vehicle_id, from_date, to_date, source, note)
            VALUES (d.id, v_guess, d.start_date, CASE WHEN v_end IS NOT NULL AND v_end <= v_day THEN v_end ELSE v_day - 1 END,
                    CASE WHEN v_guess IS NULL THEN 'unknown' ELSE 'fine' END,
                    CASE WHEN v_guess IS NULL THEN 'Car not recorded when the driver was added' ELSE 'Car taken from the driver''s fines' END);
          END IF;
        ELSIF v_car IS NOT NULL THEN
          IF v_from <= (CASE WHEN v_end IS NOT NULL AND v_end <= v_day THEN v_end ELSE v_day - 1 END) THEN
            INSERT INTO driver_car_assignments (driver_id, vehicle_id, from_date, to_date, source)
            VALUES (d.id, v_car, v_from, CASE WHEN v_end IS NOT NULL AND v_end <= v_day THEN v_end ELSE v_day - 1 END, 'log');
          END IF;
        END IF;
        v_car := NULL;
      ELSE
        IF v_car IS NOT NULL AND v_from <= v_day - 1 THEN
          INSERT INTO driver_car_assignments (driver_id, vehicle_id, from_date, to_date, source) VALUES (d.id, v_car, v_from, v_day - 1, 'log');
        END IF;
        SELECT id INTO v_car FROM vehicles WHERE plate_number = substring(e.action FROM 'to vehicle (.*)$');
        v_from := v_day;
      END IF;
      v_first := false;
    END LOOP;
    IF v_car IS NOT NULL THEN
      INSERT INTO driver_car_assignments (driver_id, vehicle_id, from_date, to_date, source)
      VALUES (d.id, v_car, v_from, CASE WHEN d.vehicle_id IS NOT DISTINCT FROM v_car THEN NULL ELSE greatest(v_from, coalesce(v_end, v_today)) END, 'log');
    ELSIF NOT v_any AND d.vehicle_id IS NOT NULL THEN
      INSERT INTO driver_car_assignments (driver_id, vehicle_id, from_date, to_date, source) VALUES (d.id, d.vehicle_id, d.start_date, NULL, 'current');
    END IF;
  END LOOP;
END $$;

-- From now on: every car change closes the open row and opens a new one.
CREATE OR REPLACE FUNCTION track_driver_car()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_from date;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    UPDATE driver_car_assignments SET to_date = CASE WHEN NEW.vehicle_id IS NULL THEN v_today ELSE v_today - 1 END, updated_at = now()
    WHERE driver_id = NEW.id AND to_date IS NULL;
    -- Put on a car and moved again the same day: the first row never happened.
    DELETE FROM driver_car_assignments WHERE driver_id = NEW.id AND to_date < from_date;
  END IF;
  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT max(to_date) + 1 INTO v_from FROM driver_car_assignments WHERE driver_id = NEW.id;
    v_from := greatest(coalesce(v_from, '-infinity'::date), least(coalesce(NEW.start_date, v_today), v_today));
    INSERT INTO driver_car_assignments (driver_id, vehicle_id, from_date, source) VALUES (NEW.id, NEW.vehicle_id, v_from, 'live');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS drivers_track_car ON drivers;
CREATE TRIGGER drivers_track_car AFTER INSERT OR UPDATE OF vehicle_id ON drivers FOR EACH ROW EXECUTE FUNCTION track_driver_car();

-- Finance, Fleet or the MD set the car on a row the history couldn't prove.
CREATE OR REPLACE FUNCTION set_assignment_car(p_id uuid, p_vehicle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() IN ('finance', 'fleet')) THEN
    RAISE EXCEPTION 'Only Finance, Fleet or the MD can correct a driver''s car history';
  END IF;
  IF p_vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle_id) THEN RAISE EXCEPTION 'Car not found'; END IF;
  UPDATE driver_car_assignments SET vehicle_id = p_vehicle_id, source = 'manual', updated_by = auth.uid(), updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Row not found'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION set_assignment_car(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_assignment_car(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION track_driver_car() FROM PUBLIC, anon;

-- ============================================================ 2. pauses and the owner's payment
ALTER TABLE driver_pauses ADD COLUMN IF NOT EXISTS owner_payout_paused boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION record_driver_pause(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_driver drivers%ROWTYPE;
  v_reason text := p->>'reason';
  v_note text := NULLIF(trim(p->>'note'), '');
  v_start date := NULLIF(p->>'start_date', '')::date;
  v_end date := NULLIF(p->>'end_date', '')::date;
  v_whole_car boolean := COALESCE((p->>'whole_car')::boolean, false);
  v_owner_paused boolean := COALESCE((p->>'owner_payout_paused')::boolean, false);
  v_group uuid := gen_random_uuid();
  v_target record;
  v_clash text;
BEGIN
  IF NOT can_record_driver_pause() THEN RAISE EXCEPTION 'Only the driver-payments follow-up, the Fleet Manager or the MD can pause a driver'; END IF;
  SELECT * INTO v_driver FROM drivers WHERE id = NULLIF(p->>'driver_id', '')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_reason IS NULL OR v_reason NOT IN ('sick', 'garage', 'accident', 'family', 'leave', 'other') THEN RAISE EXCEPTION 'Choose a reason'; END IF;
  IF v_reason = 'other' AND v_note IS NULL THEN RAISE EXCEPTION 'Explain the reason in the note'; END IF;
  IF v_start IS NULL THEN RAISE EXCEPTION 'Choose the first day off'; END IF;
  IF v_start < v_today - 14 THEN RAISE EXCEPTION 'A pause can be backdated by 14 days at most'; END IF;
  IF v_end IS NOT NULL AND v_end < v_start THEN RAISE EXCEPTION 'The last day off can''t be before the first'; END IF;
  IF v_whole_car AND v_driver.vehicle_id IS NULL THEN RAISE EXCEPTION 'This driver has no car to pause'; END IF;
  IF v_owner_paused AND v_driver.vehicle_id IS NULL THEN RAISE EXCEPTION 'This driver has no car, so there is no owner payment to pause'; END IF;

  FOR v_target IN
    SELECT d.id, d.full_name, d.vehicle_id FROM drivers d
    WHERE (v_whole_car AND d.vehicle_id = v_driver.vehicle_id AND d.contract_status = 'active') OR d.id = v_driver.id
  LOOP
    SELECT to_char(x.start_date, 'DD Mon') || COALESCE('–' || to_char(x.end_date, 'DD Mon'), ' onward') INTO v_clash
    FROM driver_pauses x
    WHERE x.driver_id = v_target.id AND x.approval_status <> 'rejected'
      AND x.start_date <= COALESCE(v_end, 'infinity'::date) AND COALESCE(x.end_date, 'infinity'::date) >= v_start
    LIMIT 1;
    IF v_clash IS NOT NULL THEN RAISE EXCEPTION '% already has a pause for %', v_target.full_name, v_clash; END IF;

    INSERT INTO driver_pauses (driver_id, vehicle_id, group_id, reason, note, start_date, end_date, proof_path, recorded_by, owner_payout_paused)
    VALUES (v_target.id, v_target.vehicle_id, v_group, v_reason, v_note, v_start, v_end, NULLIF(p->>'proof_path', ''), auth.uid(), v_owner_paused);
  END LOOP;

  INSERT INTO notification_events (rule_key, payload) VALUES ('driver_pause_recorded', jsonb_build_object('group_id', v_group, 'actor_id', auth.uid()));
  RETURN v_group;
END;
$$;
REVOKE EXECUTE ON FUNCTION record_driver_pause(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_driver_pause(jsonb) TO authenticated;

-- Finance or the MD decide (or correct) whether the owner is paid for a pause.
CREATE OR REPLACE FUNCTION set_pause_owner_payout(p_group_id uuid, p_paused boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can decide on the owner''s payment';
  END IF;
  UPDATE driver_pauses SET owner_payout_paused = p_paused, updated_at = now() WHERE group_id = p_group_id AND vehicle_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pause not found (or the driver had no car)'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION set_pause_owner_payout(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_pause_owner_payout(uuid, boolean) TO authenticated;

-- Owner-paused shift-days on a car in the week starting p_week (rest days
-- don't count; a driver on both shifts is two shifts).
CREATE OR REPLACE FUNCTION owner_paused_shift_days(p_vehicle uuid, p_week date)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(CASE WHEN driver_daily_rate_on(dr, g.day::date) >= 60000 THEN 2 ELSE 1 END), 0)::int
  FROM driver_pauses p
  JOIN drivers dr ON dr.id = p.driver_id
  CROSS JOIN LATERAL generate_series(greatest(p.start_date, p_week), least(p_week + 6, COALESCE(p.end_date, (now() AT TIME ZONE 'Africa/Kigali')::date)), interval '1 day') AS g(day)
  WHERE p.vehicle_id = p_vehicle AND p.owner_payout_paused AND p.approval_status <> 'rejected'
    AND (dr.rest_day IS NULL OR extract(isodow FROM g.day)::int <> array_position(ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], dr.rest_day::text));
$$;
REVOKE EXECUTE ON FUNCTION owner_paused_shift_days(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION owner_paused_shift_days(uuid, date) TO authenticated, service_role;

-- ============================================================ 3. obligations sync
CREATE OR REPLACE FUNCTION sync_vehicle_obligations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vehicle record;
  v_equity_id uuid;
  v_im_id uuid;
  v_owner_name text;
  v_periods_due int;
  v_months_due int;
  v_existing_count int;
  v_margin_amount numeric;
  v_payout_amount numeric;
  v_fee_amount numeric;
  v_row record;
  v_shifts int;
  v_cut numeric;
  i int;
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can sync vehicle obligations';
  END IF;

  SELECT id INTO v_equity_id FROM finance_accounts WHERE key = 'equity';
  SELECT id INTO v_im_id FROM finance_accounts WHERE key = 'im_bank';
  IF v_equity_id IS NULL OR v_im_id IS NULL THEN RETURN; END IF;

  FOR v_vehicle IN SELECT * FROM vehicles WHERE owner_id IS NOT NULL AND operation_start_date IS NOT NULL LOOP
    SELECT full_name INTO v_owner_name FROM vehicle_owners WHERE id = v_vehicle.owner_id;
    v_payout_amount := COALESCE(v_vehicle.weekly_owner_payout_amount, 240000);
    v_margin_amount := 360000 - v_payout_amount;
    v_fee_amount := COALESCE(v_vehicle.monthly_management_fee_amount, 30000);

    -- Prepayment: the period starting today is already due today.
    IF CURRENT_DATE >= v_vehicle.operation_start_date THEN
      v_periods_due := floor((CURRENT_DATE - v_vehicle.operation_start_date) / 7)::int + 1;
    ELSE
      v_periods_due := 0;
    END IF;

    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'management_margin' AND linked_vehicle_id = v_vehicle.id AND system_generated = true;
    IF v_periods_due > v_existing_count AND v_margin_amount > 0 THEN
      FOR i IN v_existing_count..(v_periods_due - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
        VALUES ('management_margin', v_equity_id, 'in', v_margin_amount, v_vehicle.operation_start_date + (i * 7),
                'Weekly management margin — ' || v_vehicle.plate_number, v_owner_name, v_vehicle.id, 'posted', true, now());
      END LOOP;
    END IF;

    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'vehicle_owner_payment' AND linked_vehicle_id = v_vehicle.id AND system_generated = true;
    IF v_periods_due > v_existing_count THEN
      FOR i IN v_existing_count..(v_periods_due - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
        VALUES ('vehicle_owner_payment', v_im_id, 'out', v_payout_amount, v_vehicle.operation_start_date + (i * 7),
                'Weekly owner payout — ' || v_vehicle.plate_number, v_owner_name, v_vehicle.id, 'pending', true, now());
      END LOOP;
    END IF;

    -- Owner payments paused with a driver's pause: the week still unpaid
    -- is reduced by 20,000 per paused shift-day (at this car's rate).
    FOR v_row IN
      SELECT id, transaction_date, status, description FROM finance_transactions
      WHERE type = 'vehicle_owner_payment' AND linked_vehicle_id = v_vehicle.id AND system_generated = true
        AND (status = 'pending' OR (status = 'rejected' AND description LIKE '%whole week paused%'))
    LOOP
      v_shifts := least(owner_paused_shift_days(v_vehicle.id, v_row.transaction_date), 12);
      CONTINUE WHEN v_shifts = 0 AND v_row.description NOT LIKE '%paused%';
      v_cut := round(v_payout_amount / 12 * v_shifts);
      IF v_cut >= v_payout_amount THEN
        UPDATE finance_transactions SET status = 'rejected', amount = v_payout_amount, updated_at = now(),
          description = 'Weekly owner payout — ' || v_vehicle.plate_number || ' (whole week paused — owner not paid)'
        WHERE id = v_row.id;
      ELSE
        UPDATE finance_transactions SET status = 'pending', amount = v_payout_amount - v_cut, updated_at = now(),
          description = 'Weekly owner payout — ' || v_vehicle.plate_number || CASE WHEN v_shifts > 0 THEN ' (' || v_shifts || ' paused shift-day' || CASE WHEN v_shifts = 1 THEN '' ELSE 's' END || ' not paid)' ELSE '' END
        WHERE id = v_row.id;
      END IF;
    END LOOP;

    -- Monthly management fee: due on the same date every month, from that
    -- date (month 0 is created by onboard_vehicle_owner()).
    IF CURRENT_DATE >= v_vehicle.operation_start_date THEN
      v_months_due := (EXTRACT(YEAR FROM age(CURRENT_DATE, v_vehicle.operation_start_date)) * 12
        + EXTRACT(MONTH FROM age(CURRENT_DATE, v_vehicle.operation_start_date)))::int + 1;
    ELSE
      v_months_due := 0;
    END IF;
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'revenue' AND linked_vehicle_id = v_vehicle.id AND system_generated = true
        AND description LIKE 'Monthly management fee%';
    IF v_months_due > v_existing_count AND v_fee_amount > 0 THEN
      FOR i IN v_existing_count..(v_months_due - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
        VALUES ('revenue', v_equity_id, 'in', v_fee_amount, (v_vehicle.operation_start_date + (i || ' months')::interval)::date,
                'Monthly management fee — ' || v_vehicle.plate_number, v_owner_name, v_vehicle.id, 'pending', true, now());
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION sync_vehicle_obligations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sync_vehicle_obligations() TO authenticated;

-- ============================================================ 4. app commissions
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type = ANY (ARRAY[
  'revenue', 'fleet_collection', 'vehicle_owner_payment', 'payroll', 'supplier_payment', 'transfer', 'expense_claim', 'other',
  'onboarding_fee', 'management_margin', 'driver_payroll', 'app_commission']));
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_amount_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_amount_check CHECK (amount > 0 OR (type = 'app_commission' AND amount = 0));
-- One entry per week (dated on its Monday).
CREATE UNIQUE INDEX IF NOT EXISTS finance_app_commission_week ON finance_transactions (transaction_date)
  WHERE type = 'app_commission' AND status <> 'rejected';
