import { ChargingStation } from './supabase';
import { GUN_TYPE_LABEL, KIVU_FLEET_GUN_TYPE, marginPerKwh, totalGuns } from './chargingStations';

// The charging-station analysis, computed once and shared by the Analytics
// tab and both downloadable PDFs so every number agrees.
//
// Two sources are kept apart on purpose:
// - "Reported": what the collector typed into the survey form per station.
// - "Field follow-up": Mark's later figures (cars/day 30-50 avg 40, charge
//   time 35-120 min avg 50, operator salary 85k-150k avg 120k, 3 x 8h shifts).
// Anything not measured is an ASSUMPTION the MD can change (energy per
// charge, operators per shift) and is labelled as such everywhere.

export interface Assumptions {
  kwhPerSession: number;      // energy delivered per car charge
  operatorsPerShift: number;  // people on duty per 8h shift
  daysPerMonth: number;
}
export const DEFAULT_ASSUMPTIONS: Assumptions = { kwhPerSession: 20, operatorsPerShift: 1, daysPerMonth: 30 };
export const KWH_SCENARIOS = [10, 20, 30];

// Type 2 is AC: 3.7-22 kW typical, 43 kW at most.
const TYPE2_MAX_KW = 43;
const MIN_PER_DAY = 1440;

export interface StationMetrics {
  s: ChargingStation;
  label: string;               // "#3 Prevrwanda · Nyarugenge"
  guns: number;
  sell: number;
  buy: number;
  margin: number;
  markupPct: number;
  reportedCars: number;
  reportedSession: number | null;
  capacityAtReported: number | null;   // max cars/day at the reported session length
  reportedOverCapacity: boolean;
  fieldCars: number; fieldCarsMin: number; fieldCarsMax: number;
  fieldMinutes: number;
  capacityAtField: number;             // max cars/day at the field average charge time
  utilisation: number;                 // share of gun-time used at the field average
  kwhDay: number;
  revenueDay: number;
  energyCostDay: number;
  grossMarginDay: number;
  staffMonth: number; staffMonthMin: number; staffMonthMax: number;
  netMonth: number; netMonthLow: number; netMonthHigh: number;
  powerIssue: string | null;
}

export interface DataIssue { severity: 'high' | 'medium' | 'low'; title: string; detail: string; stations: string[] }

