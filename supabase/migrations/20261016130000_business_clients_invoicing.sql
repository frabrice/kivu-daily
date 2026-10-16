/*
# Business clients: trips billed to companies (MD, 16 Oct 2026)

Some companies ride with Kivu Ride under an agreement (e.g. CEVR: two cars
a day). Their people ride with the KivuRide app and do NOT pay at the end of
the trip; Kivu Ride bills the company weekly the exact app fare + 18% VAT.

- business_clients (+ business_client_riders: their riders' phones, used
  to suggest new trips)
- business_client_trips: a platform trip tagged to one company (one
  company per trip; locked once invoiced)
- business_invoices: issued invoices (KR-INV-YYYY-0001), with a frozen
  snapshot of every trip line, VAT, total, payments, the PDF and sending
- business_invoice_payments: full or part payments
- invoice_settings: the issuer's details printed on every invoice

Tagging: Call Center, Finance, MD. Companies, invoices, payments: Finance and MD.
*/

CREATE TABLE IF NOT EXISTS business_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  tin text,
  contact_name text,
  contact_phone text,
  billing_emails text[] NOT NULL DEFAULT '{}',
  address text,
  billing_cycle text NOT NULL DEFAULT 'weekly' CHECK (billing_cycle IN ('weekly', 'monthly')),
  payment_terms_days int NOT NULL DEFAULT 7 CHECK (payment_terms_days BETWEEN 0 AND 120),
  agreement text,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_clients_name ON business_clients (lower(name));

CREATE TABLE IF NOT EXISTS business_client_riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES business_clients(id) ON DELETE CASCADE,
  name text,
  phone text NOT NULL,
  phone_key text GENERATED ALWAYS AS (right(regexp_replace(phone, '\D', '', 'g'), 9)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, phone_key)
);

CREATE SEQUENCE IF NOT EXISTS business_invoice_seq;

CREATE TABLE IF NOT EXISTS business_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES business_clients(id) ON DELETE RESTRICT,
  period_from date NOT NULL,
  period_to date NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  trip_count int NOT NULL,
  distance_km numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL,
  vat_rate numeric NOT NULL,
  vat_amount numeric NOT NULL,
  total numeric NOT NULL,
  amount_paid numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'part_paid', 'paid', 'void')),
  snapshot jsonb NOT NULL,
  notes text,
  pdf_path text,
  sent_at timestamptz,
  sent_to text[],
  sent_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  void_reason text,
  voided_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from)
);
CREATE INDEX IF NOT EXISTS business_invoices_client ON business_invoices (client_id, issue_date DESC);

