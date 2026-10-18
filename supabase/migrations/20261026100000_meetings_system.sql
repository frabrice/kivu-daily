/*
# Meetings, run systematically (MD, 18 Oct 2026)

- meeting_series: regular meetings, preset - days of the week, start time,
  length, who is expected, the one note-taker, the agenda and which numbers
  to record (fleet / it / call_center). Seeded: the daily 19:00 fleet &
  drivers money meeting, IT on Tue/Thu/Sat 20:00, and a weekly 30-minute
  one-to-one with each Call Center agent between 10:00 and 13:00.
- meeting_occurrences: each actual meeting (created for the day from its
  series, or booked) - real start and end time, notes, the numbers.
- meeting_attendance: expected / present / late / absent / excused, guests.
- meeting_items: decisions, action items (become tasks for their owner when
  the meeting ends) and onboarding checklist points.
- meeting_slots: 30-minute slots the MD opens; staff book one (onboarding
  one-to-ones, instead of a Google Calendar).
Only the note-taker (or the MD) writes the notes. Ending a meeting emails a
recap to everyone expected.
*/

CREATE TABLE IF NOT EXISTS meeting_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('fleet_daily', 'it', 'one_on_one', 'onboarding', 'other')),
  purpose text,
  days int[] NOT NULL DEFAULT '{}',              -- ISO weekdays, 1 = Monday
  start_time time NOT NULL,
  duration_min int NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 480),
  expected uuid[] NOT NULL DEFAULT '{}',
  host_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note_taker_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  with_profile uuid REFERENCES profiles(id) ON DELETE CASCADE,   -- the person of a one-to-one
  agenda text[] NOT NULL DEFAULT '{}',
  metrics text CHECK (metrics IN ('fleet', 'it', 'call_center')),
  email_recap boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid REFERENCES meeting_series(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'other',
  title text NOT NULL,
  day date NOT NULL,
  scheduled_start time,
  duration_min int NOT NULL DEFAULT 30,
  started_at timestamptz,
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'running', 'done', 'cancelled')),
  host_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note_taker_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  with_profile uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expected uuid[] NOT NULL DEFAULT '{}',
  agenda text[] NOT NULL DEFAULT '{}',
  metrics_kind text,
  notes text,
  metrics jsonb NOT NULL DEFAULT '{}',
  recap_sent_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id, day)
);
CREATE INDEX IF NOT EXISTS meeting_occurrences_day ON meeting_occurrences (day DESC);

CREATE TABLE IF NOT EXISTS meeting_attendance (
  occurrence_id uuid NOT NULL REFERENCES meeting_occurrences(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'present', 'late', 'absent', 'excused')),
  reason text,
  guest boolean NOT NULL DEFAULT false,
  marked_at timestamptz,
  PRIMARY KEY (occurrence_id, profile_id)
);

