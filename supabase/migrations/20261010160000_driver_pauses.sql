/*
# Driver pauses (days off that don't count)

Confirmed with the MD (10 Oct 2026). An insider driver who is sick, whose
car is in the garage, etc. shouldn't keep owing 30,000 RWF a day. A pause
makes those days count exactly like the weekly rest day: free, never owed,
never "lost", and the driver isn't chased while paused.

- Who records: the driver-payments follow-up holder (Janviere), the Fleet
  Manager (Bertrand) and the MD.
- Effective immediately; the MD or Finance approves or rejects afterwards.
  A rejected pause stops counting as off (those days are owed again).
- Reason required (sick, car in the garage, accident, family emergency,
  approved leave, other + note). Proof upload is optional.
- From a date (backdated up to 14 days) until a date, or open-ended until
  someone presses Resume. Whole days, as recorded.
- "Car in the garage" pauses every driver currently on that car (day and
  night) as one group; resuming / reviewing one acts on the group.
- Owner payments and driver salaries are unchanged.
*/

CREATE TABLE IF NOT EXISTS driver_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  reason text NOT NULL CHECK (reason IN ('sick', 'garage', 'accident', 'family', 'leave', 'other')),
  note text,
  start_date date NOT NULL,
  end_date date,                       -- last day off (inclusive); NULL = until resumed
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  proof_path text,
  recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resumed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS driver_pauses_driver_idx ON driver_pauses (driver_id, start_date);
CREATE INDEX IF NOT EXISTS driver_pauses_group_idx ON driver_pauses (group_id);
ALTER TABLE driver_pauses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "driver_pauses_select" ON driver_pauses;
CREATE POLICY "driver_pauses_select" ON driver_pauses FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'it', 'finance') OR is_managing_director());

-- Who may record / resume, and who may approve.
CREATE OR REPLACE FUNCTION can_record_driver_pause()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR auth.uid() IN (
    SELECT profile_id FROM responsibilities WHERE key IN ('driver_payment_followup', 'fleet_manager') AND profile_id IS NOT NULL);
$$;
CREATE OR REPLACE FUNCTION can_review_driver_pause()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR current_department_slug() = 'finance';
$$;

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

  FOR v_target IN
    SELECT d.id, d.full_name, d.vehicle_id FROM drivers d
    WHERE (v_whole_car AND d.vehicle_id = v_driver.vehicle_id AND d.contract_status = 'active') OR d.id = v_driver.id
  LOOP
    -- No overlapping pauses for the same driver (rejected ones don't count).
    SELECT to_char(x.start_date, 'DD Mon') || COALESCE('–' || to_char(x.end_date, 'DD Mon'), ' onward') INTO v_clash
    FROM driver_pauses x
    WHERE x.driver_id = v_target.id AND x.approval_status <> 'rejected'
      AND x.start_date <= COALESCE(v_end, 'infinity'::date) AND COALESCE(x.end_date, 'infinity'::date) >= v_start
    LIMIT 1;
    IF v_clash IS NOT NULL THEN RAISE EXCEPTION '% already has a pause for %', v_target.full_name, v_clash; END IF;

    INSERT INTO driver_pauses (driver_id, vehicle_id, group_id, reason, note, start_date, end_date, proof_path, recorded_by)
    VALUES (v_target.id, v_target.vehicle_id, v_group, v_reason, v_note, v_start, v_end, NULLIF(p->>'proof_path', ''), auth.uid());
  END LOOP;

  INSERT INTO notification_events (rule_key, payload) VALUES ('driver_pause_recorded', jsonb_build_object('group_id', v_group, 'actor_id', auth.uid()));
  RETURN v_group;
END;
$$;

-- Resume: the given day is the LAST day off; they count again from the next.
CREATE OR REPLACE FUNCTION resume_driver_pause(p_pause_id uuid, p_last_day_off date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v driver_pauses%ROWTYPE;
BEGIN
  IF NOT (can_record_driver_pause() OR can_review_driver_pause()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO v FROM driver_pauses WHERE id = p_pause_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pause not found'; END IF;
  IF p_last_day_off < v.start_date THEN RAISE EXCEPTION 'The last day off can''t be before the pause started (%)', to_char(v.start_date, 'DD Mon'); END IF;
  UPDATE driver_pauses SET end_date = p_last_day_off, resumed_by = auth.uid(), resumed_at = now(), updated_at = now()
  WHERE group_id = v.group_id AND end_date IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION review_driver_pause(p_pause_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v driver_pauses%ROWTYPE;
BEGIN
  IF NOT can_review_driver_pause() THEN RAISE EXCEPTION 'Only the MD or Finance can approve or reject a pause'; END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Approve or reject'; END IF;
  IF p_decision = 'rejected' AND NULLIF(trim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why it''s rejected'; END IF;
  SELECT * INTO v FROM driver_pauses WHERE id = p_pause_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pause not found'; END IF;
  UPDATE driver_pauses SET approval_status = p_decision, review_note = NULLIF(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE group_id = v.group_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_driver_pause_proof(p_pause_id uuid, p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v driver_pauses%ROWTYPE;
BEGIN
  IF NOT (can_record_driver_pause() OR can_review_driver_pause()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO v FROM driver_pauses WHERE id = p_pause_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pause not found'; END IF;
  UPDATE driver_pauses SET proof_path = NULLIF(trim(p_path), ''), updated_at = now() WHERE group_id = v.group_id;
END;
$$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('can_record_driver_pause', 'can_review_driver_pause', 'record_driver_pause', 'resume_driver_pause', 'review_driver_pause', 'set_driver_pause_proof')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
  END LOOP;
END $$;

-- Optional proof (medical note, garage document). Private bucket.
INSERT INTO storage.buckets (id, name, public) VALUES ('driver-pause-proofs', 'driver-pause-proofs', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "driver_pause_proofs_select" ON storage.objects;
CREATE POLICY "driver_pause_proofs_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'driver-pause-proofs' AND (current_department_slug() IN ('fleet', 'it', 'finance') OR is_managing_director()));
DROP POLICY IF EXISTS "driver_pause_proofs_insert" ON storage.objects;
CREATE POLICY "driver_pause_proofs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-pause-proofs' AND (can_record_driver_pause() OR can_review_driver_pause()));

-- New pauses: one line in the MD's and Finance's next morning email (the
-- approval itself is a smart task).
INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key, delivery) VALUES
  ('driver_pause_recorded', 'Driver paused', 'A driver''s days were paused (sick, car in the garage...) - to approve or reject.', 'Instant', ARRAY['md', 'resp:route_finance'], 1, 85, 'Driver payments', true, NULL, 'digest')
ON CONFLICT (key) DO NOTHING;
