/*
# Daily driver-payment report; driver payments out of the Call Center

Requested by the MD (8 Oct 2026).

1. "Driver payments this morning" - every day at 06:30, to Henry Rugaba
   Mark (route_operations: stops the car / takes it back), the MD,
   Janviere (driver_payment_followup), Bertrand (fleet_manager) and
   Rodrigue (route_finance). Every driver who owes anything is listed and
   highlighted, every day, until they pay in full or their contract ends.
   It replaces the four overlapping "not cleared" / escalation emails,
   which are switched off (not deleted).
2. The Call Center no longer sees anything about our drivers' payments:
   no read access to deposits, fines or fine payments, the "Payment
   reminder (backup)" call reason is removed (never used), and the Call
   Queue's payment group is gone from the app.
*/

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('driver_payments_morning', 'Driver payments this morning',
   'Every driver who owes anything — days driven unpaid, behind on the week, days lost, last payment — highlighted until they pay in full or their contract ends. Also lists payments waiting for Finance''s confirmation. Never sent to the Call Center.',
   'Daily 06:30', ARRAY['resp:route_operations', 'md', 'resp:driver_payment_followup', 'resp:fleet_manager', 'resp:route_finance'], 1, 5, 'Driver payments', true, NULL)
ON CONFLICT (key) DO UPDATE SET audience = EXCLUDED.audience, schedule_label = EXCLUDED.schedule_label, description = EXCLUDED.description, enabled = true;

UPDATE notification_rules SET enabled = false,
  description = 'Replaced by "Driver payments this morning" (8 Oct 2026).'
WHERE key IN ('driver_not_cleared_monday', 'driver_not_cleared_summary', 'driver_not_cleared_daily', 'driver_escalation');

-- The Call Center never had a reason to see driver payments.
UPDATE notification_rules SET audience = array_remove(audience, 'dept:call_center') WHERE 'dept:call_center' = ANY (audience) AND key LIKE 'driver%';

DROP POLICY IF EXISTS "driver_deposits_select" ON driver_deposits;
CREATE POLICY "driver_deposits_select" ON driver_deposits FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'it', 'finance') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_select" ON driver_fines;
CREATE POLICY "driver_fines_select" ON driver_fines FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fine_payments_select" ON driver_fine_payments;
CREATE POLICY "driver_fine_payments_select" ON driver_fine_payments FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'it') OR is_managing_director());

DELETE FROM call_reasons r WHERE r.label = 'Payment reminder (backup)'
  AND NOT EXISTS (SELECT 1 FROM call_logs l WHERE l.reason_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM call_scripts s WHERE s.reason_id = r.id);
