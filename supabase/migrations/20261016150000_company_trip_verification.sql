/*
# Company trips: added by the team, verified by Finance or the MD (MD, 16 Oct 2026)

- New duty "Company trips" (MD Panel -> Who's in charge), given to Janviere:
  she sees the Companies pages and adds trips to companies. Call Center
  agents can add trips too.
- Every trip added waits for verification by Finance or the MD; only
  verified trips can go on an invoice. A trip added by Finance or the MD
  is verified at once (by them).
- Who did what is recorded by the database from the signed-in person -
  never from what the page sends: added_by / verified_by on the trip, and
  every step (added, verified, rejected, removed, invoiced, released) in
  business_client_trip_log with the person, time and reason.
*/

INSERT INTO responsibilities (key, label, description, profile_id)
VALUES ('company_trips', 'Company trips', 'Adds the trips done for business clients (e.g. CEVR) to their company, for Finance to verify and invoice.',
        (SELECT id FROM profiles WHERE full_name ILIKE 'Uwera Janviere%' AND is_active LIMIT 1))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION can_tag_trips() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR current_department_slug() IN ('finance', 'call_center')
    OR auth.uid() IN (SELECT profile_id FROM responsibilities WHERE key = 'company_trips' AND profile_id IS NOT NULL);
$$;

