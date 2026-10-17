-- Declining a bigger budget on a project that was already approved keeps
-- the project running on its old approved budget; only a project that was
-- never approved becomes "declined". Asking for a bigger budget doesn't
-- change the status of a running project either (only proposed_at moves).
CREATE OR REPLACE FUNCTION propose_it_initiative(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v it_initiatives%ROWTYPE;
BEGIN
  IF NOT is_it_lead() THEN RAISE EXCEPTION 'Only the head of IT or the MD can propose a project'; END IF;
  SELECT * INTO v FROM it_initiatives WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v.problem IS NULL OR v.outcome IS NULL THEN RAISE EXCEPTION 'Describe the problem and the expected outcome before proposing it'; END IF;
  IF v.start_date IS NULL OR v.target_date IS NULL THEN RAISE EXCEPTION 'Set the start and target dates before proposing it'; END IF;
  IF v.status IN ('done', 'cancelled') THEN RAISE EXCEPTION 'This project is closed'; END IF;
  PERFORM set_config('kivu.it_decision', '1', true);
  UPDATE it_initiatives SET
    status = CASE WHEN v.approved_budget IS NOT NULL AND v.status IN ('approved', 'in_progress', 'on_hold') THEN v.status ELSE 'proposed' END,
    proposed_at = now(), updated_at = now()
  WHERE id = p_id;
  PERFORM set_config('kivu.it_decision', '', true);
  INSERT INTO notification_events (rule_key, payload) VALUES ('it_initiative_proposed', jsonb_build_object('initiative_id', p_id, 'actor_id', auth.uid()));
END $$;
REVOKE ALL ON FUNCTION propose_it_initiative(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION propose_it_initiative(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION decide_it_initiative(p_id uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v it_initiatives%ROWTYPE; v_keep boolean;
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD approves IT projects and budgets'; END IF;
  SELECT * INTO v FROM it_initiatives WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF NOT p_approve AND NULLIF(trim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why it is declined'; END IF;
  v_keep := NOT p_approve AND v.approved_budget IS NOT NULL AND v.status IN ('approved', 'in_progress', 'on_hold', 'done', 'proposed');
  PERFORM set_config('kivu.it_decision', '1', true);
  UPDATE it_initiatives SET
    status = CASE
      WHEN p_approve THEN (CASE WHEN v.status IN ('in_progress', 'on_hold', 'done') THEN v.status ELSE 'approved' END)
      WHEN v_keep THEN (CASE WHEN v.status = 'proposed' THEN 'approved' ELSE v.status END)
      ELSE 'declined' END,
    approved_budget = CASE WHEN p_approve THEN it_initiative_planned(p_id) ELSE v.approved_budget END,
    approved_by = auth.uid(), approved_at = CASE WHEN p_approve THEN now() ELSE v.approved_at END,
    decision_note = NULLIF(trim(p_note), ''), updated_at = now()
  WHERE id = p_id;
  PERFORM set_config('kivu.it_decision', '', true);
  INSERT INTO notification_events (rule_key, payload)
  VALUES ('it_initiative_decided', jsonb_build_object('initiative_id', p_id, 'approved', p_approve, 'kept_budget', v_keep, 'recipient_id', COALESCE(v.owner_id, v.created_by), 'actor_id', auth.uid()));
END $$;
REVOKE ALL ON FUNCTION decide_it_initiative(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION decide_it_initiative(uuid, boolean, text) TO authenticated;