CREATE TABLE IF NOT EXISTS business_client_trips (
  trip_id bigint PRIMARY KEY REFERENCES platform_trips(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES business_clients(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES business_invoices(id) ON DELETE SET NULL,
  note text,
  added_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_client_trips_client ON business_client_trips (client_id);
CREATE INDEX IF NOT EXISTS business_client_trips_invoice ON business_client_trips (invoice_id);

CREATE TABLE IF NOT EXISTS business_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES business_invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('bank', 'momo', 'cash', 'cheque', 'other')),
  reference text,
  notes text,
  recorded_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  legal_name text NOT NULL DEFAULT 'KIVU RIDE Ltd',
  tin text DEFAULT '148277156',
  address text DEFAULT 'Kimihurura, Gasabo, Kigali, Rwanda',
  phone text DEFAULT '+250 799 526 171',
  email text DEFAULT 'administration@kivuride.com',
  website text DEFAULT 'www.kivuride.com',
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  momo_number text,
  momo_name text,
  vat_rate numeric NOT NULL DEFAULT 0.18 CHECK (vat_rate >= 0 AND vat_rate < 1),
  payment_terms_days int NOT NULL DEFAULT 7,
  footer_note text DEFAULT 'Thank you for riding with Kivu Ride.',
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO invoice_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ access
CREATE OR REPLACE FUNCTION can_bill() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR current_department_slug() = 'finance';
$$;
CREATE OR REPLACE FUNCTION can_tag_trips() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR current_department_slug() IN ('finance', 'call_center');
$$;
REVOKE EXECUTE ON FUNCTION can_bill() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION can_tag_trips() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_bill() TO authenticated;
GRANT EXECUTE ON FUNCTION can_tag_trips() TO authenticated;

ALTER TABLE business_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_client_riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_client_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bc_select ON business_clients;
CREATE POLICY bc_select ON business_clients FOR SELECT TO authenticated USING (can_tag_trips() OR current_department_slug() = 'it');
DROP POLICY IF EXISTS bc_write ON business_clients;
CREATE POLICY bc_write ON business_clients FOR ALL TO authenticated USING (can_bill()) WITH CHECK (can_bill());

DROP POLICY IF EXISTS bcr_select ON business_client_riders;
CREATE POLICY bcr_select ON business_client_riders FOR SELECT TO authenticated USING (can_tag_trips() OR current_department_slug() = 'it');
DROP POLICY IF EXISTS bcr_write ON business_client_riders;
CREATE POLICY bcr_write ON business_client_riders FOR ALL TO authenticated USING (can_tag_trips()) WITH CHECK (can_tag_trips());

DROP POLICY IF EXISTS bct_select ON business_client_trips;
CREATE POLICY bct_select ON business_client_trips FOR SELECT TO authenticated USING (can_tag_trips() OR current_department_slug() = 'it');
DROP POLICY IF EXISTS bct_insert ON business_client_trips;
CREATE POLICY bct_insert ON business_client_trips FOR INSERT TO authenticated WITH CHECK (can_tag_trips() AND invoice_id IS NULL);
-- A trip can be taken off a company only until it's invoiced.
DROP POLICY IF EXISTS bct_delete ON business_client_trips;
CREATE POLICY bct_delete ON business_client_trips FOR DELETE TO authenticated USING (can_tag_trips() AND invoice_id IS NULL);
DROP POLICY IF EXISTS bct_update ON business_client_trips;
CREATE POLICY bct_update ON business_client_trips FOR UPDATE TO authenticated USING (can_tag_trips() AND invoice_id IS NULL) WITH CHECK (can_tag_trips() AND invoice_id IS NULL);

DROP POLICY IF EXISTS bi_select ON business_invoices;
CREATE POLICY bi_select ON business_invoices FOR SELECT TO authenticated USING (can_bill());
DROP POLICY IF EXISTS bip_select ON business_invoice_payments;
CREATE POLICY bip_select ON business_invoice_payments FOR SELECT TO authenticated USING (can_bill());
DROP POLICY IF EXISTS is_select ON invoice_settings;
CREATE POLICY is_select ON invoice_settings FOR SELECT TO authenticated USING (can_bill());
DROP POLICY IF EXISTS is_update ON invoice_settings;
CREATE POLICY is_update ON invoice_settings FOR UPDATE TO authenticated USING (can_bill()) WITH CHECK (can_bill());

-- Only completed trips can be tagged? No - any trip that isn't cancelled
-- (a trip in progress can be tagged as it happens); invoices take completed ones only.
CREATE OR REPLACE FUNCTION check_business_trip() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT status FROM platform_trips WHERE id = NEW.trip_id) = 'cancelled' THEN
    RAISE EXCEPTION 'Trip #% was cancelled - it can''t be billed', NEW.trip_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS business_client_trips_check ON business_client_trips;
CREATE TRIGGER business_client_trips_check BEFORE INSERT ON business_client_trips FOR EACH ROW EXECUTE FUNCTION check_business_trip();

-- ------------------------------------------------------------ issue an invoice
-- Takes the given trips (all must be this company's, completed and not yet
-- invoiced), freezes each line as it is now, adds VAT and numbers it.
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
      WHERE ct.trip_id = x AND ct.client_id = p_client AND ct.invoice_id IS NULL AND t.status = 'completed');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'These trips are not this company''s completed, un-invoiced trips: %', v_bad; END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'trip_id', t.id, 'date', COALESCE(t.started_at, t.created_at), 'completed_at', t.completed_at,
      'rider', t.rider_name, 'rider_phone', t.rider_phone,
      'from', t.pickup_address, 'to', t.destination_address,
      'driver', t.driver_name, 'plate', t.vehicle_plate, 'vehicle_type', t.vehicle_type,
      'km', COALESCE(t.actual_distance_km, t.estimated_distance_km), 'minutes', COALESCE(t.actual_duration_minutes, t.estimated_duration_minutes),
      'waiting_minutes', t.waiting_minutes, 'waiting_fee', t.waiting_fee, 'extras', t.extras_total,
      'extra_items', COALESCE(t.raw->'extra_costs', '[]'::jsonb), 'fare', t.total_fare
    ) ORDER BY COALESCE(t.started_at, t.created_at)),
    COALESCE(sum(t.total_fare), 0), COALESCE(sum(COALESCE(t.actual_distance_km, t.estimated_distance_km)), 0), count(*)
  INTO v_lines, v_sub, v_km, v_n
  FROM platform_trips t WHERE t.id = ANY (p_trip_ids);

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

