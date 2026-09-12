/*
# Email logs

`send-email`'s edge function has always tried to log every send attempt to
an `email_logs` table that never actually existed in this schema - it was
carried over from the original Bolt app and silently never worked. Adding
it now because the invite-by-email flow is about to make this code path
real. Written only by edge functions running as service_role (which
bypasses RLS entirely), so there are no client write policies - just a
read policy for the MD to audit delivery.
*/

CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  email_type text NOT NULL DEFAULT 'general',
  recipient_email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_logs_user_idx ON email_logs(user_id);

ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_logs_select" ON email_logs;
CREATE POLICY "email_logs_select" ON email_logs FOR SELECT TO authenticated
  USING (is_managing_director());
