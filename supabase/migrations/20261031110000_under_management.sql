/*
# Under Management: Kivu Daily and the Kivu Ride app in step (MD, 30 Oct 2026)

Every car under our management (all fleet companies in the app except
SECURE ECO RIDE, which runs its own operation) with its drivers, in one
place; drivers and cars created once and linked, never twice.

- platform_fleet_companies, platform_vehicles, platform_fleet_members:
  a copy of the app's fleet companies, their cars (with the day/night
  roster and who drives now) and which company each driver is in. Written
  by the fleet-sync edge function (every 10 minutes and after each action).
  A company's kind: managed (an owner whose cars we manage), operator
  (runs its own drivers: Secure) or ignore (tests, not a fleet).
- vehicle_app_links: a car linked to its car in the app by hand (else by
  plate). driver_app_links gets one link per app account too.
- app_match_rejects: "not the same person": never match these two again.
- drivers.phone_alt, license_number, license_expiry: a second phone (both
  kept when Kivu Daily and the app disagree), and the licence the app needs.
- fleet_sync_cases ("To confirm"): every difference between the two. The
  fleet manager decides each one; nothing changes in the app by itself.
- fleet_sync_log: every action, who did it, and what the app answered.

Only the MD and Fleet act (through fleet-sync); Fleet, Finance and IT see.
*/

CREATE TABLE IF NOT EXISTS platform_fleet_companies (
  id int PRIMARY KEY,
  name text NOT NULL,
  fleet_code text,
  status text,
  driver_count int,
  kind text NOT NULL DEFAULT 'managed' CHECK (kind IN ('managed', 'operator', 'ignore')),
  owner_id uuid REFERENCES vehicle_owners(id) ON DELETE SET NULL,
  owner_confirmed boolean NOT NULL DEFAULT false,   -- set by a person: the sync no longer guesses the owner
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_vehicles (
  id int PRIMARY KEY,
  plate text NOT NULL,
  make text, model text, year int, color text, seats int, fuel_type text,
  status text, is_approved boolean,
  fleet_company_id int,
  owner_driver_id int,
  insurance_expiry date, registration_expiry date,
  current_driver_id int, current_driver_name text, current_driver_phone text, assigned_at timestamptz,
  roster jsonb NOT NULL DEFAULT '[]'::jsonb,         -- [{driver_id, name, phone, label}] up to 2
  kivu_vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  match_method text CHECK (match_method IN ('link', 'plate')),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_vehicles_kivu_idx ON platform_vehicles (kivu_vehicle_id);

CREATE TABLE IF NOT EXISTS platform_fleet_members (
  platform_driver_id int PRIMARY KEY,
  fleet_company_id int NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_app_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL UNIQUE REFERENCES vehicles(id) ON DELETE CASCADE,
  platform_vehicle_id int NOT NULL UNIQUE,
  linked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now()
);

-- One Kivu Daily person per app account.
CREATE UNIQUE INDEX IF NOT EXISTS driver_app_links_platform_uidx ON driver_app_links (platform_driver_id);

CREATE TABLE IF NOT EXISTS app_match_rejects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  platform_driver_id int NOT NULL,
  rejected_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, platform_driver_id)
);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS phone_alt text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_number text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_expiry date;

ALTER TABLE platform_driver_status ADD COLUMN IF NOT EXISTS is_approved boolean;
ALTER TABLE platform_driver_status ADD COLUMN IF NOT EXISTS is_rejected boolean;
ALTER TABLE platform_driver_status ADD COLUMN IF NOT EXISTS license_number text;

CREATE TABLE IF NOT EXISTS fleet_sync_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,                 -- stable: the same difference keeps the same case
  kind text NOT NULL,
  title text NOT NULL,
  driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  platform_driver_id int,
  platform_vehicle_id int,
  kd_value text,
  app_value text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'resolved')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution text
);
CREATE INDEX IF NOT EXISTS fleet_sync_cases_status_idx ON fleet_sync_cases (status, kind);

CREATE TABLE IF NOT EXISTS fleet_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  summary text NOT NULL,
  ok boolean NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb   -- [{call, status, ok, message}]
);
CREATE INDEX IF NOT EXISTS fleet_sync_log_at_idx ON fleet_sync_log (at DESC);

-- Fleet, Finance, IT and the MD see; only the edge function (service role) writes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_fleet_companies', 'platform_vehicles', 'platform_fleet_members', 'vehicle_app_links', 'app_match_rejects', 'fleet_sync_cases', 'fleet_sync_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (is_managing_director() OR current_department_slug() IN ('fleet', 'finance', 'it'))$p$, t || '_select', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
  END LOOP;
END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE fleet_sync_cases; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE platform_vehicles; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Known companies: Secure runs its own drivers; the test company is not a fleet.
INSERT INTO platform_fleet_companies (id, name, kind) VALUES (29, 'SECURE ECO RIDE', 'operator'), (26, 'test company', 'ignore')
ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind;

-- Every 10 minutes (same shared secret as the other syncs).
DO $$ BEGIN PERFORM cron.unschedule('fleet-sync'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule(
  'fleet-sync',
  '1-59/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nwpsfsxuiugtgpgjffnt.supabase.co/functions/v1/fleet-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifications_cron_secret')
    ),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
-- Keep a year of history.
DO $$ BEGIN PERFORM cron.unschedule('fleet-sync-log-trim'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('fleet-sync-log-trim', '23 3 * * *', $$DELETE FROM fleet_sync_log WHERE at < now() - interval '365 days'; DELETE FROM fleet_sync_cases WHERE status = 'resolved' AND resolved_at < now() - interval '90 days'$$);
