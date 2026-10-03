/*
# Two-hour response check; instant emails at any hour

- flag_response_overdue(): called by notifications-run on every run.
  Any open case whose owner hasn't responded (first_response_at) two
  hours after it was assigned gets one 'ticket_response_overdue' event
  (owner + MD), and is marked so it never repeats. Emergencies are left
  out - they alert the MD instantly and need an explicit acknowledgement.
- claim_notification_outbox gains p_rule_keys so the overnight run can
  send instant emails (new cases, emergencies, replies) while scheduled
  digests still wait for the morning. Kivu Ride's call center is 24/7.
*/

CREATE OR REPLACE FUNCTION flag_response_overdue()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  WITH due AS (
    UPDATE call_tickets SET response_overdue_notified_at = now()
    WHERE status IN ('open', 'in_progress', 'waiting_on_caller')
      AND priority <> 'emergency'
      AND first_response_at IS NULL
      AND response_overdue_notified_at IS NULL
      AND assignee_id IS NOT NULL
      AND COALESCE(assigned_at, created_at) < now() - interval '2 hours'
    RETURNING id, assignee_id
  )
  INSERT INTO notification_events (rule_key, payload)
  SELECT 'ticket_response_overdue', jsonb_build_object('ticket_id', id, 'recipient_id', assignee_id) FROM due;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION flag_response_overdue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION flag_response_overdue() TO service_role;

DROP FUNCTION IF EXISTS claim_notification_outbox(int, uuid[]);
CREATE OR REPLACE FUNCTION claim_notification_outbox(p_limit int DEFAULT 50, p_only uuid[] DEFAULT NULL, p_rule_keys text[] DEFAULT NULL)
RETURNS SETOF notification_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE notification_outbox o SET
    status = 'sending',
    claimed_at = now(),
    attempts = o.attempts + 1
  WHERE o.id IN (
    SELECT id FROM notification_outbox
    WHERE attempts < 3
      AND (status IN ('pending', 'failed') OR (status = 'sending' AND claimed_at < now() - interval '10 minutes'))
      AND (p_only IS NULL OR id = ANY (p_only))
      AND (p_rule_keys IS NULL OR rule_key = ANY (p_rule_keys))
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
$$;
REVOKE ALL ON FUNCTION claim_notification_outbox(int, uuid[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_notification_outbox(int, uuid[], text[]) TO service_role;
