/*
# Driver models: One shift, Both shifts, Solo car (MD, 12 Nov 2026)

Every driver is on one model, and pays for it the same way: by Sunday, for
the Monday-Sunday week ahead.

| model       | per day | days paid             | a week  | the car              | salary      |
|-------------|---------|-----------------------|---------|----------------------|-------------|
| one_shift   | 30,000  | 6 (one rest day free) | 180,000 | shared, day or night | 150,000/mo  |
| both_shifts | 60,000  | 6 (one rest day free) | 360,000 | alone                | 300,000/mo  |
| solo_car    | 45,000  | 7 (no rest day)       | 315,000 | alone                | none        |

- driver_models: the models and their terms (MD and Finance can change a
  model's terms; drivers already on it keep theirs, see rate_history).
- drivers.model: the driver's model now. Existing drivers: both shifts if
  shift = 'full', otherwise one shift - exactly what they pay today.
- A whole-car model always sits on both seats of the car (shift 'full');
  a model with no rest day has rest_day NULL (every day is a working day).
- drivers.rate_history: each entry now also says the model and the rest day
  from that date, so a driver moved to Solo car keeps their old rest day on
  the days before the move. Every driver gets a first entry now (their
  current terms from their start date), so nobody's balance changes and
  later edits to a model never rewrite anyone's past.
- change_driver_model(): moves a driver to another model (and/or shift or
  rest day) from a date: seat check, history, a 'model_changed' contract
  event with the agreed terms, and the prepayment as a pending deposit.
  change_driver_shift() stays for older screens and now goes through it.
- renew_driver_contract(): the renewed contract can be on any model.
- sync_driver_payroll(): the salary of the driver's model each month;
  Solo car has none.
- owner_paused_shift_days(): whole-car models count as both shifts, and
  each day's own rest day.

Changing a driver's model: Fleet, Finance and the MD (MD, 12 Nov 2026).
*/

