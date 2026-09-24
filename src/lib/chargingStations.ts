import { ChargingStation, ChargingStationGun, GunType, DowntimeFrequency } from './supabase';

// Kivu Ride's own fleet (Geely EX2 and similar Chinese-made EVs) charges
// on GB/T - the connector-compatibility analytics below are built around
// that fact, since it's the whole point of this survey: knowing which
// surveyed stations a Kivu Ride car could actually plug into today.
export const KIVU_FLEET_GUN_TYPE: GunType = 'gbt';

export const GUN_TYPES: { key: GunType; label: string; note: string }[] = [
  { key: 'type2', label: 'Type 2', note: 'AC, 3.7-22kW (up to 43kW). The common slower charger.' },
  { key: 'ccs2', label: 'CCS2 (Combo 2)', note: 'DC fast charging, 50-350kW. Europe\'s dominant fast standard.' },
  { key: 'chademo', label: 'CHAdeMO', note: 'DC, older Japanese standard, being phased out in most markets.' },
  { key: 'gbt', label: 'GB/T', note: "China's own DC standard, up to ~240kW - what Kivu Ride's own fleet uses." },
  { key: 'other', label: 'Other', note: 'Any connector type not listed above.' },
];

export const GUN_TYPE_LABEL: Record<GunType, string> = Object.fromEntries(GUN_TYPES.map((g) => [g.key, g.label])) as Record<GunType, string>;

export const DOWNTIME_OPTIONS: { key: DowntimeFrequency; label: string }[] = [
  { key: 'never', label: 'Never - always up' },
  { key: 'rarely', label: 'Rarely - a few times a year' },
  { key: 'sometimes', label: 'Sometimes - a few times a month' },
  { key: 'often', label: 'Often - weekly or more' },
];

export function fmtRwf(n: number): string {
  return Math.round(n).toLocaleString() + ' RWF';
}

export function marginPerKwh(station: ChargingStation): number {
  return station.selling_price_per_kwh - station.buying_price_per_kwh;
}

export function totalGuns(guns: ChargingStationGun[]): number {
  return guns.reduce((s, g) => s + g.gun_count, 0);
}

export function hasFleetCompatibleGun(guns: ChargingStationGun[]): boolean {
  return guns.some((g) => g.gun_type === KIVU_FLEET_GUN_TYPE);
}

// Rough average kWh drawn per charging session, from session length and
// the power rating of the station's guns - the input a "how much could
// this station earn" projection actually needs, since neither number
// alone (price/kWh, or cars/day) tells you real throughput.
export function estimateKwhPerSession(station: ChargingStation, guns: ChargingStationGun[]): number | null {
  if (!station.avg_session_minutes || guns.length === 0) return null;
  const avgPowerKw = guns.reduce((s, g) => s + (g.power_kw ?? 0) * g.gun_count, 0) / Math.max(totalGuns(guns), 1);
  if (!avgPowerKw) return null;
  return avgPowerKw * (station.avg_session_minutes / 60);
}

export function estimateDailyRevenue(station: ChargingStation, guns: ChargingStationGun[]): number | null {
  const kwhPerSession = estimateKwhPerSession(station, guns);
  if (kwhPerSession === null) return null;
  return kwhPerSession * marginPerKwh(station) * station.cars_per_day;
}
