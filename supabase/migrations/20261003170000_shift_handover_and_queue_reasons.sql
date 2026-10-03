/*
# Shift handover; call reasons for the grouped driver queue

## Shift handover (Script Book 13B)
"Open work belongs to Kivu Ride, not to one agent or one shift." At the
end of a shift an agent saves a handover: a general note plus, for each
open or pending case, the last action and exact next action. The next
shift sees it at the top of Calls & Tickets until someone acknowledges
it. Call Center and the MD only.

## Call reasons
The driver queue is now grouped by purpose (payment backup, follow-ups,
onboarding, check-ins); two reasons are added so calls in those groups
log cleanly.
*/

CREATE TABLE IF NOT EXISTS shift_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_handovers_created_idx ON shift_handovers (created_at DESC);
ALTER TABLE shift_handovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shift_handovers_select" ON shift_handovers;
CREATE POLICY "shift_handovers_select" ON shift_handovers FOR SELECT TO authenticated
  USING (current_department_slug() = 'call_center' OR is_managing_director());
DROP POLICY IF EXISTS "shift_handovers_insert" ON shift_handovers;
CREATE POLICY "shift_handovers_insert" ON shift_handovers FOR INSERT TO authenticated
  WITH CHECK ((current_department_slug() = 'call_center' OR is_managing_director()) AND author_id = auth.uid());

-- Acknowledging is the only change allowed after saving, and never by the author.
CREATE OR REPLACE FUNCTION acknowledge_shift_handover(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (current_department_slug() = 'call_center' OR is_managing_director()) THEN
    RAISE EXCEPTION 'Only the Call Center can acknowledge a handover';
  END IF;
  UPDATE shift_handovers SET acknowledged_by = auth.uid(), acknowledged_at = now()
  WHERE id = p_id AND acknowledged_at IS NULL AND author_id IS DISTINCT FROM auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Already acknowledged, or it is your own handover'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION acknowledge_shift_handover(uuid) TO authenticated;

INSERT INTO call_reasons (label, sort_order)
SELECT v.label, v.sort FROM (VALUES ('Payment reminder (backup)', 70), ('Flagged driver follow-up', 80)) AS v(label, sort)
WHERE NOT EXISTS (SELECT 1 FROM call_reasons r WHERE r.label = v.label);
