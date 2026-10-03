/*
# Call Center Script Book + the book's case flow

Confirmed with the operator, built from the Kivu Ride Call Center Script
Book (v1.0, October 2026).

## Script Book
script_cards: one card per situation in the book - what to say, what to
do, what to collect, and which department owns it. Agents read them on
the Script Book page and beside the New call form (picking a situation
pre-selects the owner). Only the MD edits them, so book v1.1 is a data
update, not a code change. Seeded in the next migration.

## Routing by department, not by name
The book routes cases to departments. Each department is a duty in
responsibilities (MD Panel -> Who's in charge), so changing who handles
IT or Finance is one dropdown: route_operations, route_it,
route_finance, fleet_manager (exists), route_corporate, route_bizdev,
route_md. Corporate Accounts and Business Development go to the MD
until someone is hired.

## Case fields from the book (13A)
channel, situation, trip reference, vehicle plate, Non-Insider driver
link, actions already taken, promised update time (default +2h),
driver verification, emergency details, quick outcomes (bookings,
abusive call ended), call-back time, caller satisfaction.

## The two-hour standard
first_response_at records the owner's first action. A case with no
response two hours after it was assigned is "response overdue" - the
engine emails the owner and the MD once (response_overdue_notified_at).

## Emergencies
Priority 'emergency' alerts the MD and the Fleet Manager instantly,
can't be logged as solved on the call (the record stays open), and
can't be closed until the MD has acknowledged it.

## Fleet sees caller cases about drivers
Fleet can read tickets linked to a driver (internal or Non-Insider), so
complaints show on driver profiles. They can't change them.
*/

-- ============================================================
-- Department duties
-- ============================================================
INSERT INTO responsibilities (key, label, description, profile_id) VALUES
  ('route_operations', 'Dispatch / Operations', 'Driver conduct, pickup coordination, driver availability, prospective drivers and day-to-day trip operations.',
    (SELECT id FROM profiles WHERE lower(trim(full_name)) = 'henry rugaba mark' AND is_active LIMIT 1)),
  ('route_it', 'IT', 'Login, app, trip status, route/fare calculation, wallet display, payment status and Smart Account technical issues.',
    (SELECT id FROM profiles WHERE lower(trim(full_name)) = 'imanariyo baptiste' AND is_active LIMIT 1)),
  ('route_finance', 'Finance', 'Refund approval, financial verification, duplicate payments, owner earnings questions and reconciliation.',
    (SELECT id FROM profiles WHERE lower(trim(full_name)) = 'mugisha rodrigue' AND is_active LIMIT 1)),
  ('route_corporate', 'Corporate Accounts', 'Smart Account onboarding, service arrangements and non-technical account support.',
    (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1)),
  ('route_bizdev', 'Business Development', 'New partnerships, hotels, events, organisations and fleet-owner leads.',
    (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1)),
  ('route_md', 'Managing Director', 'Emergencies, serious complaints, unclear ownership, government/media and high-risk escalation.',
    (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1))
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Script cards
-- ============================================================
CREATE TABLE IF NOT EXISTS script_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL,
  section_title text NOT NULL,
  section_order int NOT NULL DEFAULT 0,
  card_order int NOT NULL DEFAULT 0,
  situation text NOT NULL,
  say text,
  steps text[] NOT NULL DEFAULT '{}',
  collect text[] NOT NULL DEFAULT '{}',
  owner_duty text,
  default_priority text NOT NULL DEFAULT 'normal' CHECK (default_priority IN ('normal', 'urgent', 'emergency')),
  is_quick boolean NOT NULL DEFAULT false,
  approved boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS script_cards_section_idx ON script_cards (section_order, card_order);
ALTER TABLE script_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "script_cards_select" ON script_cards;
CREATE POLICY "script_cards_select" ON script_cards FOR SELECT TO authenticated USING (approved OR is_managing_director());
DROP POLICY IF EXISTS "script_cards_md_write" ON script_cards;
CREATE POLICY "script_cards_md_write" ON script_cards FOR ALL TO authenticated
  USING (is_managing_director()) WITH CHECK (is_managing_director());

