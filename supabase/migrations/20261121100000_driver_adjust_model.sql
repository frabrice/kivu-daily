/*
# Driver Adjust: confirm or correct the driver's model (MD, 21 Nov 2026)

The review now also confirms the model the driver works on (One shift,
Both shifts, Solo car), the day rate, the shift and the rest day. When what
is on file is wrong, it is corrected from the contract's start - the driver
was always on these terms - so the payments are counted at the right rate
for every day (drivers.rate_history becomes one entry from the start date).
A real change of model part-way through a contract still goes through
"Change model", from the day it happened.
*/

ALTER TABLE driver_money_reviews ADD COLUMN IF NOT EXISTS shift text;
ALTER TABLE driver_money_reviews ADD COLUMN IF NOT EXISTS terms_corrected boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION confirm_driver_review(p_driver uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d drivers%ROWTYPE;
  m driver_models%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_start date := NULLIF(p->>'start_date', '')::date;
  v_dep numeric := COALESCE(NULLIF(p->>'deposit_amount', '')::numeric, 0);
  v_dep_date date := NULLIF(p->>'deposit_date', '')::date;
  v_adj numeric := COALESCE(NULLIF(p->>'adjustment', '')::numeric, 0);
  v_until date := NULLIF(p->>'paid_until', '')::date;
  v_owe numeric := COALESCE(NULLIF(p->>'we_owe_amount', '')::numeric, 0);
  v_terms jsonb := p->'terms';
  v_model text; v_shift text; v_rest text; v_daily numeric;
  v_fixed boolean := false;
  v_name text;
  v_id uuid;
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD confirms a driver''s money'; END IF;
  SELECT * INTO d FROM drivers WHERE id = p_driver FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF d.contract_status = 'ended' THEN RAISE EXCEPTION '% has no contract running', d.full_name; END IF;
  IF v_start IS NULL THEN RAISE EXCEPTION 'Enter the start date'; END IF;
  IF v_start > v_today THEN RAISE EXCEPTION 'The start date can''t be in the future'; END IF;
  IF v_dep < 0 OR v_owe < 0 THEN RAISE EXCEPTION 'Amounts can''t be negative'; END IF;
  IF v_dep > 0 AND v_dep_date IS NULL THEN RAISE EXCEPTION 'Enter the date the deposit was paid'; END IF;
  IF v_dep_date > v_today THEN RAISE EXCEPTION 'The deposit date can''t be in the future'; END IF;
  IF abs(v_adj) > 10000000 THEN RAISE EXCEPTION 'That correction is too large'; END IF;
  SELECT trim(full_name) INTO v_name FROM profiles WHERE id = auth.uid();

  -- The terms as confirmed (or as on file when none are sent).
  v_model := COALESCE(NULLIF(v_terms->>'model', ''), d.model);
  SELECT * INTO m FROM driver_models WHERE key = v_model;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick the driver''s model'; END IF;
  v_daily := COALESCE(NULLIF(v_terms->>'daily', '')::numeric, NULLIF(p->>'daily_rate', '')::numeric);
  v_shift := CASE WHEN v_terms IS NULL THEN d.shift WHEN m.whole_car THEN CASE WHEN d.vehicle_id IS NULL THEN NULL ELSE 'full' END ELSE NULLIF(v_terms->>'shift', '') END;
  v_rest := CASE WHEN v_terms IS NULL THEN d.rest_day WHEN m.has_rest_day THEN NULLIF(v_terms->>'rest_day', '') ELSE NULL END;
  IF v_terms IS NOT NULL THEN
    IF v_daily IS NULL OR v_daily <= 0 OR v_daily > 500000 THEN RAISE EXCEPTION 'Enter the day rate'; END IF;
    IF m.has_rest_day AND v_rest IS NULL THEN RAISE EXCEPTION 'Pick the rest day'; END IF;
    IF NOT m.whole_car AND d.vehicle_id IS NOT NULL AND v_shift NOT IN ('day', 'night') THEN RAISE EXCEPTION 'Pick the day or the night shift'; END IF;
  END IF;

  -- Start date and start deposit, only when they were wrong.
  IF d.start_date IS DISTINCT FROM v_start THEN
    UPDATE drivers SET start_date = v_start, updated_at = now() WHERE id = p_driver;
  END IF;
  IF COALESCE(d.initial_deposit_amount, 0) <> v_dep OR (v_dep > 0 AND d.initial_deposit_date IS DISTINCT FROM v_dep_date) THEN
    UPDATE drivers SET initial_deposit_paid = v_dep > 0,
      initial_deposit_amount = NULLIF(v_dep, 0), initial_deposit_date = CASE WHEN v_dep > 0 THEN v_dep_date END, updated_at = now()
    WHERE id = p_driver;
    IF v_dep > 0 THEN
      UPDATE finance_transactions SET amount = v_dep, transaction_date = v_dep_date, updated_at = now()
      WHERE type = 'fleet_collection' AND system_generated AND linked_driver_id = p_driver AND description LIKE 'Initial deposit%';
    ELSE
      DELETE FROM finance_transactions
      WHERE type = 'fleet_collection' AND system_generated AND linked_driver_id = p_driver AND description LIKE 'Initial deposit%';
    END IF;
  END IF;

  -- The model, corrected from the start (the driver was always on these terms).
  IF v_terms IS NOT NULL THEN
    UPDATE drivers SET model = v_model, shift = v_shift, rest_day = v_rest,
      rate_history = jsonb_build_array(jsonb_build_object('from', v_start, 'daily', v_daily, 'model', v_model, 'rest_day', v_rest)),
      updated_at = now()
    WHERE id = p_driver;
    v_fixed := true;
  END IF;

  -- "Paid until" as confirmed: the difference from the payments is one credit or charge.
  IF v_adj <> 0 THEN
    PERFORM set_config('kivu.adjusting', 'on', true);
    UPDATE drivers SET balance_adjustments = balance_adjustments || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'kind', 'amount', 'date', v_today, 'amount', v_adj,
      'reason', concat_ws(' · ', 'Driver Adjust: paid until ' || to_char(v_until, 'FMDD Mon YYYY') || ' confirmed by the MD', NULLIF(trim(p->>'notes'), '')),
      'by', auth.uid(), 'by_name', v_name, 'at', now(), 'before', p->'before', 'after', p->'after',
      'status', 'confirmed', 'confirmed_by', auth.uid(), 'confirmed_at', now())), updated_at = now()
    WHERE id = p_driver;
    PERFORM set_config('kivu.adjusting', 'off', true);
    INSERT INTO finance_adjustments (target, driver_id, label, from_amount, to_amount, note, reason, effective_date, created_by, by_name)
    VALUES ('driver', p_driver, trim(d.full_name),
      coalesce((p->'before'->>'owes')::numeric, 0), coalesce((p->'after'->>'owes')::numeric, 0),
      CASE WHEN v_adj > 0 THEN format('credit of %s RWF', to_char(v_adj, 'FM999,999,990')) ELSE format('charge of %s RWF', to_char(-v_adj, 'FM999,999,990')) END,
      'Driver Adjust: paid until ' || to_char(v_until, 'FMDD Mon YYYY') || ' confirmed by the MD', v_today, auth.uid(), v_name);
  END IF;

  INSERT INTO driver_money_reviews (driver_id, reviewed_on, start_date, deposit_amount, deposit_date, last_payment_date, paid_until,
    model, daily_rate, shift, rest_day, terms_corrected, adjustment, we_owe_amount, we_owe_note, driver_agrees, notes, before, after, created_by)
  VALUES (p_driver, v_today, v_start, v_dep, CASE WHEN v_dep > 0 THEN v_dep_date END, NULLIF(p->>'last_payment_date', '')::date, v_until,
    v_model, v_daily, v_shift, v_rest, v_fixed, v_adj, v_owe, NULLIF(trim(p->>'we_owe_note'), ''),
    COALESCE((p->>'driver_agrees')::boolean, false), NULLIF(trim(p->>'notes'), ''), p->'before', p->'after', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT department_id FROM profiles WHERE id = auth.uid()), 'confirmed a driver''s money', 'driver', p_driver, d.full_name,
    jsonb_build_object('review', v_id, 'paid_until', v_until, 'adjustment', v_adj,
      'terms', CASE WHEN v_fixed THEN jsonb_build_object('from', jsonb_build_object('model', d.model, 'shift', d.shift, 'rest_day', d.rest_day, 'history', d.rate_history),
                                                    'to', jsonb_build_object('model', v_model, 'shift', v_shift, 'rest_day', v_rest, 'daily', v_daily)) END));
  RETURN v_id;
END $$;