-- ================================================================ models
CREATE TABLE IF NOT EXISTS driver_models (
  key text PRIMARY KEY,
  label text NOT NULL,
  daily_rate numeric NOT NULL CHECK (daily_rate > 0),
  has_rest_day boolean NOT NULL,
  whole_car boolean NOT NULL,
  monthly_salary numeric CHECK (monthly_salary IS NULL OR monthly_salary >= 0),
  description text,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO driver_models (key, label, daily_rate, has_rest_day, whole_car, monthly_salary, description, sort) VALUES
  ('one_shift', 'One shift', 30000, true, false, 150000, 'Shares the car: the day or the night shift. One rest day a week.', 1),
  ('both_shifts', 'Both shifts', 60000, true, true, 300000, 'Drives the day and the night shift of the car alone. One rest day a week.', 2),
  ('solo_car', 'Solo car', 45000, false, true, NULL, 'Has the car alone, every day of the week. No rest day and no monthly salary.', 3)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE driver_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_select ON driver_models;
CREATE POLICY dm_select ON driver_models FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS dm_write ON driver_models;
CREATE POLICY dm_write ON driver_models FOR ALL TO authenticated
  USING (is_managing_director() OR current_department_slug() = 'finance')
  WITH CHECK (is_managing_director() OR current_department_slug() = 'finance');
GRANT SELECT, INSERT, UPDATE ON driver_models TO authenticated;

-- ================================================================ drivers.model
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS model text REFERENCES driver_models(key);
UPDATE drivers SET model = CASE WHEN shift = 'full' THEN 'both_shifts' ELSE 'one_shift' END WHERE model IS NULL;
ALTER TABLE drivers ALTER COLUMN model SET DEFAULT 'one_shift';
ALTER TABLE drivers ALTER COLUMN model SET NOT NULL;
CREATE INDEX IF NOT EXISTS drivers_model_idx ON drivers (model);

ALTER TABLE driver_contract_events DROP CONSTRAINT IF EXISTS driver_contract_events_event_type_check;
ALTER TABLE driver_contract_events ADD CONSTRAINT driver_contract_events_event_type_check
  CHECK (event_type IN ('ended', 'reactivated', 'renewed', 'shift_changed', 'model_changed'));

COMMENT ON COLUMN drivers.rate_history IS 'Terms from each date within the current contract: [{"from":"YYYY-MM-DD","daily":45000,"model":"solo_car","rest_day":null}]. The first entry is the contract''s start.';

-- ================================================================ terms on a day
-- The rate_history entry in force on a day (or the first one, for days
-- before it).
CREATE OR REPLACE FUNCTION driver_terms_on(p_driver drivers, p_day date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT e FROM jsonb_array_elements(p_driver.rate_history) e WHERE (e->>'from')::date <= p_day ORDER BY (e->>'from')::date DESC LIMIT 1),
    (SELECT e FROM jsonb_array_elements(p_driver.rate_history) e ORDER BY (e->>'from')::date ASC LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION driver_daily_rate_on(p_driver drivers, p_day date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (driver_terms_on(p_driver, p_day)->>'daily')::numeric,
    (SELECT daily_rate FROM driver_models WHERE key = p_driver.model),
    CASE WHEN p_driver.shift = 'full' THEN 60000 ELSE 30000 END)
$$;

CREATE OR REPLACE FUNCTION driver_model_on(p_driver drivers, p_day date) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(driver_terms_on(p_driver, p_day)->>'model', p_driver.model)
$$;

-- The rest day on a day (NULL: none, every day is a working day).
CREATE OR REPLACE FUNCTION driver_rest_day_on(p_driver drivers, p_day date) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN driver_terms_on(p_driver, p_day) ? 'rest_day' THEN driver_terms_on(p_driver, p_day)->>'rest_day' ELSE p_driver.rest_day::text END
$$;

REVOKE EXECUTE ON FUNCTION driver_terms_on(drivers, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION driver_daily_rate_on(drivers, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION driver_model_on(drivers, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION driver_rest_day_on(drivers, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION driver_terms_on(drivers, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION driver_daily_rate_on(drivers, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION driver_model_on(drivers, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION driver_rest_day_on(drivers, date) TO authenticated, service_role;

-- Each driver's current terms as their first history entry (from their
-- start date): the same rate and rest day they are counted on today.
UPDATE drivers SET rate_history = jsonb_build_array(jsonb_build_object(
    'from', start_date, 'daily', CASE WHEN model = 'both_shifts' THEN 60000 ELSE 30000 END, 'model', model, 'rest_day', rest_day))
  WHERE start_date IS NOT NULL AND jsonb_array_length(rate_history) = 0;
-- Older entries (from change_driver_shift) get the model and rest day they had.
UPDATE drivers SET rate_history = (
    SELECT jsonb_agg(e || jsonb_build_object(
      'model', COALESCE(e->>'model', CASE WHEN (e->>'daily')::numeric >= 60000 THEN 'both_shifts' ELSE 'one_shift' END),
      'rest_day', CASE WHEN e ? 'rest_day' THEN e->'rest_day' ELSE to_jsonb(rest_day) END) ORDER BY (e->>'from')::date)
    FROM jsonb_array_elements(rate_history) e)
  WHERE jsonb_array_length(rate_history) > 0 AND EXISTS (SELECT 1 FROM jsonb_array_elements(rate_history) e WHERE NOT (e ? 'model' AND e ? 'rest_day'));

-- ================================================================ keep model, seat and rest day consistent
CREATE OR REPLACE FUNCTION drivers_model_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE m driver_models%ROWTYPE;
BEGIN
  SELECT * INTO m FROM driver_models WHERE key = NEW.model;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown driver model %', NEW.model; END IF;
  IF m.whole_car AND NEW.vehicle_id IS NOT NULL THEN NEW.shift := 'full'; END IF;
  IF NOT m.whole_car AND NEW.shift = 'full' THEN
    RAISE EXCEPTION '% is the day or the night shift, not the whole car', m.label;
  END IF;
  IF NOT m.has_rest_day THEN NEW.rest_day := NULL; END IF;
  -- A new driver starts with their terms as the first history entry.
  IF TG_OP = 'INSERT' AND NEW.start_date IS NOT NULL AND jsonb_array_length(COALESCE(NEW.rate_history, '[]'::jsonb)) = 0 THEN
    NEW.rate_history := jsonb_build_array(jsonb_build_object('from', NEW.start_date, 'daily', m.daily_rate, 'model', m.key, 'rest_day', NEW.rest_day));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS drivers_model_guard ON drivers;
CREATE TRIGGER drivers_model_guard BEFORE INSERT OR UPDATE OF model, shift, rest_day, vehicle_id ON drivers
  FOR EACH ROW EXECUTE FUNCTION drivers_model_guard();

-- A driver added before their start date: seed the history once it's set.
CREATE OR REPLACE FUNCTION drivers_seed_terms() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE m driver_models%ROWTYPE;
BEGIN
  IF NEW.start_date IS NOT NULL AND jsonb_array_length(COALESCE(NEW.rate_history, '[]'::jsonb)) = 0 THEN
    SELECT * INTO m FROM driver_models WHERE key = NEW.model;
    NEW.rate_history := jsonb_build_array(jsonb_build_object('from', NEW.start_date, 'daily', m.daily_rate, 'model', m.key, 'rest_day', NEW.rest_day));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS drivers_seed_terms ON drivers;
CREATE TRIGGER drivers_seed_terms BEFORE UPDATE OF start_date ON drivers FOR EACH ROW EXECUTE FUNCTION drivers_seed_terms();

-- ================================================================ change a driver's model
CREATE OR REPLACE FUNCTION change_driver_model(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
  v_new driver_models%ROWTYPE;
  v_old driver_models%ROWTYPE;
  v_eff date := (p->>'effective_date')::date;
  v_shift text := NULLIF(p->>'shift', '');
  v_rest text := NULLIF(p->>'rest_day', '');
  v_old_rate numeric;
  v_history jsonb;
  v_event uuid;
  v_pre jsonb := p->'prepayment';
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() IN ('fleet', 'finance')) THEN
    RAISE EXCEPTION 'Only Fleet, Finance or the MD can change a driver''s model';
  END IF;
  SELECT * INTO v_driver FROM drivers WHERE id = (p->>'driver_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_driver.contract_status <> 'active' OR v_driver.vehicle_id IS NULL OR v_driver.start_date IS NULL THEN
    RAISE EXCEPTION 'Only a driver on a car with an active contract can change model';
  END IF;
  SELECT * INTO v_new FROM driver_models WHERE key = p->>'model' AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick the new model'; END IF;
  SELECT * INTO v_old FROM driver_models WHERE key = v_driver.model;
  IF v_eff IS NULL OR v_eff < v_driver.start_date THEN RAISE EXCEPTION 'Pick the date the change starts (not before the contract)'; END IF;

  IF v_new.whole_car THEN
    v_shift := 'full';
  ELSE
    v_shift := COALESCE(v_shift, CASE WHEN v_driver.shift IN ('day', 'night') THEN v_driver.shift END);
    IF v_shift IS NULL AND v_driver.shift = 'full' THEN RAISE EXCEPTION 'Pick the day or the night shift'; END IF;
    IF v_shift IS NOT NULL AND v_shift NOT IN ('day', 'night') THEN RAISE EXCEPTION 'Pick the day or the night shift'; END IF;
  END IF;
  IF v_new.has_rest_day THEN
    v_rest := COALESCE(v_rest, v_driver.rest_day::text);
    IF v_rest IS NULL THEN RAISE EXCEPTION 'Pick the rest day'; END IF;
  ELSE
    v_rest := NULL;
  END IF;
  IF v_new.key = v_driver.model AND v_shift IS NOT DISTINCT FROM v_driver.shift AND v_rest IS NOT DISTINCT FROM v_driver.rest_day::text THEN
    RAISE EXCEPTION 'Nothing changes: pick another model, shift or rest day';
  END IF;

  -- The seat: a whole-car model needs the car to itself; one shift needs that shift free.
  IF v_shift IS NOT NULL AND EXISTS (
    SELECT 1 FROM drivers o WHERE o.vehicle_id = v_driver.vehicle_id AND o.id <> v_driver.id AND o.contract_status = 'active'
      AND o.shift IS NOT NULL AND (v_shift = 'full' OR o.shift = 'full' OR o.shift = v_shift)) THEN
    RAISE EXCEPTION '%', CASE WHEN v_shift = 'full' THEN 'Another driver is on this car: ' || v_new.label || ' needs the car to itself'
                              ELSE 'The ' || v_shift || ' shift on this car is taken' END;
  END IF;

  v_old_rate := driver_daily_rate_on(v_driver, v_eff - 1);
  v_history := CASE WHEN jsonb_array_length(v_driver.rate_history) = 0
    THEN jsonb_build_array(jsonb_build_object('from', v_driver.start_date, 'daily', v_old_rate, 'model', v_driver.model, 'rest_day', v_driver.rest_day))
    ELSE (SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'from')::date), '[]'::jsonb) FROM jsonb_array_elements(v_driver.rate_history) e WHERE (e->>'from')::date < v_eff) END;
  v_history := v_history || jsonb_build_array(jsonb_build_object('from', v_eff, 'daily', v_new.daily_rate, 'model', v_new.key, 'rest_day', v_rest));

  INSERT INTO driver_contract_events (driver_id, event_type, reason, reason_key, details, event_date, meta, created_by)
  VALUES (v_driver.id, 'model_changed',
          CASE WHEN v_new.key = v_driver.model THEN 'Changed shift or rest day' ELSE 'Moved to ' || v_new.label END,
          'model_' || v_new.key, NULLIF(p->>'details', ''), v_eff,
          jsonb_build_object('from_model', v_driver.model, 'to_model', v_new.key, 'from_shift', v_driver.shift, 'to_shift', v_shift,
            'old_daily', v_old_rate, 'new_daily', v_new.daily_rate,
            'weekly', v_new.daily_rate * CASE WHEN v_new.has_rest_day THEN 6 ELSE 7 END, 'salary', v_new.monthly_salary,
            'from_rest_day', v_driver.rest_day, 'rest_day', v_rest,
            'prepayment', v_pre, 'agreed_pay_by', p->>'agreed_pay_by', 'terms', COALESCE(p->'terms', '[]'::jsonb)),
          auth.uid())
  RETURNING id INTO v_event;

  UPDATE drivers SET model = v_new.key, shift = v_shift, rate_history = v_history, rest_day = v_rest::text, updated_at = now()
  WHERE id = v_driver.id;

  IF v_pre IS NOT NULL AND COALESCE((v_pre->>'amount')::numeric, 0) > 0 THEN
    INSERT INTO driver_deposits (driver_id, amount, paid_date, payment_method, bank_name, created_by)
    VALUES (v_driver.id, (v_pre->>'amount')::numeric, (v_pre->>'paid_date')::date, COALESCE(v_pre->>'payment_method', 'momo'),
            NULLIF(v_pre->>'bank_name', ''), auth.uid());
  END IF;
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION change_driver_model_with_amendment(p jsonb, doc jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_start date; v_event uuid;
BEGIN
  v_event := change_driver_model(p);
  SELECT start_date INTO v_start FROM drivers WHERE id = (p->>'driver_id')::uuid;
  PERFORM add_contract_document('driver_contract_amendment', (p->>'driver_id')::uuid, NULL, v_event, v_start, doc);
  RETURN v_event;
END $$;

-- The older shift screen: one shift <-> both shifts, through the same path.
CREATE OR REPLACE FUNCTION change_driver_shift(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  RETURN change_driver_model(p || jsonb_build_object(
    'model', CASE WHEN p->>'new_shift' = 'full' THEN 'both_shifts' ELSE 'one_shift' END,
    'shift', CASE WHEN p->>'new_shift' = 'full' THEN NULL ELSE p->>'new_shift' END));
END $$;

REVOKE EXECUTE ON FUNCTION change_driver_model(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION change_driver_model_with_amendment(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION change_driver_model(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION change_driver_model_with_amendment(jsonb, jsonb) TO authenticated;

-- ================================================================ renewal on any model
CREATE OR REPLACE FUNCTION renew_driver_contract(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
  v_last_end date;
  v_event uuid;
  v_first numeric := NULLIF(p->>'first_payment', '')::numeric;
  v_credit numeric := COALESCE(NULLIF(p->>'opening_credit', '')::numeric, 0);
  v_vehicle uuid := NULLIF(p->>'vehicle_id', '')::uuid;
  v_shift text := NULLIF(p->>'shift', '');
  v_model driver_models%ROWTYPE;
  v_rest text;
  v_start date := (p->>'start_date')::date;
BEGIN
  SELECT * INTO v_driver FROM drivers WHERE id = (p->>'driver_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_driver.contract_status <> 'ended' THEN RAISE EXCEPTION 'Only an ended contract can be renewed'; END IF;
  IF v_start IS NULL THEN RAISE EXCEPTION 'Pick the new start date'; END IF;
  SELECT * INTO v_model FROM driver_models
    WHERE key = COALESCE(NULLIF(p->>'model', ''), CASE WHEN v_shift = 'full' THEN 'both_shifts' ELSE 'one_shift' END) AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick the model'; END IF;
  IF v_model.whole_car THEN v_shift := CASE WHEN v_vehicle IS NULL THEN NULL ELSE 'full' END; END IF;
  IF v_vehicle IS NOT NULL AND v_shift IS NULL THEN RAISE EXCEPTION 'Pick a shift for the car'; END IF;
  v_rest := CASE WHEN v_model.has_rest_day THEN COALESCE(NULLIF(p->>'rest_day', ''), v_driver.rest_day::text) END;
  SELECT max(event_date) INTO v_last_end FROM driver_contract_events WHERE driver_id = v_driver.id AND event_type = 'ended';

  INSERT INTO driver_contract_events (driver_id, event_type, reason, reason_key, details, event_date, meta, created_by)
  VALUES (v_driver.id, 'renewed', p->>'reason', p->>'reason_key', NULLIF(p->>'details', ''), v_start,
          jsonb_build_object(
            'previous_start', v_driver.start_date, 'previous_end', v_last_end,
            'first_payment', v_first, 'first_payment_date', p->>'first_payment_date', 'opening_credit', v_credit,
            'vehicle_id', v_vehicle, 'model', v_model.key, 'shift', v_shift, 'rest_day', v_rest,
            'changes', COALESCE(p->'changes', '[]'::jsonb), 'agreed_next_payment', p->>'agreed_next_payment'),
          auth.uid())
  RETURNING id INTO v_event;

  UPDATE drivers SET
    contract_status = 'active',
    stage = 'ready',
    start_date = v_start,
    payments_from = COALESCE(v_last_end + 1, v_start),
    opening_credit = v_credit,
    model = v_model.key,
    rate_history = jsonb_build_array(jsonb_build_object('from', v_start, 'daily', v_model.daily_rate, 'model', v_model.key, 'rest_day', v_rest)),
    initial_deposit_paid = v_first IS NOT NULL AND v_first > 0,
    initial_deposit_amount = CASE WHEN v_first IS NOT NULL AND v_first > 0 THEN v_first END,
    initial_deposit_date = CASE WHEN v_first IS NOT NULL AND v_first > 0 THEN COALESCE(NULLIF(p->>'first_payment_date', '')::date, v_start) END,
    vehicle_id = v_vehicle,
    shift = CASE WHEN v_vehicle IS NULL THEN NULL ELSE v_shift END,
    rest_day = v_rest,
    updated_at = now()
  WHERE id = v_driver.id;
  RETURN v_event;
END $$;

-- ================================================================ salary by model
CREATE OR REPLACE FUNCTION sync_driver_payroll()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
  v_im_id uuid;
  v_months_elapsed int;
  v_existing_count int;
  v_period_start date;
  v_model text;
  v_amount numeric;
  v_salaried int;
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can sync driver payroll';
  END IF;

  SELECT id INTO v_im_id FROM finance_accounts WHERE key = 'im_bank';
  IF v_im_id IS NULL THEN RETURN; END IF;

  FOR v_driver IN
    SELECT * FROM drivers
    WHERE (initial_deposit_paid = true OR opening_credit > 0) AND start_date IS NOT NULL AND contract_status = 'active'
  LOOP
    v_months_elapsed := GREATEST((EXTRACT(YEAR FROM age(CURRENT_DATE, v_driver.start_date)) * 12
      + EXTRACT(MONTH FROM age(CURRENT_DATE, v_driver.start_date)))::int, 0);
    -- Only this contract's salaries (dated after its start) count.
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'driver_payroll' AND linked_driver_id = v_driver.id AND system_generated = true
        AND transaction_date > v_driver.start_date;
    -- Each month takes the salary of the model at its start; a month on a
    -- model with no salary (Solo car) is skipped, and only salaried months
    -- are matched against the salaries already recorded.
    v_salaried := 0;
    FOR i IN 0..(v_months_elapsed - 1) LOOP
      v_period_start := (v_driver.start_date + (i || ' months')::interval)::date;
      v_model := driver_model_on(v_driver, v_period_start);
      SELECT monthly_salary INTO v_amount FROM driver_models WHERE key = v_model;
      IF v_amount IS NULL OR v_amount <= 0 THEN CONTINUE; END IF;
      v_salaried := v_salaried + 1;
      IF v_salaried <= v_existing_count THEN CONTINUE; END IF;
      INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_driver_id, status, system_generated, created_at)
      VALUES ('driver_payroll', v_im_id, 'out', v_amount, (v_driver.start_date + ((i + 1) || ' months')::interval)::date,
              'Driver payroll — ' || v_driver.full_name || CASE WHEN v_model = 'both_shifts' THEN ' (both shifts)' ELSE '' END,
              v_driver.full_name, v_driver.id, 'pending', true, now());
    END LOOP;
  END LOOP;
END;
$$;

-- ================================================================ owner-paused shift-days
CREATE OR REPLACE FUNCTION owner_paused_shift_days(p_vehicle uuid, p_week date)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(CASE WHEN COALESCE((SELECT whole_car FROM driver_models WHERE key = driver_model_on(dr, g.day::date)), false) THEN 2 ELSE 1 END), 0)::int
  FROM driver_pauses p
  JOIN drivers dr ON dr.id = p.driver_id
  CROSS JOIN LATERAL generate_series(greatest(p.start_date, p_week), least(p_week + 6, COALESCE(p.end_date, (now() AT TIME ZONE 'Africa/Kigali')::date)), interval '1 day') AS g(day)
  WHERE p.vehicle_id = p_vehicle AND p.owner_payout_paused AND p.approval_status <> 'rejected'
    AND (driver_rest_day_on(dr, g.day::date) IS NULL
      OR extract(isodow FROM g.day)::int <> array_position(ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], driver_rest_day_on(dr, g.day::date)));
$$;
