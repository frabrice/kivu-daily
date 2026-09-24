/*
# MD Panel: Survey Cases, starting with Charging Stations

Confirmed with the operator: MD Panel becomes a directory of research
"cases" - Charging Stations is Case 1. Each case is purpose-built (its
own tables, its own analytics), not a generic form-builder - building a
flexible engine for hypothetical future cases before a second one even
exists would be a lot of wasted complexity. survey_cases is only a thin
registry so the directory page and the public link/email-gate mechanism
can be shared machinery across future cases.

How data collection works: the MD shares a link (case's link_token in
the URL, e.g. /survey/<token>) with field collectors who have no Kivu
Daily account at all. They enter their email, checked against
survey_collectors (an allowlist the MD manages) - no password, no
magic-link verification, matching exactly what the operator described.
Every actual write (station submissions) is re-validated server-side
against the token + email, never trusting the browser alone, since the
whole audience here is unauthenticated (anon role) by design.

Tables read by the MD-side app (charging_stations, its guns and
photos) are locked down to MD-only for select/update/delete, and have
NO insert policy for anyone - the only way in is the
submit_charging_station() RPC, which runs SECURITY DEFINER and inserts
past RLS after re-validating the token+email itself. This mirrors the
same pattern already used for finance_transactions' system-generated
rows elsewhere in this schema.

Gun types are modeled as one row per type present at a station
(charging_station_guns), not a single field, since real Rwandan
stations mix Type 2/CCS2/CHAdeMO/GB/T on one site - each row carries
its own count and power rating (kW), since different connector types
on the same station often run at very different power levels.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- CASES + COLLECTOR ALLOWLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS survey_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  link_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE survey_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_cases_md_all" ON survey_cases;
CREATE POLICY "survey_cases_md_all" ON survey_cases FOR ALL TO authenticated
  USING (is_managing_director()) WITH CHECK (is_managing_director());

CREATE TABLE IF NOT EXISTS survey_collectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES survey_cases(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, email)
);

ALTER TABLE survey_collectors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_collectors_md_all" ON survey_collectors;
CREATE POLICY "survey_collectors_md_all" ON survey_collectors FOR ALL TO authenticated
  USING (is_managing_director()) WITH CHECK (is_managing_director());

INSERT INTO survey_cases (slug, name, description)
VALUES ('charging-stations', 'Charging Stations', 'Field survey of existing EV charging stations to size the branding-partnership opportunity: pricing, throughput, connector compatibility with our fleet, and ROI.')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- CHARGING STATIONS (Case 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS charging_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES survey_cases(id) ON DELETE CASCADE,
  station_number int NOT NULL,
  owner_brand text NOT NULL,
  location_name text NOT NULL,
  latitude numeric,
  longitude numeric,
  reverse_geocoded_address text,
  num_chargers int NOT NULL CHECK (num_chargers > 0),
  charger_brand text,
  operator_name text,
  buying_price_per_kwh numeric NOT NULL CHECK (buying_price_per_kwh >= 0),
  selling_price_per_kwh numeric NOT NULL CHECK (selling_price_per_kwh >= 0),
  cars_per_day int NOT NULL CHECK (cars_per_day >= 0),
  weekday_weekend_variation boolean NOT NULL DEFAULT false,
  weekend_cars_per_day int,
  operates_24_7 boolean NOT NULL DEFAULT false,
  operating_hours_note text,
  avg_session_minutes int,
  downtime_frequency text CHECK (downtime_frequency IN ('never', 'rarely', 'sometimes', 'often')),
  submitted_by_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, station_number)
);

ALTER TABLE charging_stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "charging_stations_md_select" ON charging_stations;
CREATE POLICY "charging_stations_md_select" ON charging_stations FOR SELECT TO authenticated
  USING (is_managing_director());

DROP POLICY IF EXISTS "charging_stations_md_update" ON charging_stations;
CREATE POLICY "charging_stations_md_update" ON charging_stations FOR UPDATE TO authenticated
  USING (is_managing_director()) WITH CHECK (is_managing_director());

DROP POLICY IF EXISTS "charging_stations_md_delete" ON charging_stations;
CREATE POLICY "charging_stations_md_delete" ON charging_stations FOR DELETE TO authenticated
  USING (is_managing_director());

CREATE TABLE IF NOT EXISTS charging_station_guns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES charging_stations(id) ON DELETE CASCADE,
  gun_type text NOT NULL CHECK (gun_type IN ('type2', 'ccs2', 'chademo', 'gbt', 'other')),
  gun_count int NOT NULL CHECK (gun_count > 0),
  power_kw numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE charging_station_guns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "charging_station_guns_md_select" ON charging_station_guns;
CREATE POLICY "charging_station_guns_md_select" ON charging_station_guns FOR SELECT TO authenticated
  USING (is_managing_director());

DROP POLICY IF EXISTS "charging_station_guns_md_delete" ON charging_station_guns;
CREATE POLICY "charging_station_guns_md_delete" ON charging_station_guns FOR DELETE TO authenticated
  USING (is_managing_director());

CREATE TABLE IF NOT EXISTS charging_station_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES charging_stations(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE charging_station_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "charging_station_photos_md_select" ON charging_station_photos;
CREATE POLICY "charging_station_photos_md_select" ON charging_station_photos FOR SELECT TO authenticated
  USING (is_managing_director());

DROP POLICY IF EXISTS "charging_station_photos_md_delete" ON charging_station_photos;
CREATE POLICY "charging_station_photos_md_delete" ON charging_station_photos FOR DELETE TO authenticated
  USING (is_managing_director());

-- ============================================================
-- PUBLIC (anon) RPCs - the only way into the tables above from
-- outside the app, each re-validating the token/email itself
-- ============================================================
CREATE OR REPLACE FUNCTION get_survey_progress(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case_id uuid;
  v_name text;
  v_slug text;
  v_next int;
BEGIN
  SELECT id, name, slug INTO v_case_id, v_name, v_slug FROM survey_cases WHERE link_token = p_token AND status = 'active';
  IF v_case_id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(MAX(station_number), 0) + 1 INTO v_next FROM charging_stations WHERE case_id = v_case_id;
  RETURN json_build_object('case_id', v_case_id, 'name', v_name, 'slug', v_slug, 'next_station_number', v_next);
END;
$$;

GRANT EXECUTE ON FUNCTION get_survey_progress(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION validate_collector_email(p_token text, p_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case_id uuid;
BEGIN
  SELECT id INTO v_case_id FROM survey_cases WHERE link_token = p_token AND status = 'active';
  IF v_case_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM survey_collectors WHERE case_id = v_case_id AND lower(email) = lower(p_email));
END;
$$;

GRANT EXECUTE ON FUNCTION validate_collector_email(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION submit_charging_station(
  p_token text,
  p_email text,
  p_owner_brand text,
  p_location_name text,
  p_latitude numeric,
  p_longitude numeric,
  p_reverse_geocoded_address text,
  p_num_chargers int,
  p_charger_brand text,
  p_operator_name text,
  p_buying_price_per_kwh numeric,
  p_selling_price_per_kwh numeric,
  p_cars_per_day int,
  p_weekday_weekend_variation boolean,
  p_weekend_cars_per_day int,
  p_operates_24_7 boolean,
  p_operating_hours_note text,
  p_avg_session_minutes int,
  p_downtime_frequency text,
  p_guns jsonb,
  p_photo_urls jsonb DEFAULT '[]'::jsonb
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case_id uuid;
  v_station_id uuid;
  v_next int;
  v_gun jsonb;
  v_photo text;
BEGIN
  SELECT id INTO v_case_id FROM survey_cases WHERE link_token = p_token AND status = 'active';
  IF v_case_id IS NULL THEN
    RAISE EXCEPTION 'This survey link is invalid or no longer active';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM survey_collectors WHERE case_id = v_case_id AND lower(email) = lower(p_email)) THEN
    RAISE EXCEPTION 'This email is not authorized to submit data for this survey';
  END IF;

  IF p_guns IS NULL OR jsonb_array_length(p_guns) = 0 THEN
    RAISE EXCEPTION 'At least one charger gun type is required';
  END IF;

  SELECT COALESCE(MAX(station_number), 0) + 1 INTO v_next FROM charging_stations WHERE case_id = v_case_id;

  INSERT INTO charging_stations (
    case_id, station_number, owner_brand, location_name, latitude, longitude, reverse_geocoded_address,
    num_chargers, charger_brand, operator_name, buying_price_per_kwh, selling_price_per_kwh, cars_per_day,
    weekday_weekend_variation, weekend_cars_per_day, operates_24_7, operating_hours_note, avg_session_minutes,
    downtime_frequency, submitted_by_email
  ) VALUES (
    v_case_id, v_next, p_owner_brand, p_location_name, p_latitude, p_longitude, p_reverse_geocoded_address,
    p_num_chargers, p_charger_brand, p_operator_name, p_buying_price_per_kwh, p_selling_price_per_kwh, p_cars_per_day,
    p_weekday_weekend_variation, p_weekend_cars_per_day, p_operates_24_7, p_operating_hours_note, p_avg_session_minutes,
    p_downtime_frequency, p_email
  ) RETURNING id INTO v_station_id;

  FOR v_gun IN SELECT * FROM jsonb_array_elements(p_guns) LOOP
    INSERT INTO charging_station_guns (station_id, gun_type, gun_count, power_kw)
    VALUES (v_station_id, v_gun->>'gun_type', (v_gun->>'gun_count')::int, NULLIF(v_gun->>'power_kw', '')::numeric);
  END LOOP;

  FOR v_photo IN SELECT * FROM jsonb_array_elements_text(p_photo_urls) LOOP
    INSERT INTO charging_station_photos (station_id, file_url) VALUES (v_station_id, v_photo);
  END LOOP;

  RETURN json_build_object('station_id', v_station_id, 'station_number', v_next);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_charging_station(
  text, text, text, text, numeric, numeric, text, int, text, text, numeric, numeric, int,
  boolean, int, boolean, text, int, text, jsonb, jsonb
) TO anon, authenticated;

-- ============================================================
-- STORAGE: public-facing bucket for station photos. Anon insert is
-- scoped to paths starting with an active case's link_token, so the
-- token (the link itself) is what gates uploads - same trust model
-- as the rest of this survey's public access.
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('survey-uploads', 'survey-uploads', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "survey_uploads_public_select" ON storage.objects;
CREATE POLICY "survey_uploads_public_select" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'survey-uploads');

DROP POLICY IF EXISTS "survey_uploads_anon_insert" ON storage.objects;
CREATE POLICY "survey_uploads_anon_insert" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'survey-uploads'
    AND EXISTS (SELECT 1 FROM survey_cases WHERE link_token = (storage.foldername(name))[1] AND status = 'active')
  );

DROP POLICY IF EXISTS "survey_uploads_md_delete" ON storage.objects;
CREATE POLICY "survey_uploads_md_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'survey-uploads' AND is_managing_director());
