/*
# Anyone can book a meeting with anyone - and nothing collides (MD, 18 Oct 2026)

- person_available(): inside the person's working hours (host_availability;
  default Mon-Fri 08:00-17:00, Sat 08:00-12:00 when they set none).
- person_busy(): their meetings (not declined), their regular meetings on
  that weekday, their bookings (made or received) and their days off.
- free_times_for(people, minutes): times when the organiser and everyone
  invited are available and free (next 14 days, 30-minute steps).
- schedule_meeting(): re-checks every person at booking time, creates the
  meeting and invites them. decline_meeting() / cancel_meeting() tell the
  others.
- booking_free_times() (the kinds of meetings with the MD) now uses the same
  check for the host AND the person booking.
*/

CREATE OR REPLACE FUNCTION person_available(p uuid, s timestamptz, e timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (SELECT (s AT TIME ZONE 'Africa/Kigali') ls, (e AT TIME ZONE 'Africa/Kigali') le)
  SELECT (SELECT ls::date = le::date FROM l) AND CASE
    WHEN EXISTS (SELECT 1 FROM host_availability WHERE host_id = p) THEN
      EXISTS (SELECT 1 FROM host_availability a, l WHERE a.host_id = p AND a.weekday = extract(isodow FROM l.ls)::int AND l.ls::time >= a.start_time AND l.le::time <= a.end_time)
    ELSE (SELECT CASE WHEN extract(isodow FROM ls) BETWEEN 1 AND 5 THEN ls::time >= '08:00' AND le::time <= '17:00'
                      WHEN extract(isodow FROM ls) = 6 THEN ls::time >= '08:00' AND le::time <= '12:00' ELSE false END FROM l)
  END;
$$;

CREATE OR REPLACE FUNCTION person_busy(p uuid, s timestamptz, e timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (SELECT 1 FROM meeting_occurrences o
      WHERE o.status <> 'cancelled' AND o.scheduled_start IS NOT NULL
        AND (p = ANY (o.expected) OR o.host_id = p OR o.note_taker_id = p OR o.with_profile = p)
        AND NOT EXISTS (SELECT 1 FROM meeting_attendance a WHERE a.occurrence_id = o.id AND a.profile_id = p AND a.status = 'excused')
        AND ((o.day + o.scheduled_start) AT TIME ZONE 'Africa/Kigali') < e
        AND ((o.day + o.scheduled_start + make_interval(mins => o.duration_min)) AT TIME ZONE 'Africa/Kigali') > s)
    OR EXISTS (SELECT 1 FROM meeting_series ms
      WHERE ms.active AND (p = ANY (ms.expected) OR ms.host_id = p OR ms.with_profile = p)
        AND extract(isodow FROM s AT TIME ZONE 'Africa/Kigali')::int = ANY (ms.days)
        AND NOT EXISTS (SELECT 1 FROM meeting_occurrences o WHERE o.series_id = ms.id AND o.day = (s AT TIME ZONE 'Africa/Kigali')::date)
        AND (((s AT TIME ZONE 'Africa/Kigali')::date + ms.start_time) AT TIME ZONE 'Africa/Kigali') < e
        AND (((s AT TIME ZONE 'Africa/Kigali')::date + ms.start_time + make_interval(mins => ms.duration_min)) AT TIME ZONE 'Africa/Kigali') > s)
    OR EXISTS (SELECT 1 FROM bookings b JOIN booking_types t ON t.id = b.type_id
      WHERE b.status IN ('requested', 'confirmed') AND b.occurrence_id IS NULL AND b.series_id IS NULL AND (b.booked_by = p OR t.host_id = p)
        AND b.starts_at < e AND b.starts_at + make_interval(mins => b.duration_min) > s)
    OR EXISTS (SELECT 1 FROM host_blocked hb WHERE hb.host_id = p AND hb.starts_at < e AND hb.ends_at > s);
$$;

CREATE OR REPLACE FUNCTION free_times_for(p_people uuid[], p_minutes int DEFAULT 30, p_days int DEFAULT 14) RETURNS TABLE (starts_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE everyone uuid[] := array_remove(array(SELECT DISTINCT unnest(array_append(COALESCE(p_people, '{}'), auth.uid()))), NULL);
  d date; s timestamp; slot timestamptz; today date := (now() AT TIME ZONE 'Africa/Kigali')::date; dur interval := make_interval(mins => GREATEST(10, LEAST(p_minutes, 240)));
BEGIN
  IF auth.uid() IS NULL OR cardinality(everyone) < 2 THEN RETURN; END IF;
  FOR d IN SELECT generate_series(today, today + LEAST(GREATEST(p_days, 1), 28), interval '1 day')::date LOOP
    s := d + time '07:00';
    WHILE s + dur <= d + time '20:00' LOOP
      slot := s AT TIME ZONE 'Africa/Kigali';
      IF slot > now() + interval '30 minutes'
        AND NOT EXISTS (SELECT 1 FROM unnest(everyone) x WHERE NOT person_available(x, slot, slot + dur) OR person_busy(x, slot, slot + dur)) THEN
        starts_at := slot; RETURN NEXT;
      END IF;
      s := s + interval '30 minutes';
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION schedule_meeting(p_people uuid[], p_starts_at timestamptz, p_minutes int, p_title text, p_agenda text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); everyone uuid[]; v uuid; dur interval := make_interval(mins => GREATEST(10, LEAST(p_minutes, 240))); x uuid; clash text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NULLIF(trim(COALESCE(p_title, '')), '') IS NULL THEN RAISE EXCEPTION 'Say what the meeting is about'; END IF;
  everyone := array_remove(array(SELECT DISTINCT unnest(array_append(COALESCE(p_people, '{}'), me))), NULL);
  IF cardinality(everyone) < 2 THEN RAISE EXCEPTION 'Invite at least one person'; END IF;
  IF p_starts_at < now() THEN RAISE EXCEPTION 'That time has passed'; END IF;
  -- One booking at a time across the company, so two people never take the same time.
  PERFORM pg_advisory_xact_lock(hashtext('kivu_meeting_booking'));
  -- Checked again now: nobody may be double-booked.
  SELECT string_agg(trim(pr.full_name), ', ') INTO clash FROM unnest(everyone) x2 JOIN profiles pr ON pr.id = x2
    WHERE NOT person_available(x2, p_starts_at, p_starts_at + dur) OR person_busy(x2, p_starts_at, p_starts_at + dur);
  IF clash IS NOT NULL THEN RAISE EXCEPTION 'Not free at that time: % - choose another time', clash; END IF;
  INSERT INTO meeting_occurrences (kind, title, day, scheduled_start, duration_min, host_id, note_taker_id, expected, agenda, created_by)
  VALUES ('other', trim(p_title), (p_starts_at AT TIME ZONE 'Africa/Kigali')::date, (p_starts_at AT TIME ZONE 'Africa/Kigali')::time, GREATEST(10, LEAST(p_minutes, 240)), me, me, everyone,
    CASE WHEN NULLIF(trim(COALESCE(p_agenda, '')), '') IS NULL THEN '{}' ELSE string_to_array(trim(p_agenda), E'\n') END, me)
  RETURNING id INTO v;
  INSERT INTO meeting_attendance (occurrence_id, profile_id) SELECT v, unnest(everyone) ON CONFLICT DO NOTHING;
  FOREACH x IN ARRAY everyone LOOP
    IF x <> me THEN INSERT INTO notification_events (rule_key, payload) VALUES ('meeting_invite', jsonb_build_object('occurrence_id', v, 'recipient_id', x, 'actor_id', me)); END IF;
  END LOOP;
  RETURN v;
END $$;

-- An invited person can't make it: they are excused (and free again); the organiser is told.
CREATE OR REPLACE FUNCTION decline_meeting(p_occ uuid, p_reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o meeting_occurrences%ROWTYPE;
BEGIN
  SELECT * INTO o FROM meeting_occurrences WHERE id = p_occ;
  IF NOT FOUND OR NOT (auth.uid() = ANY (o.expected)) THEN RAISE EXCEPTION 'You are not invited to this meeting'; END IF;
  IF o.host_id = auth.uid() THEN RAISE EXCEPTION 'You organised it - cancel it instead'; END IF;
  UPDATE meeting_attendance SET status = 'excused', reason = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'Can''t make it'), marked_at = now() WHERE occurrence_id = p_occ AND profile_id = auth.uid();
  INSERT INTO notification_events (rule_key, payload) VALUES ('meeting_declined', jsonb_build_object('occurrence_id', p_occ, 'recipient_id', o.host_id, 'actor_id', auth.uid(), 'reason', p_reason));
END $$;

CREATE OR REPLACE FUNCTION cancel_meeting(p_occ uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o meeting_occurrences%ROWTYPE; x uuid;
BEGIN
  SELECT * INTO o FROM meeting_occurrences WHERE id = p_occ;
  IF NOT FOUND OR NOT (o.host_id = auth.uid() OR is_managing_director()) THEN RAISE EXCEPTION 'Only the organiser cancels the meeting'; END IF;
  IF o.status <> 'scheduled' THEN RAISE EXCEPTION 'This meeting has already started'; END IF;
  UPDATE meeting_occurrences SET status = 'cancelled' WHERE id = p_occ;
  FOREACH x IN ARRAY o.expected LOOP
    IF x <> auth.uid() THEN INSERT INTO notification_events (rule_key, payload) VALUES ('meeting_cancelled', jsonb_build_object('occurrence_id', p_occ, 'recipient_id', x, 'actor_id', auth.uid())); END IF;
  END LOOP;
END $$;

-- The kinds of meetings with the MD: free for the host AND the person booking.
CREATE OR REPLACE FUNCTION booking_free_times(p_type uuid, p_days int DEFAULT 14) RETURNS TABLE (starts_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t booking_types%ROWTYPE; d date; w record; s timestamp; e timestamp; slot timestamptz; dur interval; today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
BEGIN
  SELECT * INTO t FROM booking_types WHERE id = p_type AND active;
  IF NOT FOUND THEN RETURN; END IF;
  dur := make_interval(mins => t.duration_min);
  FOR d IN SELECT generate_series(today, today + LEAST(GREATEST(p_days, 1), 42), interval '1 day')::date LOOP
    IF t.days IS NOT NULL AND NOT (extract(isodow FROM d)::int = ANY (t.days)) THEN CONTINUE; END IF;
    IF t.deadline IS NOT NULL AND d > t.deadline THEN CONTINUE; END IF;
    IF t.max_per_day IS NOT NULL AND (SELECT count(*) FROM bookings b WHERE b.type_id = t.id AND b.status IN ('requested', 'confirmed') AND b.booked_by <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
        AND CASE WHEN t.kind = 'weekly' THEN extract(isodow FROM b.starts_at AT TIME ZONE 'Africa/Kigali') = extract(isodow FROM d)
                 ELSE (b.starts_at AT TIME ZONE 'Africa/Kigali')::date = d END) >= t.max_per_day THEN CONTINUE; END IF;
    FOR w IN
      SELECT t.window_start AS ws, t.window_end AS we WHERE t.window_start IS NOT NULL
      UNION ALL SELECT a.start_time, a.end_time FROM host_availability a WHERE t.window_start IS NULL AND a.host_id = t.host_id AND a.weekday = extract(isodow FROM d)::int
    LOOP
      s := d + w.ws; e := d + w.we;
      WHILE s + dur <= e LOOP
        slot := s AT TIME ZONE 'Africa/Kigali';
        IF slot > now() + interval '30 minutes'
          AND NOT person_busy(t.host_id, slot, slot + dur)
          AND (auth.uid() IS NULL OR auth.uid() = t.host_id OR NOT person_busy(auth.uid(), slot, slot + dur))
          -- A weekly slot also needs to stay free on that weekday later on.
          AND (t.kind <> 'weekly' OR NOT person_busy(t.host_id, slot + interval '7 days', slot + interval '7 days' + dur))
        THEN starts_at := slot; RETURN NEXT; END IF;
        s := s + interval '30 minutes';
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- Booking with the MD: the same lock.
CREATE OR REPLACE FUNCTION book_meeting(p_type uuid, p_starts_at timestamptz, p_topic text DEFAULT NULL, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t booking_types%ROWTYPE; v uuid; me uuid := auth.uid(); old uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO t FROM booking_types WHERE id = p_type;
  IF NOT FOUND OR NOT can_book_type(p_type) THEN RAISE EXCEPTION 'You cannot book this kind of meeting'; END IF;
  IF t.topic_required AND NULLIF(trim(COALESCE(p_topic, '')), '') IS NULL THEN RAISE EXCEPTION 'Say what the meeting is about'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kivu_meeting_booking'));
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

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['person_available(uuid, timestamptz, timestamptz)', 'person_busy(uuid, timestamptz, timestamptz)', 'free_times_for(uuid[], int, int)',
    'schedule_meeting(uuid[], timestamptz, int, text, text)', 'decline_meeting(uuid, text)', 'cancel_meeting(uuid)', 'booking_free_times(uuid, int)', 'book_meeting(uuid, timestamptz, text, text)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('meeting_invite', 'Meeting invitation', 'Someone scheduled a meeting with you: when, with whom, about what.', 'Instant', ARRAY['actor'], 3, 486, 'Meetings', true),
  ('meeting_declined', 'Invitation declined', 'Tells the organiser someone can''t make it, and why.', 'Instant', ARRAY['actor'], 3, 487, 'Meetings', true),
  ('meeting_cancelled', 'Meeting cancelled', 'Tells the people invited that the organiser cancelled the meeting.', 'Instant', ARRAY['actor'], 3, 488, 'Meetings', true)
ON CONFLICT (key) DO NOTHING;
