/*
# Call Center shift hours: 07:00, 15:00, 23:00

The Call Center works 07:00-15:00, 15:00-23:00 and 23:00-07:00 (the agents'
timetable from 6 October). Kivu Daily was built with 06:00/14:00/22:00, so
almost every shift showed as about an hour late. Lateness is recomputed for
every past shift from when it was really started.
*/

CREATE OR REPLACE FUNCTION shift_late_minutes(p_slot text, p_at timestamptz)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_local timestamp := p_at AT TIME ZONE 'Africa/Kigali';
  v_start time := CASE p_slot WHEN 'morning' THEN '07:00' WHEN 'afternoon' THEN '15:00' ELSE '23:00' END;
  v_diff numeric := extract(epoch FROM (v_local - (v_local::date + v_start))) / 60;
BEGIN
  IF v_diff < -720 THEN v_diff := v_diff + 1440; ELSIF v_diff > 720 THEN v_diff := v_diff - 1440; END IF;
  RETURN GREATEST(0, round(v_diff))::int;
END;
$$;
REVOKE ALL ON FUNCTION shift_late_minutes(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shift_late_minutes(text, timestamptz) TO authenticated, service_role;

UPDATE call_center_shifts SET late_minutes = shift_late_minutes(slot, started_at)
WHERE late_minutes IS DISTINCT FROM shift_late_minutes(slot, started_at);
