/*
# Call Center: view-only on Fleet; Branding & Devices for the Fleet Manager

Confirmed with the operator.

## Call Center can view Fleet, not change it
Until now the database let Call Center create, edit and delete drivers,
vehicles, deposits, fines, fine payments, documents and contract events
(and anything on Non-Insider cars/drivers) - the same rights as Fleet.
They never used them (no row was ever written by a Call Center account),
so removing them breaks nothing. 'call_center' is taken out of every
INSERT/UPDATE/DELETE/ALL policy on those tables, leaving every other
part of each rule untouched; SELECT stays so agents can answer "have I
paid?" and "who drives RAK 238 L?". Driver documents (ID, criminal
record, medical certificate) are hidden from Call Center entirely.

## The one thing Call Center may set on Non-Insider cars
Whether the car is branded, whether the owner allows branding, and
whether they want to buy our device (plus a note) - through
set_platform_car_interest, never a direct table write. Sync keeps
working: it runs as the service role and never touches these fields.

## Branding & Devices pipeline
When "allows branding" or "wants our device" turns Yes, the car enters
the Fleet Manager's pipeline (status 'to_contact', who recorded it and
when) and the Fleet Manager is emailed. Branding: to_contact ->
scheduled -> branded / not_going_ahead. Device: to_contact -> agreed ->
installed / not_going_ahead. Marking a car branded also sets is_branded.
The fleet_manager duty (Ndekwe Jean Bertrand) decides who is emailed.
*/

-- ============================================================
-- 1. Remove Call Center write access from Fleet tables
-- ============================================================
DO $$
DECLARE
  p record;
  v_using text;
  v_check text;
  v_sql text;
