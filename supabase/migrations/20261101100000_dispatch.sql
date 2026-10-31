/*
# Dispatch: book a Kivu Ride trip for someone, from Kivu Daily

Anyone on the team can book a ride for a caller, a friend or a family
member (page /dispatch, edge function `dispatch`). The trip is booked in the
Kivu Ride app through the partner booking API (POST /v2/partner/trips): the
app offers it to the nearest drivers and the first to accept takes it.
Every booking is one row here, with who booked it and, while it runs, what
the app says (driver, car, trip code, status, final fare).

- dispatches: written only by the edge function (service role). Everyone
  reads their own; the MD and the Call Center read all.
- shift_id: the Call Center shift the booker had open, so a shift's daily
  report shows the trips dispatched on it.
- dispatch_known_places(): addresses from our real trips (and earlier
  dispatches) with their coordinates, searched first when typing a place.
- shift_stats(): now also counts the trips dispatched on the shift.
- pg_cron 'dispatch-refresh' every minute: brings running trips up to date
  even when nobody has the page open.
*/

CREATE TABLE IF NOT EXISTS dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  shift_id uuid REFERENCES call_center_shifts(id) ON DELETE SET NULL,
  for_kind text NOT NULL DEFAULT 'hotline' CHECK (for_kind IN ('hotline', 'whatsapp', 'friend_family', 'company', 'other')),
  client_name text NOT NULL,
  client_phone text NOT NULL,
  client_email text,
  pickup_address text NOT NULL,
  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  destination_address text NOT NULL,
  destination_lat double precision NOT NULL,
  destination_lng double precision NOT NULL,
  vehicle_type text NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'mobile_money')),
  scheduled_pickup_time timestamptz,
  note text,
  estimated_fare numeric,
  estimated_distance_km numeric,
  estimated_duration_minutes numeric,
  nearby_drivers int,
  partner_reference text NOT NULL UNIQUE,
  sandbox boolean NOT NULL DEFAULT false,
  -- 'booking' while it is being sent, 'failed' if the app refused it,
  -- 'unknown' if the app did not answer; otherwise the app's trip status.
  status text NOT NULL DEFAULT 'booking',
  error text,
  platform_trip_id bigint UNIQUE,
  trip_code text,
  driver_name text,
  driver_phone text,
  driver_rating numeric,
  vehicle_plate text,
  vehicle_label text,
  fare numeric,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  cancellation_reason text,
  cancelled_by_profile uuid REFERENCES profiles(id) ON DELETE SET NULL,
  last_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatches_created_idx ON dispatches (created_at DESC);
CREATE INDEX IF NOT EXISTS dispatches_by_idx ON dispatches (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS dispatches_shift_idx ON dispatches (shift_id);
CREATE INDEX IF NOT EXISTS dispatches_running_idx ON dispatches (status) WHERE status NOT IN ('completed', 'cancelled', 'failed');

ALTER TABLE dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dispatches_select" ON dispatches;
CREATE POLICY "dispatches_select" ON dispatches FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR is_managing_director() OR current_department_slug() = 'call_center');
REVOKE ALL ON dispatches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON dispatches FROM authenticated;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE dispatches; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Places people already ride from and to, best known first. Every word typed must appear.
CREATE OR REPLACE FUNCTION dispatch_known_places(p_q text, p_limit int DEFAULT 6)
RETURNS TABLE (address text, lat double precision, lng double precision, uses bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH words AS (
    SELECT array_agg('%' || replace(replace(w, '%', ''), '_', '') || '%') AS pats
    FROM unnest(string_to_array(lower(trim(p_q)), ' ')) w WHERE length(w) > 0
  ), pts AS (
    SELECT pickup_address AS a, pickup_lat AS la, pickup_lng AS lo FROM platform_trips WHERE pickup_lat IS NOT NULL AND pickup_address IS NOT NULL
    UNION ALL SELECT destination_address, destination_lat, destination_lng FROM platform_trips WHERE destination_lat IS NOT NULL AND destination_address IS NOT NULL
    UNION ALL SELECT pickup_address, pickup_lat, pickup_lng FROM dispatches
    UNION ALL SELECT destination_address, destination_lat, destination_lng FROM dispatches
  )
  SELECT a, avg(la), avg(lo), count(*)
  FROM pts, words
  WHERE words.pats IS NOT NULL AND lower(a) LIKE ALL (words.pats)
    -- the app's default map centre and the docs' sample point are not real places
    AND (round(la::numeric, 4), round(lo::numeric, 4)) NOT IN ((-1.9441, 30.0619), (-1.9536, 30.0606))
  GROUP BY a
  ORDER BY count(*) DESC, length(a)
  LIMIT greatest(1, least(p_limit, 20));
$$;
REVOKE ALL ON FUNCTION dispatch_known_places(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_known_places(text, int) TO service_role;

-- Shift stats: same as before, plus the trips dispatched on the shift.
CREATE OR REPLACE FUNCTION shift_stats(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s call_center_shifts%ROWTYPE;
  v_to timestamptz;
BEGIN
  SELECT * INTO s FROM call_center_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  IF auth.uid() IS NOT NULL AND NOT (is_managing_director() OR current_department_slug() IN ('call_center', 'finance')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  v_to := COALESCE(s.ended_at, now());
  RETURN jsonb_build_object(
    'minutes', round(extract(epoch FROM (v_to - s.started_at)) / 60),
    'contacts_logged', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to),
    'solved_on_call', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND resolved_on_call AND outcome_kind IS NULL),
    'handed_on', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND NOT resolved_on_call),
    'emergencies', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND priority = 'emergency'),
    'bookings', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND outcome_kind LIKE 'booking_%'),
    'abusive', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND outcome_kind = 'abusive_ended'),
    'cases_closed', (SELECT count(*) FROM call_ticket_updates WHERE author_id = s.agent_id AND kind = 'closed' AND created_at BETWEEN s.started_at AND v_to),
    'notes_added', (SELECT count(*) FROM call_ticket_updates WHERE author_id = s.agent_id AND kind = 'note' AND created_at BETWEEN s.started_at AND v_to),
    'driver_calls', (SELECT count(*) FROM call_logs WHERE caller_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to),
    'outreach_calls', (SELECT count(*) FROM platform_outreach_calls WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to),
    'outreach_interested', (SELECT count(*) FROM platform_outreach_calls WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND interested),
    'open_cases_at_end', (SELECT count(*) FROM call_tickets WHERE status IN ('open', 'in_progress', 'waiting_on_caller', 'resolved')),
    'dispatches', (SELECT count(*) FROM dispatches WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND NOT sandbox AND status <> 'failed')
  );
END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('dispatch-refresh'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule(
  'dispatch-refresh',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nwpsfsxuiugtgpgjffnt.supabase.co/functions/v1/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifications_cron_secret')
    ),
    body := '{"action":"refresh"}'::jsonb,
    timeout_milliseconds := 55000
  )
  WHERE EXISTS (SELECT 1 FROM dispatches WHERE status NOT IN ('completed', 'cancelled', 'failed') AND created_at > now() - interval '3 days');
  $$
);
