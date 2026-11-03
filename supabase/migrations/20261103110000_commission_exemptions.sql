/*
# Commission exemptions (MD, 3 Nov 2026)

Company trips (e.g. CEVR) are paid to Kivu Ride and driven by our own paid
drivers, so no 10% commission is counted on them. No driver who isn't ours
does company trips yet; if that changes, this rule is revisited.

- A trip tagged to a company (business_client_trips) is left out of
  commission automatically.
- Any other decision is made by Finance or the MD in Trips > Commissions >
  Preview: leave a trip out (with a reason), or count a company trip after
  all. One row per decided trip; the database stamps who and when from the
  signed-in person.
- Trips whose rider name only looks like a company (drivers type "CEVR",
  "cevr", "CVR") are suggested in the preview; they are left out only once
  Finance or the MD saves them.
- Every decision, change and removal is kept in commission_exemption_log.

Read: Finance, MD, Call Center, IT. Write: Finance and the MD (can_bill()).
*/

CREATE TABLE IF NOT EXISTS commission_exemptions (
  trip_id bigint PRIMARY KEY REFERENCES platform_trips(id) ON DELETE CASCADE,
  exempt boolean NOT NULL,
  reason text,
  decided_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commission_exemption_log (
  id bigserial PRIMARY KEY,
  trip_id bigint NOT NULL,
  exempt boolean,            -- null: the decision was removed (back to the automatic rule)
  reason text,
  actor uuid REFERENCES profiles(id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_exemption_log_trip ON commission_exemption_log (trip_id, at);

-- Who and when come from the session, whatever the page sent.
CREATE OR REPLACE FUNCTION stamp_commission_exemption() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.reason := NULLIF(trim(NEW.reason), '');
  IF NEW.exempt AND NEW.reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason for leaving trip #% out of commission', NEW.trip_id;
  END IF;
  NEW.decided_by := auth.uid();
  NEW.decided_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS commission_exemptions_stamp ON commission_exemptions;
CREATE TRIGGER commission_exemptions_stamp BEFORE INSERT OR UPDATE ON commission_exemptions FOR EACH ROW EXECUTE FUNCTION stamp_commission_exemption();

CREATE OR REPLACE FUNCTION log_commission_exemption() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO commission_exemption_log (trip_id, exempt, reason, actor) VALUES (OLD.trip_id, NULL, 'Decision removed', auth.uid());
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.exempt = NEW.exempt AND OLD.reason IS NOT DISTINCT FROM NEW.reason THEN
    RETURN NEW;
  END IF;
  INSERT INTO commission_exemption_log (trip_id, exempt, reason, actor) VALUES (NEW.trip_id, NEW.exempt, NEW.reason, auth.uid());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS commission_exemptions_log ON commission_exemptions;
CREATE TRIGGER commission_exemptions_log AFTER INSERT OR UPDATE OR DELETE ON commission_exemptions FOR EACH ROW EXECUTE FUNCTION log_commission_exemption();

REVOKE EXECUTE ON FUNCTION stamp_commission_exemption() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION log_commission_exemption() FROM PUBLIC, anon;

ALTER TABLE commission_exemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_exemption_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ce_select ON commission_exemptions;
CREATE POLICY ce_select ON commission_exemptions FOR SELECT TO authenticated USING (can_bill() OR current_department_slug() IN ('call_center', 'it'));
DROP POLICY IF EXISTS ce_insert ON commission_exemptions;
CREATE POLICY ce_insert ON commission_exemptions FOR INSERT TO authenticated WITH CHECK (can_bill());
DROP POLICY IF EXISTS ce_update ON commission_exemptions;
CREATE POLICY ce_update ON commission_exemptions FOR UPDATE TO authenticated USING (can_bill()) WITH CHECK (can_bill());
DROP POLICY IF EXISTS ce_delete ON commission_exemptions;
CREATE POLICY ce_delete ON commission_exemptions FOR DELETE TO authenticated USING (can_bill());

DROP POLICY IF EXISTS cel_select ON commission_exemption_log;
CREATE POLICY cel_select ON commission_exemption_log FOR SELECT TO authenticated USING (can_bill() OR current_department_slug() IN ('call_center', 'it'));
-- No write policies: only the trigger above writes the log.

GRANT SELECT, INSERT, UPDATE, DELETE ON commission_exemptions TO authenticated;
GRANT SELECT ON commission_exemption_log TO authenticated;
