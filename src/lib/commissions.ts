import { supabase } from './supabase';
import { kigaliDay } from './kigali';
import type { Report } from './fleetExports';

// Commissions (page /trips/commissions): 10% of every completed trip
// (MD, 31 Oct 2026 - all trips owe it).
//
// - Taken by the app: trips paid by Mobile Money, card or a company
//   account - the money reached the app, so the commission is in.
// - Cash commission: the driver holds the cash fare and owes the 10%.
// - Recorded paid: what the Call Center records in Commission follow-up.
// - Still to collect: cash commission minus recorded paid.
// The exact per-driver wallet (paid / owed in the app) needs our key to get
// finance.view + driver_finance.view from KivuRide; until then "paid" is
// what is recorded here.

export const COMMISSION_RATE = 0.1;
export const APP_METHODS = ['mobile_money', 'card', 'corporate'];
export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', mobile_money: 'Mobile Money', card: 'Card', corporate: 'Company account' };

export interface CTrip { id: number; completed_at: string | null; requested_at: string | null; total_fare: number | null; payment_method: string | null; platform_driver_id: number | null; driver_name: string | null; driver_phone: string | null; kivu_driver_id: string | null; day: string }
export interface Followup { id: string; day: string; driver_name: string; driver_phone: string | null; amount_owed: number; outcome: string; promised_date: string | null; amount_paid: number | null; created_at: string }