CREATE TABLE IF NOT EXISTS meeting_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES meeting_occurrences(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('decision', 'action', 'check')),
  text text NOT NULL,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  due_date date,
  done boolean NOT NULL DEFAULT false,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  sort int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at timestamptz NOT NULL,
  duration_min int NOT NULL DEFAULT 30,
  purpose text NOT NULL DEFAULT 'onboarding',
  title text NOT NULL DEFAULT 'Your new dashboard: one-to-one with the MD',
  host_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  booked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  booked_at timestamptz,
  occurrence_id uuid REFERENCES meeting_occurrences(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_slots_one_per_person ON meeting_slots (purpose, booked_by) WHERE booked_by IS NOT NULL;

-- ------------------------------------------------------------ who sees and runs a meeting
CREATE OR REPLACE FUNCTION can_see_meeting(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR EXISTS (
    SELECT 1 FROM meeting_occurrences o WHERE o.id = p_id AND (auth.uid() = ANY (o.expected) OR o.host_id = auth.uid() OR o.note_taker_id = auth.uid() OR o.with_profile = auth.uid()
      OR EXISTS (SELECT 1 FROM meeting_attendance a WHERE a.occurrence_id = o.id AND a.profile_id = auth.uid())));
$$;
CREATE OR REPLACE FUNCTION can_run_meeting(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR EXISTS (SELECT 1 FROM meeting_occurrences o WHERE o.id = p_id AND (o.host_id = auth.uid() OR o.note_taker_id = auth.uid()));
$$;

-- Only the note-taker (or the MD) writes the notes; the times and status move through the RPCs.
CREATE OR REPLACE FUNCTION meeting_occurrence_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF auth.uid() IS NULL OR is_managing_director() THEN RETURN NEW; END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes AND OLD.note_taker_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the note-taker writes the notes of this meeting';
  END IF;
  IF NEW.note_taker_id IS DISTINCT FROM OLD.note_taker_id AND OLD.note_taker_id IS DISTINCT FROM auth.uid() AND OLD.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the host or the current note-taker hands over the notes';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS meeting_occurrence_guard ON meeting_occurrences;
CREATE TRIGGER meeting_occurrence_guard BEFORE UPDATE ON meeting_occurrences FOR EACH ROW EXECUTE FUNCTION meeting_occurrence_guard();

-- Today's (or any day's) meetings from the regular series - safe to call often.
CREATE OR REPLACE FUNCTION ensure_meeting_occurrences(p_day date) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s meeting_series%ROWTYPE; v uuid; n int := 0;
BEGIN
  FOR s IN SELECT * FROM meeting_series WHERE active AND extract(isodow FROM p_day)::int = ANY (days) LOOP
    INSERT INTO meeting_occurrences (series_id, kind, title, day, scheduled_start, duration_min, host_id, note_taker_id, with_profile, expected, agenda, metrics_kind, created_by)
    VALUES (s.id, s.kind, s.name, p_day, s.start_time, s.duration_min, s.host_id, s.note_taker_id, s.with_profile, s.expected, s.agenda, s.metrics, s.created_by)
    ON CONFLICT (series_id, day) DO NOTHING RETURNING id INTO v;
    IF v IS NOT NULL THEN
      INSERT INTO meeting_attendance (occurrence_id, profile_id) SELECT v, unnest(s.expected) ON CONFLICT DO NOTHING;
      n := n + 1; v := NULL;
    END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION start_meeting(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT can_run_meeting(p_id) THEN RAISE EXCEPTION 'Only the host or the note-taker starts the meeting'; END IF;
  UPDATE meeting_occurrences SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = p_id AND status IN ('scheduled', 'running');
END $$;

-- End: save the numbers, turn action items into tasks, send the recap.
CREATE OR REPLACE FUNCTION end_meeting(p_id uuid, p_metrics jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o meeting_occurrences%ROWTYPE; it meeting_items%ROWTYPE; t uuid;
BEGIN
  IF NOT can_run_meeting(p_id) THEN RAISE EXCEPTION 'Only the host or the note-taker ends the meeting'; END IF;
  SELECT * INTO o FROM meeting_occurrences WHERE id = p_id FOR UPDATE;
  UPDATE meeting_occurrences SET status = 'done', started_at = COALESCE(started_at, now()), ended_at = now(), metrics = COALESCE(p_metrics, metrics) WHERE id = p_id;
  -- Anyone still "expected" did not come.
  UPDATE meeting_attendance SET status = 'absent', marked_at = now() WHERE occurrence_id = p_id AND status = 'expected';
  FOR it IN SELECT * FROM meeting_items WHERE occurrence_id = p_id AND kind = 'action' AND owner_id IS NOT NULL AND task_id IS NULL LOOP
    INSERT INTO tasks (user_id, title, description, date, assigned_by)
    VALUES (it.owner_id, it.text, 'From the meeting "' || o.title || '" on ' || to_char(o.day, 'DD Mon YYYY'), COALESCE(it.due_date, (now() AT TIME ZONE 'Africa/Kigali')::date + 1), auth.uid())
    RETURNING id INTO t;
    UPDATE meeting_items SET task_id = t WHERE id = it.id;
  END LOOP;
  IF o.recap_sent_at IS NULL AND COALESCE((SELECT email_recap FROM meeting_series WHERE id = o.series_id), true) THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('meeting_recap', jsonb_build_object('occurrence_id', p_id, 'actor_id', NULL));
    UPDATE meeting_occurrences SET recap_sent_at = now() WHERE id = p_id;
  END IF;
END $$;

-- Book an open slot: it becomes a one-to-one meeting with its checklist.
CREATE OR REPLACE FUNCTION book_meeting_slot(p_slot uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s meeting_slots%ROWTYPE; v uuid; me uuid := auth.uid(); nm text; dept text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO s FROM meeting_slots WHERE id = p_slot FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Slot not found'; END IF;
  IF s.booked_by IS NOT NULL THEN RAISE EXCEPTION 'Someone already booked this slot - choose another one'; END IF;
  IF s.starts_at < now() THEN RAISE EXCEPTION 'This slot has passed'; END IF;
  IF EXISTS (SELECT 1 FROM meeting_slots WHERE purpose = s.purpose AND booked_by = me) THEN RAISE EXCEPTION 'You already booked one - cancel it first to change'; END IF;
  SELECT p.full_name, d.slug INTO nm, dept FROM profiles p LEFT JOIN departments d ON d.id = p.department_id WHERE p.id = me;
  INSERT INTO meeting_occurrences (kind, title, day, scheduled_start, duration_min, host_id, note_taker_id, with_profile, expected, agenda, created_by)
  VALUES ('onboarding', s.title || ' — ' || trim(nm), (s.starts_at AT TIME ZONE 'Africa/Kigali')::date, (s.starts_at AT TIME ZONE 'Africa/Kigali')::time, s.duration_min,
    s.host_id, s.host_id, me, ARRAY[s.host_id, me], ARRAY['Your dashboard and the new way of working', 'What you must record, and when', 'What to focus on', 'Questions'], me)
  RETURNING id INTO v;
  INSERT INTO meeting_attendance (occurrence_id, profile_id) VALUES (v, s.host_id), (v, me) ON CONFLICT DO NOTHING;
  INSERT INTO meeting_items (occurrence_id, kind, text, sort, created_by) SELECT v, 'check', x, row_number() OVER (), s.host_id FROM unnest(CASE dept
    WHEN 'fleet' THEN ARRAY['Deposits: the Sunday rule, Monday is late, next payment on every driver', 'Taking a car back and recording it', 'Same-day replacement of a driver', 'Fines, accidents and cars in the garage', 'The daily 19:00 meeting and its numbers']
    WHEN 'call_center' THEN ARRAY['Cases and calls: what to record on every call', 'Commission follow-up: the daily list, recording the outcome', 'Trips for companies', 'Your weekly one-to-one']
    WHEN 'finance' THEN ARRAY['Ledger: linking expenses to budgets and IT projects', 'Cash balances on the Money page', 'Budget approvals', 'The daily 19:00 meeting and the monthly review']
    WHEN 'it' THEN ARRAY['Issues, milestones and check-ins', 'Releases and the weekly review', 'Health page and AI help', 'The IT meeting Tue/Thu/Sat 20:00']
    ELSE ARRAY['Your home page and tasks', 'What you must record, and when', 'Who to ask for help'] END) x;
  UPDATE meeting_slots SET booked_by = me, booked_at = now(), occurrence_id = v WHERE id = p_slot;
  INSERT INTO notification_events (rule_key, payload) VALUES ('meeting_booked', jsonb_build_object('slot_id', p_slot, 'actor_id', me, 'recipient_id', s.host_id));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION cancel_meeting_slot(p_slot uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s meeting_slots%ROWTYPE;
BEGIN
  SELECT * INTO s FROM meeting_slots WHERE id = p_slot FOR UPDATE;
  IF NOT FOUND OR NOT (s.booked_by = auth.uid() OR is_managing_director()) THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF s.occurrence_id IS NOT NULL THEN DELETE FROM meeting_occurrences WHERE id = s.occurrence_id AND status = 'scheduled'; END IF;
  UPDATE meeting_slots SET booked_by = NULL, booked_at = NULL, occurrence_id = NULL WHERE id = p_slot;
END $$;

-- ------------------------------------------------------------ access
ALTER TABLE meeting_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ms_select ON meeting_series; CREATE POLICY ms_select ON meeting_series FOR SELECT TO authenticated USING (is_managing_director() OR auth.uid() = ANY (expected) OR host_id = auth.uid() OR note_taker_id = auth.uid() OR with_profile = auth.uid());
DROP POLICY IF EXISTS ms_write ON meeting_series; CREATE POLICY ms_write ON meeting_series FOR ALL TO authenticated USING (is_managing_director()) WITH CHECK (is_managing_director());
DROP POLICY IF EXISTS mo_select ON meeting_occurrences; CREATE POLICY mo_select ON meeting_occurrences FOR SELECT TO authenticated USING (can_see_meeting(id));
DROP POLICY IF EXISTS mo_insert ON meeting_occurrences; CREATE POLICY mo_insert ON meeting_occurrences FOR INSERT TO authenticated WITH CHECK (is_managing_director());
DROP POLICY IF EXISTS mo_update ON meeting_occurrences; CREATE POLICY mo_update ON meeting_occurrences FOR UPDATE TO authenticated USING (can_run_meeting(id)) WITH CHECK (can_run_meeting(id));
DROP POLICY IF EXISTS mo_delete ON meeting_occurrences; CREATE POLICY mo_delete ON meeting_occurrences FOR DELETE TO authenticated USING (is_managing_director());
DROP POLICY IF EXISTS ma_select ON meeting_attendance; CREATE POLICY ma_select ON meeting_attendance FOR SELECT TO authenticated USING (can_see_meeting(occurrence_id));
DROP POLICY IF EXISTS ma_write ON meeting_attendance; CREATE POLICY ma_write ON meeting_attendance FOR ALL TO authenticated USING (can_run_meeting(occurrence_id)) WITH CHECK (can_run_meeting(occurrence_id));
DROP POLICY IF EXISTS mi_select ON meeting_items; CREATE POLICY mi_select ON meeting_items FOR SELECT TO authenticated USING (can_see_meeting(occurrence_id));
DROP POLICY IF EXISTS mi_write ON meeting_items; CREATE POLICY mi_write ON meeting_items FOR ALL TO authenticated USING (can_run_meeting(occurrence_id)) WITH CHECK (can_run_meeting(occurrence_id));
DROP POLICY IF EXISTS msl_select ON meeting_slots; CREATE POLICY msl_select ON meeting_slots FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS msl_write ON meeting_slots; CREATE POLICY msl_write ON meeting_slots FOR ALL TO authenticated USING (is_managing_director()) WITH CHECK (is_managing_director());

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['can_see_meeting(uuid)', 'can_run_meeting(uuid)', 'meeting_occurrence_guard()', 'ensure_meeting_occurrences(date)', 'start_meeting(uuid)', 'end_meeting(uuid, jsonb)', 'book_meeting_slot(uuid)', 'cancel_meeting_slot(uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE meeting_occurrences; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE meeting_attendance; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE meeting_items; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE meeting_slots; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('meeting_recap', 'Meeting recap', 'When a meeting ends: who came, the numbers, the notes, decisions and action items - to everyone who was expected.', 'Instant', ARRAY['md'], 3, 480, 'Meetings', true),
  ('meeting_booked', 'One-to-one booked', 'Tells the host someone booked a slot.', 'Instant', ARRAY['actor'], 3, 481, 'Meetings', true)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------ the regular meetings (MD, 18 Oct 2026)
DO $$
DECLARE
  md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
  rod uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'MUGISHA Rodrigue%' LIMIT 1);
  bex uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Ndekwe Jean Bertrand%' LIMIT 1);
  rug uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Henry Rugaba%' LIMIT 1);
  jan uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Uwera Janviere%' LIMIT 1);
  cto uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'NIYOKWIZERWA Fabrice%' LIMIT 1);
  bap uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Imanariyo Baptiste%' LIMIT 1);
  a record; k int := 0;
  slots time[] := ARRAY['10:00', '10:00', '10:00', '10:00', '10:00', '10:30', '10:30', '10:30', '10:30', '10:30']::time[];
  dayz int[] := ARRAY[1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
BEGIN
  IF EXISTS (SELECT 1 FROM meeting_series) THEN RETURN; END IF;
  INSERT INTO meeting_series (key, name, kind, purpose, days, start_time, duration_min, expected, host_id, note_taker_id, agenda, metrics, created_by) VALUES
    ('fleet_daily', 'Fleet & drivers — money', 'fleet_daily', 'Every franc a car should make, collected: who paid, who did not, cars taken back, replacements, maintenance, fines and accidents.',
     ARRAY[1, 2, 3, 4, 5, 6, 7], '19:00', 45, array_remove(ARRAY[md, rod, bex, rug, jan], NULL), md, md,
     ARRAY['Money: who paid, who did not — cars to take back', 'Drivers who left — replaced the same day?', 'Cars in maintenance and accidents', 'Fines: new today and still unpaid', 'Empty seats for tomorrow', 'Decisions and actions'], 'fleet', md),
    ('it_sync', 'IT team', 'it', 'Progress of the milestones, what is blocked, who has nothing in progress, and what ships next.',
     ARRAY[2, 4, 6], '20:00', 45, array_remove(ARRAY[md, cto, bap, jan], NULL), md, md,
     ARRAY['Since last time: what was done', 'Blocked or stalled', 'Milestones and the next release', 'Priorities until the next meeting', 'Decisions and actions'], 'it', md);
  FOR a IN SELECT p.id, p.full_name FROM profiles p JOIN departments d ON d.id = p.department_id WHERE d.slug = 'call_center' AND p.is_active AND p.role <> 'managing_director' ORDER BY p.full_name LOOP
    k := k + 1;
    EXIT WHEN k > 10;
    INSERT INTO meeting_series (key, name, kind, purpose, days, start_time, duration_min, expected, host_id, note_taker_id, with_profile, agenda, metrics, created_by)
    VALUES ('cc_' || a.id, 'One-to-one: ' || trim(a.full_name), 'one_on_one', 'Weekly one-to-one with a Call Center agent: calls, cases, commission follow-up, what to improve.',
      ARRAY[dayz[k]], slots[k], 30, ARRAY[md, a.id], md, md, a.id,
      ARRAY['Your week: calls and cases', 'Commission follow-up', 'Trips for companies', 'What is hard, what to improve', 'Actions'], 'call_center', md);
  END LOOP;
END $$;
