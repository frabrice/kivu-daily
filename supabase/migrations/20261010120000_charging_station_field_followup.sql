/*
# Charging stations: field follow-up from Henry Rugaba Mark

Mark collected more information on the stations that was not in the survey
form (given to the MD on 10 Oct 2026). It applies to all 13 stations:

- Cars per day: average 40, minimum 30, maximum 50 per station
- Charging time: minimum 35 min, maximum 2 hours, average 50 min
- Operator salary (per month): minimum 85,000, maximum 150,000, average 120,000 RWF
- 3 shifts a day, 8 hours each person; every station works 24 hours
- No technical issues so far
- Chargers can get hot, but have fans inside

Stored in separate "follow-up" columns: the numbers the collector typed
into the survey (cars_per_day, avg_session_minutes, ...) are never
overwritten, so the analysis can show both. Only downtime_frequency, which
was left blank on every station, is filled from "no technical issues".
*/

ALTER TABLE charging_stations
  ADD COLUMN IF NOT EXISTS fu_cars_per_day_avg numeric,
  ADD COLUMN IF NOT EXISTS fu_cars_per_day_min int,
  ADD COLUMN IF NOT EXISTS fu_cars_per_day_max int,
  ADD COLUMN IF NOT EXISTS fu_charge_minutes_avg int,
  ADD COLUMN IF NOT EXISTS fu_charge_minutes_min int,
  ADD COLUMN IF NOT EXISTS fu_charge_minutes_max int,
  ADD COLUMN IF NOT EXISTS fu_operator_salary_avg numeric,
  ADD COLUMN IF NOT EXISTS fu_operator_salary_min numeric,
  ADD COLUMN IF NOT EXISTS fu_operator_salary_max numeric,
  ADD COLUMN IF NOT EXISTS fu_shifts_per_day int,
  ADD COLUMN IF NOT EXISTS fu_shift_hours int,
  ADD COLUMN IF NOT EXISTS fu_technical_issues text,
  ADD COLUMN IF NOT EXISTS fu_heat_note text,
  ADD COLUMN IF NOT EXISTS fu_source text,
  ADD COLUMN IF NOT EXISTS fu_recorded_at timestamptz;

UPDATE charging_stations SET
  fu_cars_per_day_avg = 40, fu_cars_per_day_min = 30, fu_cars_per_day_max = 50,
  fu_charge_minutes_avg = 50, fu_charge_minutes_min = 35, fu_charge_minutes_max = 120,
  fu_operator_salary_avg = 120000, fu_operator_salary_min = 85000, fu_operator_salary_max = 150000,
  fu_shifts_per_day = 3, fu_shift_hours = 8,
  fu_technical_issues = 'None so far',
  fu_heat_note = 'Chargers can get hot; they have fans inside',
  fu_source = 'Field follow-up by Henry Rugaba Mark, reported to the MD on 10 Oct 2026 (applies to all stations)',
  fu_recorded_at = now(),
  downtime_frequency = COALESCE(downtime_frequency, 'never'),
  operates_24_7 = true
WHERE case_id = (SELECT id FROM survey_cases WHERE slug = 'charging-stations')
  AND fu_recorded_at IS NULL;
