/*
# Freelance drivers: never lose a shift (MD, 18 Oct 2026)

When a driver doesn't pay (or leaves) and no full replacement is ready yet,
a freelance driver from the pool covers the shift: they rent the car for
the shift with a target of 30,000 RWF and keep whatever they make above it.
- freelance_drivers: the pool (status available / busy / inactive).
- freelance_shifts: one row per covered shift - car, day, day/night/full,
  freelancer, the driver they cover for, the target, what they paid and
  whether it is confirmed. Paid shifts count as money the car made.
Fleet, Finance and the MD manage them.
*/

CREATE TABLE IF NOT EXISTS freelance_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  phone text NOT NULL,
  id_number text,
  licence_number text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'busy', 'inactive')),
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS freelance_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  shift text NOT NULL CHECK (shift IN ('day', 'night', 'full')),
  freelancer_id uuid NOT NULL REFERENCES freelance_drivers(id) ON DELETE RESTRICT,
  covering_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  target numeric NOT NULL DEFAULT 30000 CHECK (target >= 0),
  paid_amount numeric CHECK (paid_amount >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'paid', 'short', 'no_show', 'cancelled')),
  payment_method text CHECK (payment_method IN ('momo', 'cash', 'bank')),
  confirmed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  note text,
  recorded_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, day, shift)
);
CREATE INDEX IF NOT EXISTS freelance_shifts_day ON freelance_shifts (day DESC);

-- Paid or short follows from the amount; confirming stamps who and when.
CREATE OR REPLACE FUNCTION freelance_shift_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.paid_amount IS NOT NULL AND NEW.status IN ('planned', 'paid', 'short') THEN
    NEW.status := CASE WHEN NEW.paid_amount >= NEW.target THEN 'paid' ELSE 'short' END;
  END IF;
  IF NEW.confirmed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.confirmed_at IS NULL) THEN NEW.confirmed_by := COALESCE(auth.uid(), NEW.confirmed_by); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS freelance_shift_stamp ON freelance_shifts;
CREATE TRIGGER freelance_shift_stamp BEFORE INSERT OR UPDATE ON freelance_shifts FOR EACH ROW EXECUTE FUNCTION freelance_shift_stamp();

ALTER TABLE freelance_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE freelance_shifts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['freelance_drivers', 'freelance_shifts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_managing_director() OR current_department_slug() IN (''fleet'', ''finance'', ''it''))', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (is_managing_director() OR current_department_slug() IN (''fleet'', ''finance'')) WITH CHECK (is_managing_director() OR current_department_slug() IN (''fleet'', ''finance''))', t || '_write', t);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION freelance_shift_stamp() FROM PUBLIC, anon;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE freelance_shifts; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
