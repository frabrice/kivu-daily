/*
# Call Center tickets ("From Call Center")

Confirmed with the operator: Call Center agents log every inbound call.
If they solve it on the call, it's recorded and closed on the spot. If
they can't, they take the caller's details, write up the issue and
assign it to the person in charge - who sees it on their own "From Call
Center" page, gets an email, works it, and marks it resolved. Resolved
tickets go back to the Call Center to call the caller back, and only
then are closed (or reopened if the caller says it isn't fixed).

## Design
- profiles.responsibility_label: what each person is in charge of,
  shown in the assign list as "Name (Head of IT)". Payroll job titles
  don't match how the company actually routes work, so this is its own
  field, editable by the MD and Finance.
- call_tickets: one row per inbound call. Status:
  open -> in_progress -> waiting_on_caller -> resolved -> closed.
  A call solved on the spot is created straight into 'closed' with
  resolved_on_call = true, so every call counts in the stats.
- call_ticket_updates: the append-only timeline (notes, status changes,
  reassignments) - no client can edit or delete history.
- All writes go through two SECURITY DEFINER functions with role checks:
  create_call_ticket (Call Center + MD) and call_ticket_action (start,
  waiting, note, resolve, reassign, close, reopen - each with its own
  who-may rule). There are no client INSERT/UPDATE/DELETE policies.
- Visibility: Call Center and the MD see every ticket; anyone else sees
  tickets assigned to them now or that they handled before. The check
  is a SECURITY DEFINER helper so the two tables' policies can refer to
  each other without recursing through RLS.
- Every action raises notification_events for the email engine; the
  actor is never emailed about their own action.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS responsibility_label text;

UPDATE profiles SET responsibility_label = v.label
FROM (VALUES
  ('managing_director', NULL, 'Managing Director'),
  (NULL, 'imanariyo baptiste', 'Head of IT'),
  (NULL, 'mugisha rodrigue', 'Finance'),
  (NULL, 'henry rugaba mark', 'Operations Manager'),
  (NULL, 'ndekwe jean bertrand', 'Fleet'),
  (NULL, 'uwera janviere', 'IT & driver payments'),
  (NULL, 'angel', 'Call Center'),
  (NULL, 'munezero sheilla', 'Call Center')
) AS v(role, name, label)
WHERE profiles.responsibility_label IS NULL
  AND ((v.role IS NOT NULL AND profiles.role = v.role) OR (v.name IS NOT NULL AND lower(trim(profiles.full_name)) = v.name));

-- admin_update_employee gains the label. The old 3-argument version is
-- dropped so PostgREST never has two overloads to choose between;
-- NULL leaves the label unchanged, '' clears it.
DROP FUNCTION IF EXISTS admin_update_employee(uuid, text, uuid);

CREATE OR REPLACE FUNCTION admin_update_employee(p_user_id uuid, p_role text, p_department_id uuid, p_responsibility_label text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_role text;
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() = 'finance') THEN
    RAISE EXCEPTION 'Only the Managing Director or Finance can edit an employee';
  END IF;
  IF p_role NOT IN ('employee', 'managing_director') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  SELECT role INTO v_target_role FROM profiles WHERE id = p_user_id;
  IF v_target_role = 'managing_director' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only the Managing Director can edit a Managing Director';
  END IF;
  IF p_role = 'managing_director' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only the Managing Director can grant the Managing Director role';
  END IF;

  UPDATE profiles SET
    role = p_role,
    department_id = CASE WHEN p_role = 'employee' THEN p_department_id ELSE NULL END,
    responsibility_label = CASE WHEN p_responsibility_label IS NULL THEN responsibility_label ELSE NULLIF(trim(p_responsibility_label), '') END,
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_employee(uuid, text, uuid, text) TO authenticated;

-- ============================================================
-- Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS call_ticket_counters (
  year_month text PRIMARY KEY,
  next_seq int NOT NULL DEFAULT 1
);
ALTER TABLE call_ticket_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS call_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  caller_name text NOT NULL,
  caller_phone text NOT NULL,
  caller_email text,
  caller_type text NOT NULL CHECK (caller_type IN ('passenger', 'driver', 'car_owner', 'partner', 'other')),
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('app', 'payment', 'trip', 'driver_behaviour', 'lost_item', 'complaint', 'other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  details text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'waiting_on_caller', 'resolved', 'closed')),
  resolved_on_call boolean NOT NULL DEFAULT false,
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  closed_at timestamptz,
  closed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_tickets_assignee_idx ON call_tickets (assignee_id, status);
CREATE INDEX IF NOT EXISTS call_tickets_status_idx ON call_tickets (status, created_at);
ALTER TABLE call_tickets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS call_ticket_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES call_tickets(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('created', 'note', 'status', 'reassigned', 'resolved', 'closed', 'reopened')),
  body text,
  from_status text,
  to_status text,
  from_assignee uuid REFERENCES profiles(id) ON DELETE SET NULL,
  to_assignee uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_ticket_updates_ticket_idx ON call_ticket_updates (ticket_id, created_at);
ALTER TABLE call_ticket_updates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_view_call_ticket(p_ticket_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director()
      OR current_department_slug() = 'call_center'
      OR EXISTS (SELECT 1 FROM call_tickets t WHERE t.id = p_ticket_id AND t.assignee_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM call_ticket_updates u
        WHERE u.ticket_id = p_ticket_id
          AND (u.author_id = auth.uid() OR u.from_assignee = auth.uid() OR u.to_assignee = auth.uid())
      );
$$;
GRANT EXECUTE ON FUNCTION can_view_call_ticket(uuid) TO authenticated;

DROP POLICY IF EXISTS "call_tickets_select" ON call_tickets;
CREATE POLICY "call_tickets_select" ON call_tickets FOR SELECT TO authenticated USING (can_view_call_ticket(id));
DROP POLICY IF EXISTS "call_ticket_updates_select" ON call_ticket_updates;
CREATE POLICY "call_ticket_updates_select" ON call_ticket_updates FOR SELECT TO authenticated USING (can_view_call_ticket(ticket_id));

-- ============================================================
-- Create
-- ============================================================
CREATE OR REPLACE FUNCTION create_call_ticket(
  p_caller_name text,
  p_caller_phone text,
  p_caller_email text,
  p_caller_type text,
  p_driver_id uuid,
  p_category text,
  p_priority text,
  p_details text,
  p_resolved_on_call boolean,
  p_resolution_note text,
  p_assignee_id uuid
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ym text := to_char(now() AT TIME ZONE 'Africa/Kigali', 'YYYY-MM');
  v_seq int;
  v_ref text;
  v_id uuid;
  v_cc_dept uuid;
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() = 'call_center') THEN
    RAISE EXCEPTION 'Only the Call Center or the MD can log a call';
  END IF;
  IF NULLIF(trim(p_caller_name), '') IS NULL OR NULLIF(trim(p_caller_phone), '') IS NULL THEN
    RAISE EXCEPTION 'The caller''s name and phone number are required';
  END IF;
  IF NULLIF(trim(p_details), '') IS NULL THEN
    RAISE EXCEPTION 'Describe the issue';
  END IF;
  IF p_resolved_on_call THEN
    IF NULLIF(trim(p_resolution_note), '') IS NULL THEN
      RAISE EXCEPTION 'Say how you resolved it';
    END IF;
  ELSE
    IF p_assignee_id IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_assignee_id AND is_active) THEN
      RAISE EXCEPTION 'Choose an active person to assign this to';
    END IF;
  END IF;

  INSERT INTO call_ticket_counters (year_month, next_seq) VALUES (v_ym, 2)
  ON CONFLICT (year_month) DO UPDATE SET next_seq = call_ticket_counters.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;
  v_ref := 'CC-' || v_ym || '-' || lpad(v_seq::text, 3, '0');

  INSERT INTO call_tickets (
    reference, caller_name, caller_phone, caller_email, caller_type, driver_id, category, priority, details,
    status, resolved_on_call, assignee_id, created_by, resolution_note, resolved_at, resolved_by, closed_at, closed_by
  ) VALUES (
    v_ref, trim(p_caller_name), trim(p_caller_phone), NULLIF(trim(p_caller_email), ''), p_caller_type, p_driver_id, p_category,
    COALESCE(p_priority, 'normal'), trim(p_details),
    CASE WHEN p_resolved_on_call THEN 'closed' ELSE 'open' END,
    COALESCE(p_resolved_on_call, false),
    CASE WHEN p_resolved_on_call THEN v_uid ELSE p_assignee_id END,
    v_uid,
    CASE WHEN p_resolved_on_call THEN trim(p_resolution_note) END,
    CASE WHEN p_resolved_on_call THEN now() END,
    CASE WHEN p_resolved_on_call THEN v_uid END,
    CASE WHEN p_resolved_on_call THEN now() END,
    CASE WHEN p_resolved_on_call THEN v_uid END
  ) RETURNING id INTO v_id;

  IF p_resolved_on_call THEN
    INSERT INTO call_ticket_updates (ticket_id, author_id, kind, body, to_status)
    VALUES (v_id, v_uid, 'resolved', trim(p_resolution_note), 'closed');
  ELSE
    INSERT INTO call_ticket_updates (ticket_id, author_id, kind, to_status, to_assignee)
    VALUES (v_id, v_uid, 'created', 'open', p_assignee_id);
    IF p_assignee_id <> v_uid THEN
      INSERT INTO notification_events (rule_key, payload)
      VALUES ('ticket_assigned', jsonb_build_object('ticket_id', v_id, 'recipient_id', p_assignee_id, 'actor_id', v_uid, 'reason', 'new'));
    END IF;
  END IF;

  SELECT id INTO v_cc_dept FROM departments WHERE slug = 'call_center';
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (v_uid, v_cc_dept,
    CASE WHEN p_resolved_on_call THEN 'resolved a call on the spot' ELSE 'logged a call and assigned it to ' || COALESCE((SELECT full_name FROM profiles WHERE id = p_assignee_id), 'someone') END,
    'call_ticket', v_id, v_ref);

  RETURN json_build_object('id', v_id, 'reference', v_ref);
END;
$$;
GRANT EXECUTE ON FUNCTION create_call_ticket(text, text, text, text, uuid, text, text, text, boolean, text, uuid) TO authenticated;

-- ============================================================
-- Every later step
-- ============================================================
CREATE OR REPLACE FUNCTION call_ticket_action(p_ticket_id uuid, p_action text, p_note text DEFAULT NULL, p_assignee_id uuid DEFAULT NULL)
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
BEGIN
  SELECT * INTO t FROM call_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR NOT can_view_call_ticket(p_ticket_id) THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  v_mine := t.assignee_id = v_uid;

  IF p_action = 'note' THEN
    IF v_note IS NULL THEN RAISE EXCEPTION 'Write a note'; END IF;
    v_kind := 'note'; v_to := t.status;

  ELSIF p_action IN ('start', 'waiting', 'resolve') THEN
    IF NOT (v_mine OR v_md) THEN RAISE EXCEPTION 'Only the person it''s assigned to can do that'; END IF;
    IF t.status NOT IN ('open', 'in_progress', 'waiting_on_caller') THEN RAISE EXCEPTION 'This ticket is already resolved'; END IF;
    IF p_action = 'start' THEN
      v_kind := 'status'; v_to := 'in_progress';
    ELSIF p_action = 'waiting' THEN
      IF v_note IS NULL THEN RAISE EXCEPTION 'Say what you need from the caller'; END IF;
      v_kind := 'status'; v_to := 'waiting_on_caller';
    ELSE
      IF v_note IS NULL THEN RAISE EXCEPTION 'Say how it was resolved'; END IF;
      v_kind := 'resolved'; v_to := 'resolved';
    END IF;

  ELSIF p_action = 'reassign' THEN
    IF NOT (v_mine OR v_md OR v_cc) THEN RAISE EXCEPTION 'You can''t reassign this ticket'; END IF;
    IF t.status IN ('resolved', 'closed') THEN RAISE EXCEPTION 'Reopen the ticket before reassigning it'; END IF;
    IF p_assignee_id IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_assignee_id AND is_active) THEN
      RAISE EXCEPTION 'Choose an active person';
    END IF;
    IF p_assignee_id = t.assignee_id THEN RAISE EXCEPTION 'It''s already assigned to them'; END IF;
    IF v_note IS NULL THEN RAISE EXCEPTION 'Say why you''re reassigning it'; END IF;
    v_kind := 'reassigned'; v_to := 'open';

  ELSIF p_action = 'close' THEN
    IF NOT (v_cc OR v_md) THEN RAISE EXCEPTION 'Only the Call Center closes tickets, after calling the caller back'; END IF;
    IF t.status <> 'resolved' THEN RAISE EXCEPTION 'Only a resolved ticket can be closed'; END IF;
    v_kind := 'closed'; v_to := 'closed';

  ELSIF p_action = 'reopen' THEN
    IF NOT (v_cc OR v_md) THEN RAISE EXCEPTION 'Only the Call Center can reopen a ticket'; END IF;
    IF t.status NOT IN ('resolved', 'closed') THEN RAISE EXCEPTION 'This ticket is still open'; END IF;
    IF v_note IS NULL THEN RAISE EXCEPTION 'Say what the caller reported'; END IF;
    IF t.resolved_on_call THEN RAISE EXCEPTION 'This call was solved on the spot - log a new call instead'; END IF;
    v_kind := 'reopened'; v_to := 'open';

  ELSE
    RAISE EXCEPTION 'Unknown action';
  END IF;

  INSERT INTO call_ticket_updates (ticket_id, author_id, kind, body, from_status, to_status, from_assignee, to_assignee)
  VALUES (p_ticket_id, v_uid, v_kind, v_note, t.status, v_to,
    CASE WHEN p_action = 'reassign' THEN t.assignee_id END,
    CASE WHEN p_action = 'reassign' THEN p_assignee_id END);

  UPDATE call_tickets SET
    status = v_to,
    assignee_id = CASE WHEN p_action = 'reassign' THEN p_assignee_id ELSE assignee_id END,
    resolution_note = CASE WHEN p_action = 'resolve' THEN v_note WHEN p_action = 'reopen' THEN NULL ELSE resolution_note END,
    resolved_at = CASE WHEN p_action = 'resolve' THEN now() WHEN p_action = 'reopen' THEN NULL ELSE resolved_at END,
    resolved_by = CASE WHEN p_action = 'resolve' THEN v_uid WHEN p_action = 'reopen' THEN NULL ELSE resolved_by END,
    closed_at = CASE WHEN p_action = 'close' THEN now() WHEN p_action = 'reopen' THEN NULL ELSE closed_at END,
    closed_by = CASE WHEN p_action = 'close' THEN v_uid WHEN p_action = 'reopen' THEN NULL ELSE closed_by END,
    last_activity_at = now(),
    updated_at = now()
  WHERE id = p_ticket_id;

  -- Emails: the new owner hears about a (re)assignment or reopening;
  -- the agent who logged it hears about everything that happens to it.
  IF p_action IN ('reassign', 'reopen') THEN
    v_notify := CASE WHEN p_action = 'reassign' THEN p_assignee_id ELSE t.assignee_id END;
    IF v_notify IS NOT NULL AND v_notify <> v_uid THEN
      INSERT INTO notification_events (rule_key, payload)
      VALUES ('ticket_assigned', jsonb_build_object('ticket_id', p_ticket_id, 'recipient_id', v_notify, 'actor_id', v_uid,
        'reason', CASE WHEN p_action = 'reassign' THEN 'reassigned' ELSE 'reopened' END, 'note', v_note));
    END IF;
  END IF;

  IF t.created_by IS NOT NULL AND t.created_by <> v_uid AND p_action <> 'reopen' THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES (CASE WHEN p_action = 'resolve' THEN 'ticket_resolved' ELSE 'ticket_activity' END,
      jsonb_build_object('ticket_id', p_ticket_id, 'recipient_id', t.created_by, 'actor_id', v_uid, 'action', p_action, 'note', v_note));
  END IF;

  -- A note from the agent side reaches the person working it.
  IF p_action = 'note' AND t.assignee_id IS NOT NULL AND t.assignee_id <> v_uid AND t.assignee_id <> COALESCE(t.created_by, v_uid) THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('ticket_activity', jsonb_build_object('ticket_id', p_ticket_id, 'recipient_id', t.assignee_id, 'actor_id', v_uid, 'action', 'note', 'note', v_note));
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION call_ticket_action(uuid, text, text, uuid) TO authenticated;

-- ============================================================
-- Email rules
-- ============================================================
INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('ticket_assigned', 'New ticket for you', 'Full details, the caller''s contact and a button straight to the ticket. Urgent tickets say URGENT in the subject. Also sent when a ticket is reassigned or reopened.', 'Instant', ARRAY['actor'], 4, 600, 'Call Center tickets', true, NULL),
  ('ticket_activity', 'Ticket updates', 'Notes, status changes and reassignments - to the agent who logged it, and agents'' notes to the person working it.', 'Instant', ARRAY['actor'], 4, 610, 'Call Center tickets', true, NULL),
  ('ticket_resolved', 'Resolved - call the caller back', 'Tells the agent a ticket is resolved, with the resolution, so they call the caller and close it.', 'Instant', ARRAY['actor'], 4, 620, 'Call Center tickets', true, NULL),
  ('ticket_open_digest', 'Your open tickets', 'Each person''s unresolved tickets, urgent and overdue first.', 'Monday–Saturday 08:00, only if you have any', ARRAY['assignees'], 4, 630, 'Call Center tickets', true, NULL)
ON CONFLICT (key) DO NOTHING;

UPDATE notification_rules SET description = description || ' Also lists resolved tickets waiting for a call-back.'
WHERE key = 'callcenter_followups' AND description NOT LIKE '%call-back%';
UPDATE notification_rules SET description = description || ' Includes overdue Call Center tickets.'
WHERE key = 'md_daily_digest' AND description NOT LIKE '%Call Center tickets%';