BEGIN
  FOR p IN
    SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('drivers', 'vehicles', 'driver_deposits', 'driver_fines', 'driver_fine_payments',
                        'driver_documents', 'driver_contract_events', 'platform_cars', 'platform_drivers')
      AND (cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') OR (tablename = 'driver_documents' AND cmd = 'SELECT'))
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%call_center%'
  LOOP
    v_using := replace(replace(p.qual, '''call_center''::text, ', ''), ', ''call_center''::text', '');
    v_check := replace(replace(p.with_check, '''call_center''::text, ', ''), ', ''call_center''::text', '');
    v_sql := format('ALTER POLICY %I ON public.%I', p.policyname, p.tablename);
    IF v_using IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_using); END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_check); END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('drivers', 'vehicles', 'driver_deposits', 'driver_fines', 'driver_fine_payments',
                        'driver_documents', 'driver_contract_events', 'platform_cars', 'platform_drivers')
      AND (cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') OR (tablename = 'driver_documents' AND cmd = 'SELECT'))
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%call_center%'
  ) THEN
    RAISE EXCEPTION 'Call Center still has write access on a Fleet table';
  END IF;
END $$;

-- ============================================================
-- 2. Branding & Devices pipeline columns
-- ============================================================
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS branding_status text
  CHECK (branding_status IN ('to_contact', 'scheduled', 'branded', 'not_going_ahead'));
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS branding_recorded_at timestamptz;
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS branding_recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS device_status text
  CHECK (device_status IN ('to_contact', 'agreed', 'installed', 'not_going_ahead'));
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS device_recorded_at timestamptz;
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS device_recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS followup_notes text;
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS followup_updated_at timestamptz;
ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS followup_updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Keep the pipeline in step with the three survey answers, whoever
-- changes them (Call Center RPC, Fleet's own edit form, or Fleet's
-- pipeline page).
CREATE OR REPLACE FUNCTION sync_platform_car_pipeline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.allows_branding IS TRUE AND (TG_OP = 'INSERT' OR OLD.allows_branding IS DISTINCT FROM TRUE) AND NEW.branding_status IS NULL THEN
    NEW.branding_status := CASE WHEN NEW.is_branded IS TRUE THEN 'branded' ELSE 'to_contact' END;
    NEW.branding_recorded_at := now();
    NEW.branding_recorded_by := auth.uid();
  END IF;
  IF NEW.willing_to_buy_device IS TRUE AND (TG_OP = 'INSERT' OR OLD.willing_to_buy_device IS DISTINCT FROM TRUE) AND NEW.device_status IS NULL THEN
    NEW.device_status := 'to_contact';
    NEW.device_recorded_at := now();
    NEW.device_recorded_by := auth.uid();
  END IF;
  -- Branded either way round: the pipeline says so, or the car does.
  IF NEW.branding_status = 'branded' THEN NEW.is_branded := true; END IF;
  IF NEW.is_branded IS TRUE AND NEW.branding_status IN ('to_contact', 'scheduled') THEN NEW.branding_status := 'branded'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_cars_sync_pipeline ON platform_cars;
CREATE TRIGGER platform_cars_sync_pipeline BEFORE INSERT OR UPDATE ON platform_cars
  FOR EACH ROW EXECUTE FUNCTION sync_platform_car_pipeline();

CREATE OR REPLACE FUNCTION notify_platform_car_interest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.branding_status = 'to_contact' AND (TG_OP = 'INSERT' OR OLD.branding_status IS DISTINCT FROM 'to_contact') THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('car_interest_recorded', jsonb_build_object('car_id', NEW.id, 'kind', 'branding', 'actor_id', auth.uid()));
  END IF;
  IF NEW.device_status = 'to_contact' AND (TG_OP = 'INSERT' OR OLD.device_status IS DISTINCT FROM 'to_contact') THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('car_interest_recorded', jsonb_build_object('car_id', NEW.id, 'kind', 'device', 'actor_id', auth.uid()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_cars_notify_interest ON platform_cars;
CREATE TRIGGER platform_cars_notify_interest AFTER INSERT OR UPDATE ON platform_cars
  FOR EACH ROW EXECUTE FUNCTION notify_platform_car_interest();

-- Call Center's only write on Non-Insider cars.
CREATE OR REPLACE FUNCTION set_platform_car_interest(
  p_car_id uuid, p_is_branded boolean, p_allows_branding boolean, p_willing_to_buy_device boolean, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() IN ('call_center', 'fleet', 'it')) THEN
    RAISE EXCEPTION 'Only the Call Center, Fleet, IT or the MD can update this';
  END IF;
  UPDATE platform_cars SET
    is_branded = p_is_branded,
    allows_branding = p_allows_branding,
    willing_to_buy_device = p_willing_to_buy_device,
    notes = CASE WHEN NULLIF(trim(p_note), '') IS NULL THEN notes
                 ELSE concat_ws(E'\n', NULLIF(notes, ''), to_char(now() AT TIME ZONE 'Africa/Kigali', 'DD Mon') || ' — ' || trim(p_note)
                   || ' (' || COALESCE((SELECT full_name FROM profiles WHERE id = auth.uid()), 'someone') || ')') END,
    updated_at = now()
  WHERE id = p_car_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Car not found'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION set_platform_car_interest(uuid, boolean, boolean, boolean, text) TO authenticated;

-- Backfill: cars already marked during the survey enter the pipeline
-- quietly (no burst of emails for old answers).
ALTER TABLE platform_cars DISABLE TRIGGER platform_cars_notify_interest;
UPDATE platform_cars SET
  branding_status = CASE WHEN is_branded THEN 'branded' ELSE 'to_contact' END,
  branding_recorded_at = COALESCE(updated_at, created_at),
  branding_recorded_by = created_by
WHERE allows_branding IS TRUE AND branding_status IS NULL;
UPDATE platform_cars SET
  device_status = 'to_contact',
  device_recorded_at = COALESCE(updated_at, created_at),
  device_recorded_by = created_by
WHERE willing_to_buy_device IS TRUE AND device_status IS NULL;
ALTER TABLE platform_cars ENABLE TRIGGER platform_cars_notify_interest;

-- ============================================================
-- 3. Fleet Manager duty + email rule
-- ============================================================
INSERT INTO responsibilities (key, label, description, profile_id) VALUES
  ('fleet_manager', 'Fleet Manager', 'Branding and device follow-ups, vehicle breakdowns, condition and accident operations.',
    (SELECT id FROM profiles WHERE lower(trim(full_name)) = 'ndekwe jean bertrand' AND is_active LIMIT 1))
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('car_interest_recorded', 'Branding / device interest', 'A Non-Insider car owner allows branding or wants to buy our device - follow up from Branding & Devices.', 'Instant', ARRAY['resp:fleet_manager'], 4, 415, 'Fleet & operations', true, NULL)
ON CONFLICT (key) DO NOTHING;