const phoneKey = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-9);
const nameKey = (n: string | null | undefined) => (n ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
export const isCash = (t: CTrip) => !APP_METHODS.includes(t.payment_method ?? 'cash');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all<T>(make: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let lo = 0; ; lo += 1000) {
    const { data, error } = await make().range(lo, lo + 999);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export async function loadCommissions(from: string, to: string) {
  const start = new Date(Date.parse(`${from}T00:00:00+02:00`)).toISOString();
  const end = new Date(Date.parse(`${to}T00:00:00+02:00`) + 86_400_000).toISOString();
  // A few completed trips come from the app with no completion time: they count on the day they were requested.
  const [trips, followups] = await Promise.all([
    all<Omit<CTrip, 'day'>>(() => supabase.from('platform_trips').select('id, completed_at, requested_at, total_fare, payment_method, platform_driver_id, driver_name, driver_phone, kivu_driver_id')
      .eq('status', 'completed').or(`and(completed_at.gte.${start},completed_at.lt.${end}),and(completed_at.is.null,requested_at.gte.${start},requested_at.lt.${end})`).order('id')),
    all<Followup>(() => supabase.from('commission_followups').select('id, day, driver_name, driver_phone, amount_owed, outcome, promised_date, amount_paid, created_at').gte('day', from).lte('day', to).order('created_at')),
  ]);
  return { trips: trips.map((t) => ({ ...t, day: kigaliDay(t.completed_at ?? t.requested_at) })), followups };
}

export interface Totals { trips: number; fares: number; expected: number; byApp: number; cash: number; paid: number; owed: number }
const zero = (): Totals => ({ trips: 0, fares: 0, expected: 0, byApp: 0, cash: 0, paid: 0, owed: 0 });
const add = (s: Totals, t: CTrip) => {
  const fare = Number(t.total_fare ?? 0), c = fare * COMMISSION_RATE;
  s.trips++; s.fares += fare; s.expected += c;
  if (isCash(t)) s.cash += c; else s.byApp += c;
};
const finish = (s: Totals) => { s.owed = Math.max(0, s.cash - s.paid); return s; };

export interface DriverRow extends Totals { key: string; name: string; phone: string | null; ours: boolean; cashTrips: number; last: Followup | null }
export function summarise(trips: CTrip[], followups: Followup[], days: string[]) {
  const total = zero();
  const byDay = new Map(days.map((d) => [d, zero()]));
  const drivers = new Map<string, DriverRow>();
  for (const t of trips) {
    add(total, t);
    const d = byDay.get(t.day); if (d) add(d, t);
    const key = phoneKey(t.driver_phone) || `#${t.platform_driver_id ?? nameKey(t.driver_name)}`;
    let r = drivers.get(key);
    if (!r) { r = { key, name: (t.driver_name ?? 'Unknown driver').replace(/\s+/g, ' ').trim(), phone: t.driver_phone, ours: !!t.kivu_driver_id, cashTrips: 0, last: null, ...zero() }; drivers.set(key, r); }
    add(r, t);
    if (isCash(t)) r.cashTrips++;
    if (t.kivu_driver_id) r.ours = true;
  }
  // Paid as recorded by the Call Center, matched to the driver by phone (else name).
  const byName = new Map([...drivers.values()].map((r) => [nameKey(r.name), r]));
  for (const f of followups) {
    const paid = Number(f.amount_paid ?? 0);
    const r = drivers.get(phoneKey(f.driver_phone)) ?? byName.get(nameKey(f.driver_name));
    if (r) { r.paid += paid; if (!r.last || f.created_at > r.last.created_at) r.last = f; }
    total.paid += paid;
    const d = byDay.get(f.day); if (d) d.paid += paid;
  }
  finish(total);
  byDay.forEach(finish);
  drivers.forEach(finish);
  const byMethod = new Map<string, { trips: number; fares: number; commission: number }>();
  for (const t of trips) {
    const m = t.payment_method ?? 'cash';
    const x = byMethod.get(m) ?? { trips: 0, fares: 0, commission: 0 };
    x.trips++; x.fares += Number(t.total_fare ?? 0); x.commission += Number(t.total_fare ?? 0) * COMMISSION_RATE;
    byMethod.set(m, x);
  }
  return {
    total, days: [...byDay.entries()].map(([day, s]) => ({ day, ...s })),
    drivers: [...drivers.values()].sort((a, b) => b.owed - a.owed || b.expected - a.expected),
    methods: [...byMethod.entries()].map(([method, x]) => ({ method, ...x })).sort((a, b) => b.commission - a.commission),
  };
}

const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
export function commissionReport(s: ReturnType<typeof summarise>, from: string, to: string, period: string): Report {
  return {
    title: 'Commissions', subtitle: period, from, to,
    kpis: [
      { label: 'Completed trips', value: String(s.total.trips), sub: money(s.total.fares) + ' in fares' },
      { label: 'Expected (10%)', value: money(s.total.expected) },
      { label: 'Taken by the app', value: money(s.total.byApp), sub: 'Mobile Money, card, company' },
      { label: 'Cash commission', value: money(s.total.cash), sub: 'drivers must pay it' },
      { label: 'Recorded paid', value: money(s.total.paid) },
      { label: 'Still to collect', value: money(s.total.owed) },
    ],
    sections: [
      { title: 'By driver', red: (r) => Number(r.owed) > 0, columns: [
        { header: 'Driver', key: 'name', width: 26 }, { header: 'Phone', key: 'phone', width: 14 }, { header: 'Ours', key: 'ours' }, { header: 'Trips', key: 'trips', kind: 'int' }, { header: 'Cash trips', key: 'cashTrips', kind: 'int' },
        { header: 'Fares', key: 'fares', kind: 'money' }, { header: 'Expected', key: 'expected', kind: 'money' }, { header: 'Taken by the app', key: 'byApp', kind: 'money' },
        { header: 'Cash commission', key: 'cash', kind: 'money' }, { header: 'Recorded paid', key: 'paid', kind: 'money' }, { header: 'Still to collect', key: 'owed', kind: 'money' }, { header: 'Last follow-up', key: 'last', width: 26 },
      ], rows: s.drivers.map((r) => ({ ...r, ours: r.ours ? 'Yes' : '', last: r.last ? `${r.last.day} · ${r.last.outcome.replace(/_/g, ' ')}${r.last.promised_date ? ` (promised ${r.last.promised_date})` : ''}` : '' })) as never },
      { title: 'By day', columns: [
        { header: 'Day', key: 'day', kind: 'date' }, { header: 'Trips', key: 'trips', kind: 'int' }, { header: 'Fares', key: 'fares', kind: 'money' }, { header: 'Expected', key: 'expected', kind: 'money' },
        { header: 'Taken by the app', key: 'byApp', kind: 'money' }, { header: 'Cash commission', key: 'cash', kind: 'money' }, { header: 'Recorded paid', key: 'paid', kind: 'money' }, { header: 'Still to collect', key: 'owed', kind: 'money' },
      ], rows: s.days.filter((d) => d.trips || d.paid) as never },
      { title: 'By payment method', columns: [
        { header: 'Paid by', key: 'label' }, { header: 'Trips', key: 'trips', kind: 'int' }, { header: 'Fares', key: 'fares', kind: 'money' }, { header: 'Commission 10%', key: 'commission', kind: 'money' },
      ], rows: s.methods.map((m) => ({ ...m, label: METHOD_LABEL[m.method] ?? m.method })) as never },
    ],
    notes: [
      'Commission is 10% of the final fare of every completed trip, on the day it was completed (or requested, when the app gives no completion time).',
      'Taken by the app: the rider paid through the app (Mobile Money, card) or a company account, so the commission is already in. Cash: the driver holds the fare and owes the 10%.',
      'Recorded paid is what the Call Center records in Commission follow-up. The exact amounts in each driver\'s app wallet need KivuRide to give our key the finance permissions.',
    ],
  };
}
