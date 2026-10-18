/*
# Booking meetings with the MD, organised (MD, 18 Oct 2026)

- host_availability: when the host (the MD) can meet, per weekday.
- host_blocked: days or hours the host is not available.
- booking_types: what people can book - duration, who may book (everyone or
  some departments), once per person or not, weekly (becomes a regular
  meeting) or one-off, needs the host's approval or not, its own window
  and days, how many per day, a deadline.
- bookings: each booking or request.
Free times are worked out by booking_free_times(): the availability (or the
type's own window), minus the host's meetings and other bookings, blocked
times, full days and the past. Seeded types:
  1. New Kivu Daily walkthrough - 30 min, once per person, everyone, by 31 Oct
  2. Call Center weekly one-to-one - each agent chooses their own day
     (one agent a day, Mon-Sat, 10:00-13:00); it becomes their weekly meeting
  3. Meeting with the MD - anyone, with a topic; the MD accepts or declines
*/

CREATE TABLE IF NOT EXISTS host_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  weekday int NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time)
);
CREATE TABLE IF NOT EXISTS host_blocked (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  reason text
);
CREATE TABLE IF NOT EXISTS booking_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE,
  name text NOT NULL,
  description text,
  host_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  duration_min int NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 10 AND 240),
  audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'departments')),
  departments text[] NOT NULL DEFAULT '{}',
  kind text NOT NULL DEFAULT 'one_off' CHECK (kind IN ('one_off', 'weekly')),
  once_per_person boolean NOT NULL DEFAULT false,
  needs_approval boolean NOT NULL DEFAULT false,
  topic_required boolean NOT NULL DEFAULT false,
  max_per_day int,
  window_start time,
  window_end time,
  days int[],
  deadline date,
  agenda text[] NOT NULL DEFAULT '{}',
  metrics text CHECK (metrics IN ('fleet', 'it', 'call_center')),
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL REFERENCES booking_types(id) ON DELETE CASCADE,
  booked_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  duration_min int NOT NULL,
  topic text,
  notes text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled')),
  occurrence_id uuid REFERENCES meeting_occurrences(id) ON DELETE SET NULL,
  series_id uuid REFERENCES meeting_series(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_time ON bookings (starts_at);

-- May this person book this type?
CREATE OR REPLACE FUNCTION can_book_type(p_type uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM booking_types t WHERE t.id = p_type AND t.active AND t.host_id <> auth.uid()
    AND (t.audience = 'everyone' OR current_department_slug() = ANY (t.departments)));
$$;

-- Free start times for a type over the next days (Kigali time).
CREATE OR REPLACE FUNCTION booking_free_times(p_type uuid, p_days int DEFAULT 14) RETURNS TABLE (starts_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t booking_types%ROWTYPE; d date; w record; s timestamp; e timestamp; slot timestamptz; today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
BEGIN
  SELECT * INTO t FROM booking_types WHERE id = p_type AND active;
  IF NOT FOUND THEN RETURN; END IF;
  FOR d IN SELECT generate_series(today, today + LEAST(GREATEST(p_days, 1), 42), interval '1 day')::date LOOP
    IF t.days IS NOT NULL AND NOT (extract(isodow FROM d)::int = ANY (t.days)) THEN CONTINUE; END IF;
    IF t.deadline IS NOT NULL AND d > t.deadline THEN CONTINUE; END IF;
    -- Full days: one-off bookings on that date; weekly ones on that weekday (they repeat).
    IF t.max_per_day IS NOT NULL AND (SELECT count(*) FROM bookings b WHERE b.type_id = t.id AND b.status IN ('requested', 'confirmed') AND b.booked_by <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
        AND CASE WHEN t.kind = 'weekly' THEN extract(isodow FROM b.starts_at AT TIME ZONE 'Africa/Kigali') = extract(isodow FROM d)
                 ELSE (b.starts_at AT TIME ZONE 'Africa/Kigali')::date = d END) >= t.max_per_day THEN CONTINUE; END IF;
    FOR w IN
      SELECT t.window_start AS ws, t.window_end AS we WHERE t.window_start IS NOT NULL
      UNION ALL SELECT a.start_time, a.end_time FROM host_availability a WHERE t.window_start IS NULL AND a.host_id = t.host_id AND a.weekday = extract(isodow FROM d)::int
    LOOP
      s := d + w.ws; e := d + w.we;
      WHILE s + make_interval(mins => t.duration_min) <= e LOOP
        slot := s AT TIME ZONE 'Africa/Kigali';
        IF slot > now() + interval '30 minutes'
          AND NOT EXISTS (SELECT 1 FROM host_blocked hb WHERE hb.host_id = t.host_id AND hb.starts_at < slot + make_interval(mins => t.duration_min) AND hb.ends_at > slot)
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.status IN ('requested', 'confirmed') AND b.starts_at < slot + make_interval(mins => t.duration_min) AND b.starts_at + make_interval(mins => b.duration_min) > slot
                            AND EXISTS (SELECT 1 FROM booking_types bt WHERE bt.id = b.type_id AND bt.host_id = t.host_id))
          AND NOT EXISTS (SELECT 1 FROM meeting_occurrences o WHERE o.day = d AND o.status <> 'cancelled' AND o.scheduled_start IS NOT NULL
                            AND (t.host_id = ANY (o.expected) OR o.host_id = t.host_id)
                            AND (d + o.scheduled_start) < s + make_interval(mins => t.duration_min) AND (d + o.scheduled_start + make_interval(mins => o.duration_min)) > s)
          AND NOT EXISTS (SELECT 1 FROM meeting_series ms WHERE ms.active AND (t.host_id = ANY (ms.expected) OR ms.host_id = t.host_id) AND extract(isodow FROM d)::int = ANY (ms.days)
                            AND (d + ms.start_time) < s + make_interval(mins => t.duration_min) AND (d + ms.start_time + make_interval(mins => ms.duration_min)) > s)
        THEN
          starts_at := slot; RETURN NEXT;
        END IF;
        s := s + interval '30 minutes';
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- The meeting a confirmed booking becomes.
CREATE OR REPLACE FUNCTION booking_to_meeting(p_booking uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b bookings%ROWTYPE; t booking_types%ROWTYPE; nm text; dept text; v uuid; sid uuid; local timestamp;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking;
  SELECT * INTO t FROM booking_types WHERE id = b.type_id;
  SELECT trim(p.full_name), d.slug INTO nm, dept FROM profiles p LEFT JOIN departments d ON d.id = p.department_id WHERE p.id = b.booked_by;
  local := b.starts_at AT TIME ZONE 'Africa/Kigali';
  IF t.kind = 'weekly' THEN
    -- One regular meeting per person and type: update it, or create it.
    SELECT id INTO sid FROM meeting_series WHERE with_profile = b.booked_by AND key = 'bt_' || t.id || '_' || b.booked_by;
    IF sid IS NULL THEN
      UPDATE meeting_series SET active = false WHERE with_profile = b.booked_by AND kind = 'one_on_one' AND key LIKE 'cc_%';
      INSERT INTO meeting_series (key, name, kind, purpose, days, start_time, duration_min, expected, host_id, note_taker_id, with_profile, agenda, metrics, created_by)
      VALUES ('bt_' || t.id || '_' || b.booked_by, 'One-to-one: ' || nm, 'one_on_one', t.description, ARRAY[extract(isodow FROM local)::int], local::time, t.duration_min,
        ARRAY[t.host_id, b.booked_by], t.host_id, t.host_id, b.booked_by, t.agenda, t.metrics, b.booked_by) RETURNING id INTO sid;
    ELSE
      UPDATE meeting_series SET days = ARRAY[extract(isodow FROM local)::int], start_time = local::time, active = true, updated_at = now() WHERE id = sid;
    END IF;
    -- Meetings already created for the old day give way to the new choice.
    DELETE FROM meeting_occurrences WHERE series_id = sid AND status = 'scheduled' AND day >= (now() AT TIME ZONE 'Africa/Kigali')::date;
    UPDATE bookings SET series_id = sid WHERE id = b.id;
    PERFORM ensure_meeting_occurrences(local::date);
  ELSE
    INSERT INTO meeting_occurrences (kind, title, day, scheduled_start, duration_min, host_id, note_taker_id, with_profile, expected, agenda, created_by)
    VALUES (CASE WHEN t.key = 'walkthrough' THEN 'onboarding' ELSE 'one_on_one' END, t.name || ' — ' || nm, local::date, local::time, b.duration_min, t.host_id, t.host_id, b.booked_by,
      ARRAY[t.host_id, b.booked_by], CASE WHEN b.topic IS NOT NULL THEN array_prepend('Topic: ' || b.topic, t.agenda) ELSE t.agenda END, b.booked_by)
    RETURNING id INTO v;
    INSERT INTO meeting_attendance (occurrence_id, profile_id) VALUES (v, t.host_id), (v, b.booked_by) ON CONFLICT DO NOTHING;
    IF t.key = 'walkthrough' THEN
      INSERT INTO meeting_items (occurrence_id, kind, text, sort, created_by) SELECT v, 'check', x, row_number() OVER (), t.host_id FROM unnest(CASE dept
        WHEN 'fleet' THEN ARRAY['Deposits: the Sunday rule, Monday is late, next payment on every driver', 'Taking a car back and recording it', 'Same-day replacement and freelance drivers', 'Fines, accidents and cars in the garage', 'The daily 19:00 meeting and Cars: should vs did']
        WHEN 'call_center' THEN ARRAY['Cases and calls: what to record on every call', 'Commission follow-up: the daily list, recording the outcome', 'Trips for companies', 'Your weekly one-to-one']
        WHEN 'finance' THEN ARRAY['Ledger: linking expenses to budgets and IT projects', 'Confirming freelance and deposit payments', 'Cash balances on the Money page', 'Budget approvals and the monthly review']
        WHEN 'it' THEN ARRAY['Issues, milestones and check-ins', 'Releases and the weekly review', 'Health page and AI help', 'The IT meeting Tue/Thu/Sat 20:00']
        ELSE ARRAY['Your home page and tasks', 'What you must record, and when', 'Meetings: booking and actions'] END) x;
    END IF;
    UPDATE bookings SET occurrence_id = v WHERE id = b.id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION book_meeting(p_type uuid, p_starts_at timestamptz, p_topic text DEFAULT NULL, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t booking_types%ROWTYPE; v uuid; me uuid := auth.uid(); old uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO t FROM booking_types WHERE id = p_type;
  IF NOT FOUND OR NOT can_book_type(p_type) THEN RAISE EXCEPTION 'You cannot book this kind of meeting'; END IF;
  IF t.topic_required AND NULLIF(trim(COALESCE(p_topic, '')), '') IS NULL THEN RAISE EXCEPTION 'Say what the meeting is about'; END IF;
  IF NOT EXISTS (SELECT 1 FROM booking_free_times(p_type, 42) f WHERE f.starts_at = p_starts_at) THEN RAISE EXCEPTION 'That time is no longer free - choose another one'; END IF;
  -- Once per person (and one weekly slot): a new choice replaces the old one.
  IF t.once_per_person OR t.kind = 'weekly' THEN
    IF t.kind = 'one_off' AND EXISTS (SELECT 1 FROM bookings b JOIN meeting_occurrences o ON o.id = b.occurrence_id WHERE b.type_id = p_type AND b.booked_by = me AND o.status = 'done') THEN
      RAISE EXCEPTION 'You already had this meeting';
    END IF;
    SELECT id INTO old FROM bookings WHERE type_id = p_type AND booked_by = me AND status IN ('requested', 'confirmed') ORDER BY created_at DESC LIMIT 1;
    IF old IS NOT NULL THEN PERFORM cancel_booking(old); END IF;
  END IF;
  INSERT INTO bookings (type_id, booked_by, starts_at, duration_min, topic, notes, status)
  VALUES (p_type, me, p_starts_at, t.duration_min, NULLIF(trim(COALESCE(p_topic, '')), ''), NULLIF(trim(COALESCE(p_notes, '')), ''), CASE WHEN t.needs_approval THEN 'requested' ELSE 'confirmed' END)
  RETURNING id INTO v;
  IF NOT t.needs_approval THEN PERFORM booking_to_meeting(v); END IF;
  INSERT INTO notification_events (rule_key, payload) VALUES ('booking_made', jsonb_build_object('booking_id', v, 'actor_id', me, 'recipient_id', t.host_id));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION decide_booking(p_id uuid, p_accept boolean, p_note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b bookings%ROWTYPE; t booking_types%ROWTYPE;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_id FOR UPDATE;
  SELECT * INTO t FROM booking_types WHERE id = b.type_id;
  IF NOT (is_managing_director() OR t.host_id = auth.uid()) THEN RAISE EXCEPTION 'Only the host decides'; END IF;
  IF b.status <> 'requested' THEN RAISE EXCEPTION 'Already %', b.status; END IF;
  UPDATE bookings SET status = CASE WHEN p_accept THEN 'confirmed' ELSE 'declined' END, decided_by = auth.uid(), decided_at = now(), decision_note = NULLIF(trim(COALESCE(p_note, '')), '') WHERE id = p_id;
  IF p_accept THEN PERFORM booking_to_meeting(p_id); END IF;
  INSERT INTO notification_events (rule_key, payload) VALUES ('booking_decided', jsonb_build_object('booking_id', p_id, 'accepted', p_accept, 'actor_id', auth.uid(), 'recipient_id', b.booked_by));
END $$;

CREATE OR REPLACE FUNCTION cancel_booking(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b bookings%ROWTYPE; t booking_types%ROWTYPE;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO t FROM booking_types WHERE id = b.type_id;
  IF NOT (b.booked_by = auth.uid() OR is_managing_director() OR t.host_id = auth.uid()) THEN RAISE EXCEPTION 'Not your booking'; END IF;
  UPDATE bookings SET status = 'cancelled' WHERE id = p_id AND status IN ('requested', 'confirmed');
  IF b.occurrence_id IS NOT NULL THEN DELETE FROM meeting_occurrences WHERE id = b.occurrence_id AND status = 'scheduled'; END IF;
  IF b.series_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bookings x WHERE x.series_id = b.series_id AND x.status = 'confirmed' AND x.id <> b.id) THEN
    UPDATE meeting_series SET active = false WHERE id = b.series_id;
    DELETE FROM meeting_occurrences WHERE series_id = b.series_id AND status = 'scheduled' AND day >= (now() AT TIME ZONE 'Africa/Kigali')::date;
  END IF;
END $$;

-- ------------------------------------------------------------ access
ALTER TABLE host_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE host_blocked ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ha_select ON host_availability; CREATE POLICY ha_select ON host_availability FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ha_write ON host_availability; CREATE POLICY ha_write ON host_availability FOR ALL TO authenticated USING (host_id = auth.uid() OR is_managing_director()) WITH CHECK (host_id = auth.uid() OR is_managing_director());
DROP POLICY IF EXISTS hb_select ON host_blocked; CREATE POLICY hb_select ON host_blocked FOR SELECT TO authenticated USING (host_id = auth.uid() OR is_managing_director());
DROP POLICY IF EXISTS hb_write ON host_blocked; CREATE POLICY hb_write ON host_blocked FOR ALL TO authenticated USING (host_id = auth.uid() OR is_managing_director()) WITH CHECK (host_id = auth.uid() OR is_managing_director());
DROP POLICY IF EXISTS bt_select ON booking_types; CREATE POLICY bt_select ON booking_types FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS bt_write ON booking_types; CREATE POLICY bt_write ON booking_types FOR ALL TO authenticated USING (is_managing_director()) WITH CHECK (is_managing_director());
DROP POLICY IF EXISTS bk_select ON bookings; CREATE POLICY bk_select ON bookings FOR SELECT TO authenticated
  USING (booked_by = auth.uid() OR is_managing_director() OR EXISTS (SELECT 1 FROM booking_types t WHERE t.id = type_id AND t.host_id = auth.uid()));
-- Bookings change only through book / decide / cancel.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['can_book_type(uuid)', 'booking_free_times(uuid, int)', 'booking_to_meeting(uuid)', 'book_meeting(uuid, timestamptz, text, text)', 'decide_booking(uuid, boolean, text)', 'cancel_booking(uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION booking_to_meeting(uuid) FROM authenticated;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE bookings; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('booking_made', 'Meeting booked or requested', 'Tells the host (the MD) someone booked a meeting, or asks to accept a request.', 'Instant', ARRAY['actor'], 3, 483, 'Meetings', true),
  ('booking_decided', 'Meeting request answered', 'Tells the person whether the MD accepted their meeting request.', 'Instant', ARRAY['actor'], 3, 484, 'Meetings', true),
  ('booking_reminder', 'Book your meeting', 'Weekdays 08:30: reminds people who still have to book a required meeting (the walkthrough, the weekly one-to-one) before its deadline.', 'Mon-Sat 08:30', ARRAY['employees'], 3, 485, 'Meetings', true)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------ the MD's availability and the three kinds of booking
DO $$
DECLARE md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
BEGIN
  IF EXISTS (SELECT 1 FROM booking_types) THEN RETURN; END IF;
  INSERT INTO host_availability (host_id, weekday, start_time, end_time)
  SELECT md, d, x.s, x.e FROM generate_series(1, 5) d, (VALUES ('09:00'::time, '12:00'::time), ('14:00'::time, '17:00'::time)) x(s, e)
  UNION ALL SELECT md, 6, '09:00', '12:00';
  INSERT INTO booking_types (key, name, description, host_id, duration_min, audience, kind, once_per_person, needs_approval, topic_required, deadline, agenda, sort, created_by) VALUES
    ('walkthrough', 'New Kivu Daily: your walkthrough', 'Thirty minutes with the MD on your dashboard, the new way of working, what you must record and what to focus on. Everyone books one.',
     md, 30, 'everyone', 'one_off', true, false, false, '2026-10-31', ARRAY['Your dashboard and the new way of working', 'What you must record, and when', 'What to focus on', 'Questions'], 1, md);
  INSERT INTO booking_types (key, name, description, host_id, duration_min, audience, departments, kind, once_per_person, needs_approval, max_per_day, window_start, window_end, days, agenda, metrics, sort, created_by) VALUES
    ('cc_weekly', 'Your weekly one-to-one (Call Center)', 'Choose your day: every week, 30 minutes with the MD on your calls, cases and commission follow-up. One agent per day.',
     md, 30, 'departments', ARRAY['call_center'], 'weekly', true, false, 1, '10:00', '13:00', ARRAY[1, 2, 3, 4, 5, 6],
     ARRAY['Your week: calls and cases', 'Commission follow-up', 'Trips for companies', 'What is hard, what to improve', 'Actions'], 'call_center', 2, md);
  INSERT INTO booking_types (key, name, description, host_id, duration_min, audience, kind, once_per_person, needs_approval, topic_required, agenda, sort, created_by) VALUES
    ('ask_md', 'Meeting with the MD', 'Ask for 30 minutes with the MD about anything - an idea, a problem, a decision you need. Say what it is about; the MD accepts or proposes another time.',
     md, 30, 'everyone', 'one_off', false, true, true, ARRAY['Decisions and actions'], 3, md);
  -- Agents now choose their own day: the days set by default stop, nothing was held yet.
  DELETE FROM meeting_occurrences o USING meeting_series s WHERE o.series_id = s.id AND s.key LIKE 'cc_%' AND o.status = 'scheduled';
  UPDATE meeting_series SET active = false WHERE key LIKE 'cc_%';
END $$;