-- ============================================================
-- Case fields
-- ============================================================
ALTER TABLE call_tickets DROP CONSTRAINT IF EXISTS call_tickets_category_check;
ALTER TABLE call_tickets ADD CONSTRAINT call_tickets_category_check CHECK (category IN (
  'booking', 'fares_payments', 'before_pickup', 'during_trip', 'lost_property', 'complaint', 'emergency',
  'driver_support', 'fleet_partner', 'smart_account', 'general',
  'app', 'payment', 'trip', 'driver_behaviour', 'lost_item', 'other'));

ALTER TABLE call_tickets DROP CONSTRAINT IF EXISTS call_tickets_caller_type_check;
ALTER TABLE call_tickets ADD CONSTRAINT call_tickets_caller_type_check CHECK (caller_type IN (
  'passenger', 'driver', 'car_owner', 'partner', 'smart_account', 'prospective_driver', 'organization', 'government_media', 'other'));

ALTER TABLE call_tickets DROP CONSTRAINT IF EXISTS call_tickets_priority_check;
ALTER TABLE call_tickets ADD CONSTRAINT call_tickets_priority_check CHECK (priority IN ('normal', 'urgent', 'emergency'));

ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'call' CHECK (channel IN ('call', 'whatsapp', 'sms', 'web'));
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS script_card_id uuid REFERENCES script_cards(id) ON DELETE SET NULL;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS situation text;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS trip_reference text;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS vehicle_plate text;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS platform_driver_id uuid REFERENCES platform_drivers(id) ON DELETE SET NULL;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS actions_taken text;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS promised_update_at timestamptz;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS first_response_at timestamptz;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS response_overdue_notified_at timestamptz;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS callback_at timestamptz;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS satisfaction text CHECK (satisfaction IN ('happy', 'neutral', 'unhappy'));
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS driver_verified boolean;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS emergency_details jsonb;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS outcome_kind text CHECK (outcome_kind IN ('booking_dispatched', 'booking_declined_wait', 'booking_no_driver', 'abusive_ended', 'info_given'));
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS md_acknowledged_at timestamptz;
ALTER TABLE call_tickets ADD COLUMN IF NOT EXISTS md_acknowledged_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS call_tickets_phone_idx ON call_tickets (right(regexp_replace(caller_phone, '\D', '', 'g'), 9));
CREATE INDEX IF NOT EXISTS call_tickets_driver_idx ON call_tickets (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS call_tickets_platform_driver_idx ON call_tickets (platform_driver_id) WHERE platform_driver_id IS NOT NULL;

UPDATE call_tickets SET assigned_at = created_at WHERE assigned_at IS NULL AND NOT resolved_on_call;

ALTER TABLE call_ticket_updates DROP CONSTRAINT IF EXISTS call_ticket_updates_kind_check;
ALTER TABLE call_ticket_updates ADD CONSTRAINT call_ticket_updates_kind_check CHECK (kind IN (
  'created', 'note', 'status', 'reassigned', 'resolved', 'closed', 'reopened', 'acknowledged', 'callback'));

-- Fleet also sees caller cases linked to a driver.
CREATE OR REPLACE FUNCTION can_view_call_ticket(p_ticket_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director()
      OR current_department_slug() = 'call_center'
      OR EXISTS (SELECT 1 FROM call_tickets t WHERE t.id = p_ticket_id AND t.assignee_id = auth.uid())
      OR (current_department_slug() = 'fleet' AND EXISTS (
            SELECT 1 FROM call_tickets t WHERE t.id = p_ticket_id AND (t.driver_id IS NOT NULL OR t.platform_driver_id IS NOT NULL)))
      OR EXISTS (
        SELECT 1 FROM call_ticket_updates u
        WHERE u.ticket_id = p_ticket_id
          AND (u.author_id = auth.uid() OR u.from_assignee = auth.uid() OR u.to_assignee = auth.uid())
      );
$$;

-- ============================================================
-- Create (all fields in one jsonb so the form can grow)
-- ============================================================
DROP FUNCTION IF EXISTS create_call_ticket(text, text, text, text, uuid, text, text, text, boolean, text, uuid);

CREATE OR REPLACE FUNCTION create_call_ticket(p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ym text := to_char(now() AT TIME ZONE 'Africa/Kigali', 'YYYY-MM');
  v_seq int;
  v_ref text;
  v_id uuid;
  v_cc_dept uuid;
  v_outcome text := NULLIF(p->>'outcome_kind', '');
  v_priority text := COALESCE(NULLIF(p->>'priority', ''), 'normal');
  v_resolved boolean := COALESCE((p->>'resolved_on_call')::boolean, false) OR v_outcome IS NOT NULL;
  v_assignee uuid := NULLIF(p->>'assignee_id', '')::uuid;
  v_name text := NULLIF(trim(p->>'caller_name'), '');
  v_details text := NULLIF(trim(p->>'details'), '');
  v_resolution text := NULLIF(trim(p->>'resolution_note'), '');
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() = 'call_center') THEN
    RAISE EXCEPTION 'Only the Call Center or the MD can log a call';
  END IF;
  IF NULLIF(trim(p->>'caller_phone'), '') IS NULL THEN RAISE EXCEPTION 'The caller''s phone number is required'; END IF;

  IF v_outcome IS NOT NULL THEN
    v_name := COALESCE(v_name, 'Unknown caller');
    v_resolution := COALESCE(v_resolution, CASE v_outcome
      WHEN 'booking_dispatched' THEN 'Booking dispatched and confirmed with the driver'
      WHEN 'booking_declined_wait' THEN 'Passenger declined the available wait time'
      WHEN 'booking_no_driver' THEN 'No driver available'
      WHEN 'abusive_ended' THEN 'Call ended after one warning for abusive language'
      ELSE 'Information given' END);
    v_details := COALESCE(v_details, v_resolution);
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'The caller''s name is required'; END IF;
  IF v_details IS NULL THEN RAISE EXCEPTION 'Describe what the caller said'; END IF;

  IF v_priority = 'emergency' AND v_resolved THEN
    RAISE EXCEPTION 'An emergency stays open - assign it so it is followed up';
  END IF;
  IF v_resolved THEN
    IF v_resolution IS NULL THEN RAISE EXCEPTION 'Say how you resolved it'; END IF;
  ELSIF v_assignee IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_assignee AND is_active) THEN
    RAISE EXCEPTION 'Choose an active person to assign this to';
  END IF;

  INSERT INTO call_ticket_counters (year_month, next_seq) VALUES (v_ym, 2)
  ON CONFLICT (year_month) DO UPDATE SET next_seq = call_ticket_counters.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;
  v_ref := 'CC-' || v_ym || '-' || lpad(v_seq::text, 3, '0');

  INSERT INTO call_tickets (
    reference, caller_name, caller_phone, caller_email, caller_type, channel, driver_id, platform_driver_id, vehicle_plate,
    trip_reference, script_card_id, situation, category, priority, details, actions_taken, driver_verified, emergency_details,
    outcome_kind, status, resolved_on_call, assignee_id, assigned_at, created_by, promised_update_at,
    resolution_note, resolved_at, resolved_by, closed_at, closed_by
  ) VALUES (
    v_ref, v_name, trim(p->>'caller_phone'), NULLIF(trim(p->>'caller_email'), ''), COALESCE(NULLIF(p->>'caller_type', ''), 'passenger'),
    COALESCE(NULLIF(p->>'channel', ''), 'call'), NULLIF(p->>'driver_id', '')::uuid, NULLIF(p->>'platform_driver_id', '')::uuid,
    NULLIF(upper(trim(p->>'vehicle_plate')), ''), NULLIF(trim(p->>'trip_reference'), ''), NULLIF(p->>'script_card_id', '')::uuid,
    NULLIF(trim(p->>'situation'), ''), COALESCE(NULLIF(p->>'category', ''), 'general'), v_priority, v_details,
    NULLIF(trim(p->>'actions_taken'), ''), (p->>'driver_verified')::boolean,
    CASE WHEN p ? 'emergency_details' AND jsonb_typeof(p->'emergency_details') = 'object' THEN p->'emergency_details' END,
    v_outcome,
    CASE WHEN v_resolved THEN 'closed' ELSE 'open' END,
    v_resolved,
    CASE WHEN v_resolved THEN v_uid ELSE v_assignee END,
    CASE WHEN v_resolved THEN NULL ELSE now() END,
    v_uid,
    CASE WHEN v_resolved THEN NULL ELSE COALESCE(NULLIF(p->>'promised_update_at', '')::timestamptz, now() + interval '2 hours') END,
    CASE WHEN v_resolved THEN v_resolution END,
    CASE WHEN v_resolved THEN now() END,
    CASE WHEN v_resolved THEN v_uid END,
    CASE WHEN v_resolved THEN now() END,
    CASE WHEN v_resolved THEN v_uid END
  ) RETURNING id INTO v_id;

  IF v_resolved THEN
    INSERT INTO call_ticket_updates (ticket_id, author_id, kind, body, to_status) VALUES (v_id, v_uid, 'resolved', v_resolution, 'closed');
  ELSE
    INSERT INTO call_ticket_updates (ticket_id, author_id, kind, to_status, to_assignee) VALUES (v_id, v_uid, 'created', 'open', v_assignee);
    IF v_assignee <> v_uid THEN
      INSERT INTO notification_events (rule_key, payload)
      VALUES ('ticket_assigned', jsonb_build_object('ticket_id', v_id, 'recipient_id', v_assignee, 'actor_id', v_uid, 'reason', 'new'));
    END IF;
    IF v_priority = 'emergency' THEN
      INSERT INTO notification_events (rule_key, payload) VALUES ('ticket_emergency', jsonb_build_object('ticket_id', v_id, 'actor_id', v_uid));
    END IF;
  END IF;

  SELECT id INTO v_cc_dept FROM departments WHERE slug = 'call_center';
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (v_uid, v_cc_dept,
    CASE WHEN v_priority = 'emergency' THEN 'logged an EMERGENCY call'
         WHEN v_resolved THEN 'resolved a call on the spot'
         ELSE 'logged a call and assigned it to ' || COALESCE((SELECT full_name FROM profiles WHERE id = v_assignee), 'someone') END,
    'call_ticket', v_id, v_ref);

  RETURN json_build_object('id', v_id, 'reference', v_ref);
END;
$$;
GRANT EXECUTE ON FUNCTION create_call_ticket(jsonb) TO authenticated;

-- ============================================================
-- Actions (adds acknowledge, set_callback; satisfaction on close)
-- ============================================================
DROP FUNCTION IF EXISTS call_ticket_action(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION call_ticket_action(p_ticket_id uuid, p_action text, p_note text DEFAULT NULL, p_assignee_id uuid DEFAULT NULL, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  t call_tickets%ROWTYPE;
  v_md boolean := is_managing_director();
  v_cc boolean := current_department_slug() = 'call_center';
  v_mine boolean;
  v_note text := NULLIF(trim(p_note), '');
  v_to text;
  v_kind text;
  v_notify uuid;
  v_callback timestamptz;
  v_satisfaction text := NULLIF(p_extra->>'satisfaction', '');
BEGIN
  SELECT * INTO t FROM call_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR NOT can_view_call_ticket(p_ticket_id) THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  v_mine := t.assignee_id = v_uid;

  IF current_department_slug() = 'fleet' AND NOT v_mine AND NOT v_md THEN
    RAISE EXCEPTION 'Fleet can view this case but not change it';
  END IF;

  IF p_action = 'note' THEN
    IF v_note IS NULL THEN RAISE EXCEPTION 'Write a note'; END IF;
    v_kind := 'note'; v_to := t.status;

  ELSIF p_action IN ('start', 'waiting', 'resolve') THEN
    IF NOT (v_mine OR v_md) THEN RAISE EXCEPTION 'Only the person it''s assigned to can do that'; END IF;
    IF t.status NOT IN ('open', 'in_progress', 'waiting_on_caller') THEN RAISE EXCEPTION 'This case is already resolved'; END IF;
    IF p_action = 'start' THEN v_kind := 'status'; v_to := 'in_progress';
    ELSIF p_action = 'waiting' THEN
      IF v_note IS NULL THEN RAISE EXCEPTION 'Say what you need from the caller'; END IF;
      v_kind := 'status'; v_to := 'waiting_on_caller';
    ELSE
      IF v_note IS NULL THEN RAISE EXCEPTION 'Say how it was resolved'; END IF;
      v_kind := 'resolved'; v_to := 'resolved';
    END IF;

  ELSIF p_action = 'reassign' THEN
    IF NOT (v_mine OR v_md OR v_cc) THEN RAISE EXCEPTION 'You can''t reassign this case'; END IF;
    IF t.status IN ('resolved', 'closed') THEN RAISE EXCEPTION 'Reopen the case before reassigning it'; END IF;
    IF p_assignee_id IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_assignee_id AND is_active) THEN RAISE EXCEPTION 'Choose an active person'; END IF;
    IF p_assignee_id = t.assignee_id THEN RAISE EXCEPTION 'It''s already assigned to them'; END IF;
    IF v_note IS NULL THEN RAISE EXCEPTION 'Say why you''re reassigning it'; END IF;
    v_kind := 'reassigned'; v_to := 'open';

  ELSIF p_action = 'close' THEN
    IF NOT (v_cc OR v_md) THEN RAISE EXCEPTION 'Only the Call Center closes cases, after informing the caller'; END IF;
    IF t.status <> 'resolved' THEN RAISE EXCEPTION 'Only a resolved case can be closed'; END IF;
    IF t.priority = 'emergency' AND t.md_acknowledged_at IS NULL THEN
      RAISE EXCEPTION 'An emergency can''t be closed until the MD has acknowledged it';
    END IF;
    v_kind := 'closed'; v_to := 'closed';

  ELSIF p_action = 'reopen' THEN
    IF NOT (v_cc OR v_md) THEN RAISE EXCEPTION 'Only the Call Center can reopen a case'; END IF;
    IF t.status NOT IN ('resolved', 'closed') THEN RAISE EXCEPTION 'This case is still open'; END IF;
    IF v_note IS NULL THEN RAISE EXCEPTION 'Say what the caller reported'; END IF;
    IF t.resolved_on_call THEN RAISE EXCEPTION 'This call was solved on the spot - log a new call instead'; END IF;
    v_kind := 'reopened'; v_to := 'open';

  ELSIF p_action = 'acknowledge' THEN
    IF NOT v_md THEN RAISE EXCEPTION 'Only the MD acknowledges emergencies'; END IF;
    IF t.priority <> 'emergency' THEN RAISE EXCEPTION 'Only emergencies need acknowledging'; END IF;
    IF t.md_acknowledged_at IS NOT NULL THEN RAISE EXCEPTION 'Already acknowledged'; END IF;
    v_kind := 'acknowledged'; v_to := t.status;

  ELSIF p_action = 'set_callback' THEN
    IF NOT (v_cc OR v_md OR v_mine) THEN RAISE EXCEPTION 'You can''t set a call-back on this case'; END IF;
    v_callback := NULLIF(p_extra->>'callback_at', '')::timestamptz;
    v_kind := 'callback'; v_to := t.status;
  ELSE
    RAISE EXCEPTION 'Unknown action';
  END IF;

  INSERT INTO call_ticket_updates (ticket_id, author_id, kind, body, from_status, to_status, from_assignee, to_assignee)
  VALUES (p_ticket_id, v_uid, v_kind,
    CASE WHEN p_action = 'set_callback' THEN COALESCE(v_note, CASE WHEN v_callback IS NULL THEN 'Call-back cleared' ELSE 'Call back ' || to_char(v_callback AT TIME ZONE 'Africa/Kigali', 'Dy DD Mon, HH24:MI') END)
         WHEN p_action = 'close' AND v_satisfaction IS NOT NULL THEN concat_ws(' — ', 'Caller ' || v_satisfaction, v_note)
         ELSE v_note END,
    t.status, v_to,
    CASE WHEN p_action = 'reassign' THEN t.assignee_id END,
    CASE WHEN p_action = 'reassign' THEN p_assignee_id END);

  UPDATE call_tickets SET
    status = v_to,
    assignee_id = CASE WHEN p_action = 'reassign' THEN p_assignee_id ELSE assignee_id END,
    assigned_at = CASE WHEN p_action IN ('reassign', 'reopen') THEN now() ELSE assigned_at END,
    -- The two-hour clock: the owner's first action counts as the response.
    first_response_at = CASE
      WHEN p_action IN ('reassign', 'reopen') THEN NULL
      WHEN first_response_at IS NULL AND (v_mine OR (v_md AND t.assignee_id = v_uid)) AND p_action IN ('start', 'waiting', 'note', 'resolve') THEN now()
      ELSE first_response_at END,
    response_overdue_notified_at = CASE WHEN p_action IN ('reassign', 'reopen') THEN NULL ELSE response_overdue_notified_at END,
    resolution_note = CASE WHEN p_action = 'resolve' THEN v_note WHEN p_action = 'reopen' THEN NULL ELSE resolution_note END,
    resolved_at = CASE WHEN p_action = 'resolve' THEN now() WHEN p_action = 'reopen' THEN NULL ELSE resolved_at END,
    resolved_by = CASE WHEN p_action = 'resolve' THEN v_uid WHEN p_action = 'reopen' THEN NULL ELSE resolved_by END,
    closed_at = CASE WHEN p_action = 'close' THEN now() WHEN p_action = 'reopen' THEN NULL ELSE closed_at END,
    closed_by = CASE WHEN p_action = 'close' THEN v_uid WHEN p_action = 'reopen' THEN NULL ELSE closed_by END,
    satisfaction = CASE WHEN p_action = 'close' THEN v_satisfaction ELSE satisfaction END,
    md_acknowledged_at = CASE WHEN p_action = 'acknowledge' THEN now() ELSE md_acknowledged_at END,
    md_acknowledged_by = CASE WHEN p_action = 'acknowledge' THEN v_uid ELSE md_acknowledged_by END,
    callback_at = CASE WHEN p_action = 'set_callback' THEN v_callback WHEN p_action = 'close' THEN NULL ELSE callback_at END,
    last_activity_at = now(),
    updated_at = now()
  WHERE id = p_ticket_id;

  IF p_action IN ('reassign', 'reopen') THEN
    v_notify := CASE WHEN p_action = 'reassign' THEN p_assignee_id ELSE t.assignee_id END;
    IF v_notify IS NOT NULL AND v_notify <> v_uid THEN
      INSERT INTO notification_events (rule_key, payload)
      VALUES ('ticket_assigned', jsonb_build_object('ticket_id', p_ticket_id, 'recipient_id', v_notify, 'actor_id', v_uid,
        'reason', CASE WHEN p_action = 'reassign' THEN 'reassigned' ELSE 'reopened' END, 'note', v_note));
    END IF;
  END IF;

  IF t.created_by IS NOT NULL AND t.created_by <> v_uid AND p_action NOT IN ('reopen', 'set_callback', 'acknowledge') THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES (CASE WHEN p_action = 'resolve' THEN 'ticket_resolved' ELSE 'ticket_activity' END,
      jsonb_build_object('ticket_id', p_ticket_id, 'recipient_id', t.created_by, 'actor_id', v_uid, 'action', p_action, 'note', v_note));
  END IF;

  IF p_action = 'note' AND t.assignee_id IS NOT NULL AND t.assignee_id <> v_uid AND t.assignee_id <> COALESCE(t.created_by, v_uid) THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('ticket_activity', jsonb_build_object('ticket_id', p_ticket_id, 'recipient_id', t.assignee_id, 'actor_id', v_uid, 'action', 'note', 'note', v_note));
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION call_ticket_action(uuid, text, text, uuid, jsonb) TO authenticated;

-- ============================================================
-- Email rules
-- ============================================================
INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('ticket_emergency', 'EMERGENCY call', 'An emergency or serious safety call - sent instantly, day or night, with the location and what has been done.', 'Instant, any hour', ARRAY['md', 'resp:fleet_manager'], 4, 595, 'Call Center tickets', true, NULL),
  ('ticket_response_overdue', 'No response in 2 hours', 'A case has had no response from its owner two hours after it was assigned (the Script Book''s two-hour standard).', 'When it happens', ARRAY['actor', 'md'], 4, 625, 'Call Center tickets', true, NULL)
ON CONFLICT (key) DO NOTHING;