CREATE OR REPLACE FUNCTION record_invoice_payment(p_invoice uuid, p_amount numeric, p_paid_on date, p_method text, p_reference text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv business_invoices%ROWTYPE; v_paid numeric;
BEGIN
  IF NOT can_bill() THEN RAISE EXCEPTION 'Only Finance or the MD can record payments'; END IF;
  SELECT * INTO v_inv FROM business_invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_inv.status = 'void' THEN RAISE EXCEPTION 'This invoice was cancelled'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter the amount received'; END IF;
  IF p_amount > v_inv.total - v_inv.amount_paid THEN RAISE EXCEPTION 'That is more than the % RWF still due', (v_inv.total - v_inv.amount_paid)::bigint; END IF;
  INSERT INTO business_invoice_payments (invoice_id, amount, paid_on, method, reference, notes)
  VALUES (p_invoice, p_amount, COALESCE(p_paid_on, (now() AT TIME ZONE 'Africa/Kigali')::date), p_method, NULLIF(trim(p_reference), ''), NULLIF(trim(p_notes), ''));
  v_paid := v_inv.amount_paid + p_amount;
  UPDATE business_invoices SET amount_paid = v_paid, status = CASE WHEN v_paid >= total THEN 'paid' ELSE 'part_paid' END WHERE id = p_invoice;
END $$;

-- Cancel an invoice issued by mistake: its trips go back to "not invoiced".
CREATE OR REPLACE FUNCTION void_business_invoice(p_invoice uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv business_invoices%ROWTYPE;
BEGIN
  IF NOT can_bill() THEN RAISE EXCEPTION 'Only Finance or the MD can cancel invoices'; END IF;
  SELECT * INTO v_inv FROM business_invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_inv.amount_paid > 0 THEN RAISE EXCEPTION 'Payments were recorded on this invoice - it can''t be cancelled'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why it is cancelled'; END IF;
  UPDATE business_invoices SET status = 'void', void_reason = trim(p_reason), voided_at = now() WHERE id = p_invoice;
  UPDATE business_client_trips SET invoice_id = NULL WHERE invoice_id = p_invoice;
END $$;

CREATE OR REPLACE FUNCTION set_invoice_pdf(p_invoice uuid, p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT can_bill() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE business_invoices SET pdf_path = p_path WHERE id = p_invoice;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['issue_business_invoice(uuid, date, date, bigint[], text)', 'record_invoice_payment(uuid, numeric, date, text, text, text)',
    'void_business_invoice(uuid, text)', 'set_invoice_pdf(uuid, text)', 'check_business_trip()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- Invoice PDFs: private.
INSERT INTO storage.buckets (id, name, public) VALUES ('business-invoices', 'business-invoices', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "business_invoices_read" ON storage.objects;
CREATE POLICY "business_invoices_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'business-invoices' AND can_bill());
DROP POLICY IF EXISTS "business_invoices_write" ON storage.objects;
CREATE POLICY "business_invoices_write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'business-invoices' AND can_bill());
DROP POLICY IF EXISTS "business_invoices_update" ON storage.objects;
CREATE POLICY "business_invoices_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'business-invoices' AND can_bill());

-- The Trips page's company tags update live.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE business_client_trips; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