ALTER TABLE business_client_trips ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified'));
ALTER TABLE business_client_trips ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE business_client_trips ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE INDEX IF NOT EXISTS business_client_trips_status ON business_client_trips (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS business_client_trip_log (
  id bigserial PRIMARY KEY,
  trip_id bigint NOT NULL,
  client_id uuid REFERENCES business_clients(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('added', 'verified', 'rejected', 'removed', 'invoiced', 'released')),
  actor uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_client_trip_log_client ON business_client_trip_log (client_id, at DESC);
CREATE INDEX IF NOT EXISTS business_client_trip_log_trip ON business_client_trip_log (trip_id, at);
ALTER TABLE business_client_trip_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bctl_select ON business_client_trip_log;
CREATE POLICY bctl_select ON business_client_trip_log FOR SELECT TO authenticated USING (can_tag_trips() OR current_department_slug() = 'it');
-- No write policies: only the triggers below write the log.

-- Stamp who added it, from the session - whatever the page sent.
CREATE OR REPLACE FUNCTION stamp_business_trip() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT status FROM platform_trips WHERE id = NEW.trip_id) = 'cancelled' THEN
    RAISE EXCEPTION 'Trip #% was cancelled - it can''t be billed', NEW.trip_id;
  END IF;
  NEW.added_by := auth.uid();
  NEW.added_at := now();
  NEW.invoice_id := NULL;
  IF can_bill() THEN
    NEW.status := 'verified'; NEW.verified_by := auth.uid(); NEW.verified_at := now();
  ELSE
    NEW.status := 'pending'; NEW.verified_by := NULL; NEW.verified_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS business_client_trips_check ON business_client_trips;
DROP TRIGGER IF EXISTS business_client_trips_stamp ON business_client_trips;
CREATE TRIGGER business_client_trips_stamp BEFORE INSERT ON business_client_trips FOR EACH ROW EXECUTE FUNCTION stamp_business_trip();

CREATE OR REPLACE FUNCTION log_business_trip() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reason text := NULLIF(current_setting('kivu.trip_reject_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO business_client_trip_log (trip_id, client_id, action, actor, note) VALUES (NEW.trip_id, NEW.client_id, 'added', auth.uid(), NEW.note);
    IF NEW.status = 'verified' THEN
      INSERT INTO business_client_trip_log (trip_id, client_id, action, actor, note) VALUES (NEW.trip_id, NEW.client_id, 'verified', auth.uid(), 'Added by Finance / MD');
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'verified' AND OLD.status <> 'verified' THEN
      INSERT INTO business_client_trip_log (trip_id, client_id, action, actor) VALUES (NEW.trip_id, NEW.client_id, 'verified', auth.uid());
    END IF;
    IF NEW.invoice_id IS NOT NULL AND OLD.invoice_id IS NULL THEN
      INSERT INTO business_client_trip_log (trip_id, client_id, action, actor, note)
      VALUES (NEW.trip_id, NEW.client_id, 'invoiced', auth.uid(), (SELECT number FROM business_invoices WHERE id = NEW.invoice_id));
    ELSIF NEW.invoice_id IS NULL AND OLD.invoice_id IS NOT NULL THEN
      INSERT INTO business_client_trip_log (trip_id, client_id, action, actor, note)
      VALUES (NEW.trip_id, NEW.client_id, 'released', auth.uid(), 'Invoice ' || (SELECT number FROM business_invoices WHERE id = OLD.invoice_id) || ' cancelled');
    END IF;
  ELSE
    INSERT INTO business_client_trip_log (trip_id, client_id, action, actor, note)
    VALUES (OLD.trip_id, OLD.client_id, CASE WHEN v_reason IS NOT NULL THEN 'rejected' ELSE 'removed' END, auth.uid(), v_reason);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS business_client_trips_log ON business_client_trips;
CREATE TRIGGER business_client_trips_log AFTER INSERT OR UPDATE OR DELETE ON business_client_trips FOR EACH ROW EXECUTE FUNCTION log_business_trip();

-- Writes: anyone who tags can add; a trip waiting for verification can be
-- taken off by whoever tags; once verified only Finance / the MD; never once invoiced.
DROP POLICY IF EXISTS bct_insert ON business_client_trips;
CREATE POLICY bct_insert ON business_client_trips FOR INSERT TO authenticated WITH CHECK (can_tag_trips());
DROP POLICY IF EXISTS bct_delete ON business_client_trips;
CREATE POLICY bct_delete ON business_client_trips FOR DELETE TO authenticated
  USING (invoice_id IS NULL AND (can_bill() OR (can_tag_trips() AND status = 'pending')));
DROP POLICY IF EXISTS bct_update ON business_client_trips;   -- status and invoices change through the functions below only

CREATE OR REPLACE FUNCTION verify_company_trips(p_trip_ids bigint[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT can_bill() THEN RAISE EXCEPTION 'Only Finance or the MD can verify company trips'; END IF;
  UPDATE business_client_trips SET status = 'verified', verified_by = auth.uid(), verified_at = now()
  WHERE trip_id = ANY (p_trip_ids) AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Not this company's trip: taken off (logged with the reason), free to be added elsewhere.
CREATE OR REPLACE FUNCTION reject_company_trips(p_trip_ids bigint[], p_reason text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT can_bill() THEN RAISE EXCEPTION 'Only Finance or the MD can reject company trips'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why these trips are rejected'; END IF;
  PERFORM set_config('kivu.trip_reject_reason', trim(p_reason), true);
  DELETE FROM business_client_trips WHERE trip_id = ANY (p_trip_ids) AND invoice_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('kivu.trip_reject_reason', '', true);
  RETURN n;
END $$;

-- Invoices take verified trips only.
CREATE OR REPLACE FUNCTION issue_business_invoice(p_client uuid, p_from date, p_to date, p_trip_ids bigint[], p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_client business_clients%ROWTYPE;
  v_set invoice_settings%ROWTYPE;
  v_bad text;
  v_lines jsonb;
  v_sub numeric;
  v_km numeric;
  v_n int;
  v_vat numeric;
  v_id uuid;
  v_number text;
BEGIN
  IF NOT can_bill() THEN RAISE EXCEPTION 'Only Finance or the MD can issue invoices'; END IF;
  SELECT * INTO v_client FROM business_clients WHERE id = p_client;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF p_to < p_from THEN RAISE EXCEPTION 'The period ends before it starts'; END IF;
  IF COALESCE(array_length(p_trip_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Choose at least one trip'; END IF;
  SELECT * INTO v_set FROM invoice_settings WHERE id;

  PERFORM 1 FROM business_client_trips WHERE trip_id = ANY (p_trip_ids) FOR UPDATE;
  SELECT string_agg('#' || x, ', ') INTO v_bad FROM unnest(p_trip_ids) x
    WHERE NOT EXISTS (
      SELECT 1 FROM business_client_trips ct JOIN platform_trips t ON t.id = ct.trip_id
      WHERE ct.trip_id = x AND ct.client_id = p_client AND ct.invoice_id IS NULL AND ct.status = 'verified' AND t.status = 'completed');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'These trips are not this company''s verified, completed, un-invoiced trips: %', v_bad; END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'trip_id', t.id, 'date', COALESCE(t.started_at, t.created_at), 'completed_at', t.completed_at,
      'rider', t.rider_name, 'rider_phone', t.rider_phone,
      'from', t.pickup_address, 'to', t.destination_address,
      'driver', t.driver_name, 'plate', t.vehicle_plate, 'vehicle_type', t.vehicle_type,
      'km', COALESCE(t.actual_distance_km, t.estimated_distance_km), 'minutes', COALESCE(t.actual_duration_minutes, t.estimated_duration_minutes),
      'waiting_minutes', t.waiting_minutes, 'waiting_fee', t.waiting_fee, 'extras', t.extras_total,
      'extra_items', COALESCE(t.raw->'extra_costs', '[]'::jsonb), 'fare', t.total_fare,
      'added_by', (SELECT full_name FROM profiles WHERE id = ct.added_by), 'verified_by', (SELECT full_name FROM profiles WHERE id = ct.verified_by)
    ) ORDER BY COALESCE(t.started_at, t.created_at)),
    COALESCE(sum(t.total_fare), 0), COALESCE(sum(COALESCE(t.actual_distance_km, t.estimated_distance_km)), 0), count(*)
  INTO v_lines, v_sub, v_km, v_n
  FROM platform_trips t JOIN business_client_trips ct ON ct.trip_id = t.id WHERE t.id = ANY (p_trip_ids);

  v_vat := round(v_sub * v_set.vat_rate);
  v_number := 'KR-INV-' || to_char(v_today, 'YYYY') || '-' || lpad(nextval('business_invoice_seq')::text, 4, '0');

  INSERT INTO business_invoices (number, client_id, period_from, period_to, issue_date, due_date, trip_count, distance_km, subtotal, vat_rate, vat_amount, total, snapshot, notes)
  VALUES (v_number, p_client, p_from, p_to, v_today, v_today + v_client.payment_terms_days, v_n, round(v_km, 1), round(v_sub), v_set.vat_rate, v_vat, round(v_sub) + v_vat,
    jsonb_build_object('lines', v_lines, 'client', to_jsonb(v_client) - 'created_by' - 'created_at' - 'updated_at', 'issuer', to_jsonb(v_set) - 'updated_by' - 'updated_at' - 'id'),
    NULLIF(trim(p_notes), ''))
  RETURNING id INTO v_id;
  UPDATE business_client_trips SET invoice_id = v_id WHERE trip_id = ANY (p_trip_ids);
  RETURN v_id;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['verify_company_trips(bigint[])', 'reject_company_trips(bigint[], text)', 'stamp_business_trip()', 'log_business_trip()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS check_business_trip();

-- Invoice numbers continue from the last real invoice (test runs can consume sequence values).
SELECT setval('business_invoice_seq', COALESCE((SELECT max(substring(number FROM '(\d+)$')::int) FROM business_invoices), 0) + 1, false);