export interface StationAnalysis {
  a: Assumptions;
  stations: StationMetrics[];
  n: number;
  totalGuns: number;
  totalChargers: number;
  avgSell: number; minSell: number; maxSell: number;
  avgBuy: number;
  avgMargin: number; minMargin: number; maxMargin: number;
  avgMarkupPct: number;
  reportedCarsTotal: number;
  reportedCarsAvg: number;
  fieldCarsAvg: number; fieldCarsMin: number; fieldCarsMax: number;
  fieldMinutesAvg: number; fieldMinutesMin: number; fieldMinutesMax: number;
  salaryAvg: number; salaryMin: number; salaryMax: number;
  shifts: number; shiftHours: number;
  networkCarsDay: number; networkCarsDayMin: number; networkCarsDayMax: number;
  networkKwhDay: number;
  networkRevenueMonth: number;
  networkGrossMarginMonth: number;
  networkStaffMonth: number;
  networkNetMonth: number;
  avgUtilisation: number;
  overCapacityCount: number;
  stations247: number;
  owners: { owner: string; stations: number; guns: number }[];
  gunTypes: { type: string; guns: number }[];
  fleetCompatibleStations: number;
  publicPremiumPerKwh: number;   // what a public station charges above the grid tariff
  issues: DataIssue[];
  findings: string[];
  collectedBy: string[];
  firstDate: string | null; lastDate: string | null;
  followupSource: string | null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function stationLabel(s: ChargingStation) {
  return `#${s.station_number} ${s.owner_brand} · ${s.location_name}`;
}

export function analyseStations(list: ChargingStation[], a: Assumptions = DEFAULT_ASSUMPTIONS): StationAnalysis {
  const stations: StationMetrics[] = list.map((s) => {
    const guns = Math.max(totalGuns(s.guns ?? []), 1);
    const margin = marginPerKwh(s);
    const fieldCars = Number(s.fu_cars_per_day_avg ?? s.cars_per_day);
    const fieldCarsMin = Number(s.fu_cars_per_day_min ?? fieldCars);
    const fieldCarsMax = Number(s.fu_cars_per_day_max ?? fieldCars);
    const fieldMinutes = Number(s.fu_charge_minutes_avg ?? s.avg_session_minutes ?? 60);
    const capacityAtReported = s.avg_session_minutes ? (guns * MIN_PER_DAY) / s.avg_session_minutes : null;
    const capacityAtField = (guns * MIN_PER_DAY) / fieldMinutes;
    const kwhDay = fieldCars * a.kwhPerSession;
    const staffPeople = (s.fu_shifts_per_day ?? 3) * a.operatorsPerShift;
    const staffMonth = staffPeople * Number(s.fu_operator_salary_avg ?? 0);
    const staffMonthMin = staffPeople * Number(s.fu_operator_salary_min ?? 0);
    const staffMonthMax = staffPeople * Number(s.fu_operator_salary_max ?? 0);
    const grossMarginDay = kwhDay * margin;
    const type2Over = (s.guns ?? []).filter((g) => g.gun_type === 'type2' && (g.power_kw ?? 0) > TYPE2_MAX_KW);
    const powerMissing = (s.guns ?? []).every((g) => !g.power_kw);
    return {
      s, label: stationLabel(s), guns,
      sell: s.selling_price_per_kwh, buy: s.buying_price_per_kwh, margin,
      markupPct: s.buying_price_per_kwh ? margin / s.buying_price_per_kwh : 0,
      reportedCars: s.cars_per_day, reportedSession: s.avg_session_minutes,
      capacityAtReported, reportedOverCapacity: capacityAtReported !== null && s.cars_per_day > capacityAtReported,
      fieldCars, fieldCarsMin, fieldCarsMax, fieldMinutes, capacityAtField,
      utilisation: (fieldCars * fieldMinutes) / (guns * MIN_PER_DAY),
      kwhDay, revenueDay: kwhDay * s.selling_price_per_kwh, energyCostDay: kwhDay * s.buying_price_per_kwh, grossMarginDay,
      staffMonth, staffMonthMin, staffMonthMax,
      netMonth: grossMarginDay * a.daysPerMonth - staffMonth,
      netMonthLow: fieldCarsMin * a.kwhPerSession * margin * a.daysPerMonth - staffMonthMax,
      netMonthHigh: fieldCarsMax * a.kwhPerSession * margin * a.daysPerMonth - staffMonthMin,
      powerIssue: type2Over.length ? `Type 2 recorded at ${type2Over.map((g) => `${g.power_kw} kW`).join(', ')} — Type 2 is AC and tops out at ${TYPE2_MAX_KW} kW` : powerMissing ? 'Charger power not recorded' : null,
    };
  });

  const n = stations.length;
  const sells = stations.map((m) => m.sell);
  const margins = stations.map((m) => m.margin);
  const first = list[0];

  const ownerMap = new Map<string, { owner: string; stations: number; guns: number }>();
  for (const m of stations) {
    const key = m.s.owner_brand.trim().toUpperCase() === 'EVP' ? 'EVP' : m.s.owner_brand.trim();
    const o = ownerMap.get(key.toLowerCase()) ?? { owner: key, stations: 0, guns: 0 };
    o.stations += 1; o.guns += m.guns;
    ownerMap.set(key.toLowerCase(), o);
  }
  const gunMap = new Map<string, number>();
  for (const s of list) for (const g of s.guns ?? []) gunMap.set(GUN_TYPE_LABEL[g.gun_type], (gunMap.get(GUN_TYPE_LABEL[g.gun_type]) ?? 0) + g.gun_count);

  const over = stations.filter((m) => m.reportedOverCapacity);
  const powerIssues = stations.filter((m) => m.powerIssue?.startsWith('Type 2'));
  const powerMissing = stations.filter((m) => m.powerIssue === 'Charger power not recorded');
  const brandLooksLikeConnector = stations.filter((m) => /^(gb\/t|bb\/t|dc ev)$/i.test((m.s.charger_brand ?? '').trim()));
  const allType2 = list.length > 0 && list.every((s) => (s.guns ?? []).every((g) => g.gun_type === 'type2'));
  const sameBuy = new Set(list.map((s) => s.buying_price_per_kwh)).size === 1;

  const issues: DataIssue[] = [];
  if (over.length) issues.push({
    severity: 'high', title: `${over.length} of ${n} stations report more cars a day than their guns can physically charge`,
    detail: 'Max cars a day = guns × 1,440 minutes ÷ the reported charging time. The reported figure is above that limit, so it cannot be a real daily count. The analysis uses Mark\'s field follow-up (30–50 cars a day, average 40) instead.',
    stations: over.map((m) => `${m.label}: reported ${m.reportedCars}/day, max ${Math.floor(m.capacityAtReported!)}/day`),
  });
  if (allType2) issues.push({
    severity: 'high', title: 'Every gun is recorded as Type 2 (AC) — connector types need checking',
    detail: 'All 13 stations list only Type 2. Several power ratings and charger brands point to DC (GB/T) chargers instead, so the "fleet-compatible" (GB/T) count is probably understated. Ask Mark to confirm the connector on each station, with a photo of the plug.',
    stations: [...new Set([...powerIssues, ...brandLooksLikeConnector].map((m) => `${m.label}: ${m.powerIssue ?? `charger brand recorded as "${m.s.charger_brand}"`}`))],
  });
  if (powerMissing.length) issues.push({
    severity: 'medium', title: `Charger power missing on ${powerMissing.length} stations`,
    detail: 'Without kW we cannot measure how much energy a 50-minute charge delivers, so energy per charge is an assumption (default 20 kWh) — see the sensitivity chart.',
    stations: powerMissing.map((m) => m.label),
  });
  if (sameBuy) issues.push({
    severity: 'low', title: `Buying price is ${rwf(list[0]?.buying_price_per_kwh ?? 0)}/kWh at every station`,
    detail: 'Consistent with one grid tariff for all operators. Worth confirming against the current REG/EUCL tariff for commercial chargers.',
    stations: [],
  });
  issues.push({
    severity: 'low', title: 'Field follow-up applies one range to all stations',
    detail: 'Mark\'s cars-a-day, charging-time and salary figures are the same for every station, so per-station differences in the analysis come only from guns and prices. Station-by-station counts would sharpen it.',
    stations: [],
  });

  const avgSell = avg(sells);
  const avgBuy = avg(list.map((s) => s.buying_price_per_kwh));
  const networkCarsDay = stations.reduce((t, m) => t + m.fieldCars, 0);
  const networkKwhDay = networkCarsDay * a.kwhPerSession;
  const networkRevenueMonth = stations.reduce((t, m) => t + m.revenueDay, 0) * a.daysPerMonth;
  const networkGrossMarginMonth = stations.reduce((t, m) => t + m.grossMarginDay, 0) * a.daysPerMonth;
  const networkStaffMonth = stations.reduce((t, m) => t + m.staffMonth, 0);
  const cheapest = [...stations].sort((x, y) => x.sell - y.sell)[0];
  const dearest = [...stations].sort((x, y) => y.sell - x.sell)[0];
  const typicalNet = avg(stations.map((m) => m.netMonth));
  const staffShare = networkGrossMarginMonth ? networkStaffMonth / networkGrossMarginMonth : 0;
  const breakEvenCars = (m: StationMetrics) => (m.margin > 0 ? m.staffMonth / (a.daysPerMonth * a.kwhPerSession * m.margin) : Infinity);
  const avgBreakEven = avg(stations.map(breakEvenCars).filter(isFinite));

  const findings = n === 0 ? [] : [
    `Public charging in Kigali sells at ${rwf(avgSell)}/kWh on average (${rwf(Math.min(...sells))} at ${cheapest.label} to ${rwf(Math.max(...sells))} at ${dearest.label}), against a buying price of ${rwf(avgBuy)}/kWh — a gross margin of ${rwf(avg(margins))}/kWh, a ${pct(avg(margins) / avgBuy)} mark-up.`,
    `At Mark's field average of ${stations[0].fieldCars} cars a day and ${stations[0].fieldMinutes}-minute charges, the 13 stations serve about ${Math.round(networkCarsDay).toLocaleString('en-US')} charges a day (${(n * stations[0].fieldCarsMin).toLocaleString('en-US')}–${(n * stations[0].fieldCarsMax).toLocaleString('en-US')}).`,
    `Guns are busy ${pct(avg(stations.map((m) => m.utilisation)))} of the day on average at that demand; two-gun stations are the busiest (${pct(Math.max(...stations.map((m) => m.utilisation)))}), so they are where queues form first.`,
    `With an assumed ${a.kwhPerSession} kWh per charge, a typical station makes about ${rwf(avg(stations.map((m) => m.grossMarginDay * a.daysPerMonth)))} a month in energy margin. Three operators on 8-hour shifts cost about ${rwf(avg(stations.map((m) => m.staffMonth)))} a month — ${pct(staffShare)} of that margin.`,
    `After operator salaries (but before rent, maintenance, equipment and financing, which were not collected), a typical station clears about ${rwf(typicalNet)} a month. Salaries are covered from about ${Math.ceil(avgBreakEven)} cars a day.`,
    `For Kivu Ride's own cars, every kWh bought at a public station costs ${rwf(avgSell - avgBuy)} more than the grid price — about ${rwf((avgSell - avgBuy) * a.kwhPerSession)} per ${a.kwhPerSession} kWh charge.`,
    `All stations run 24 hours on 3 shifts; operators report no technical issues so far. Chargers get hot but have built-in fans.`,
    over.length ? `Data quality: ${over.length} stations reported daily car counts above what their guns can physically serve; those counts are excluded from the economics.` : '',
  ].filter(Boolean);

  const dates = list.map((s) => s.created_at.slice(0, 10)).sort();
  return {
    a, stations, n,
    totalGuns: stations.reduce((t, m) => t + m.guns, 0),
    totalChargers: list.reduce((t, s) => t + s.num_chargers, 0),
    avgSell, minSell: n ? Math.min(...sells) : 0, maxSell: n ? Math.max(...sells) : 0,
    avgBuy,
    avgMargin: avg(margins), minMargin: n ? Math.min(...margins) : 0, maxMargin: n ? Math.max(...margins) : 0,
    avgMarkupPct: avgBuy ? avg(margins) / avgBuy : 0,
    reportedCarsTotal: list.reduce((t, s) => t + s.cars_per_day, 0),
    reportedCarsAvg: avg(list.map((s) => s.cars_per_day)),
    fieldCarsAvg: first ? Number(first.fu_cars_per_day_avg ?? 0) : 0,
    fieldCarsMin: first ? Number(first.fu_cars_per_day_min ?? 0) : 0,
    fieldCarsMax: first ? Number(first.fu_cars_per_day_max ?? 0) : 0,
    fieldMinutesAvg: first ? Number(first.fu_charge_minutes_avg ?? 0) : 0,
    fieldMinutesMin: first ? Number(first.fu_charge_minutes_min ?? 0) : 0,
    fieldMinutesMax: first ? Number(first.fu_charge_minutes_max ?? 0) : 0,
    salaryAvg: first ? Number(first.fu_operator_salary_avg ?? 0) : 0,
    salaryMin: first ? Number(first.fu_operator_salary_min ?? 0) : 0,
    salaryMax: first ? Number(first.fu_operator_salary_max ?? 0) : 0,
    shifts: first?.fu_shifts_per_day ?? 3, shiftHours: first?.fu_shift_hours ?? 8,
    networkCarsDay, networkCarsDayMin: stations.reduce((t, m) => t + m.fieldCarsMin, 0), networkCarsDayMax: stations.reduce((t, m) => t + m.fieldCarsMax, 0),
    networkKwhDay, networkRevenueMonth, networkGrossMarginMonth, networkStaffMonth,
    networkNetMonth: networkGrossMarginMonth - networkStaffMonth,
    avgUtilisation: avg(stations.map((m) => m.utilisation)),
    overCapacityCount: over.length,
    stations247: list.filter((s) => s.operates_24_7).length,
    owners: [...ownerMap.values()].sort((x, y) => y.stations - x.stations || y.guns - x.guns),
    gunTypes: [...gunMap].map(([type, guns]) => ({ type, guns })),
    fleetCompatibleStations: list.filter((s) => (s.guns ?? []).some((g) => g.gun_type === KIVU_FLEET_GUN_TYPE)).length,
    publicPremiumPerKwh: avgSell - avgBuy,
    issues, findings,
    collectedBy: [...new Set(list.map((s) => s.submitted_by_email))],
    firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null,
    followupSource: first?.fu_source ?? null,
  };
}

// Monthly net per station across demand, for each energy-per-charge scenario.
export function sensitivity(an: StationAnalysis): { cars: number; [k: string]: number }[] {
  const out: { cars: number; [k: string]: number }[] = [];
  const margin = an.avgMargin;
  const staff = avg(an.stations.map((m) => m.staffMonth));
  for (let cars = 20; cars <= 60; cars += 5) {
    const row: { cars: number; [k: string]: number } = { cars };
    for (const k of KWH_SCENARIOS) row[`k${k}`] = Math.round(cars * k * margin * an.a.daysPerMonth - staff);
    out.push(row);
  }
  return out;
}
