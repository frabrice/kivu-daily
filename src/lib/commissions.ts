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
//
// Exempt trips (MD, 3 Nov 2026) carry no commission: company trips (e.g.
// CEVR) are paid to Kivu Ride and driven by our own paid drivers. A trip
// tagged to a company is exempt automatically; Finance or the MD can decide
// any trip in the preview (commission_exemptions). Rider names that only
// look like a company ("CEVR", "CVR") are suggestions until someone saves them.

export const COMMISSION_RATE = 0.1;
export const APP_METHODS = ['mobile_money', 'card', 'corporate'];
export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', mobile_money: 'Mobile Money', card: 'Card', corporate: 'Company account' };

export interface Decision { exempt: boolean; reason: string | null; decided_at: string; by: string | null }
export interface CTrip {
  id: number; completed_at: string | null; requested_at: string | null; total_fare: number | null; payment_method: string | null;
  platform_driver_id: number | null; driver_name: string | null; driver_phone: string | null; kivu_driver_id: string | null;
  rider_name: string | null; pickup_address: string | null; destination_address: string | null; day: string;
  company: { client_id: string; name: string; status: string } | null;   // tagged to a company (Trips > Companies)
  decision: Decision | null;                                             // Finance / MD, in the preview
}
export interface Company { id: string; name: string }
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

// PostgREST gives a one-to-one embed as an object, or as a list on some setups.
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Omit<CTrip, 'day' | 'company' | 'decision'> & { company: any; decision: any };

export async function loadCommissions(from: string, to: string) {
  const start = new Date(Date.parse(`${from}T00:00:00+02:00`)).toISOString();
  const end = new Date(Date.parse(`${to}T00:00:00+02:00`) + 86_400_000).toISOString();
  // A few completed trips come from the app with no completion time: they count on the day they were requested.
  const [trips, followups, companies] = await Promise.all([
    all<Raw>(() => supabase.from('platform_trips').select('id, completed_at, requested_at, total_fare, payment_method, platform_driver_id, driver_name, driver_phone, kivu_driver_id, rider_name, pickup_address, destination_address, '
      + 'company:business_client_trips(client_id, status, client:business_clients(name)), decision:commission_exemptions(exempt, reason, decided_at, decider:profiles(full_name))')
      .eq('status', 'completed').or(`and(completed_at.gte.${start},completed_at.lt.${end}),and(completed_at.is.null,requested_at.gte.${start},requested_at.lt.${end})`).order('id')),
    all<Followup>(() => supabase.from('commission_followups').select('id, day, driver_name, driver_phone, amount_owed, outcome, promised_date, amount_paid, created_at').gte('day', from).lte('day', to).order('created_at')),
    all<Company>(() => supabase.from('business_clients').select('id, name').neq('status', 'ended').order('name')),
  ]);
  return {
    trips: trips.map((t): CTrip => {
      const c = one(t.company), d = one(t.decision);
      return {
        ...t, day: kigaliDay(t.completed_at ?? t.requested_at),
        company: c ? { client_id: c.client_id, status: c.status, name: one(c.client)?.name ?? 'a company' } : null,
        decision: d ? { exempt: !!d.exempt, reason: d.reason ?? null, decided_at: d.decided_at, by: one(d.decider)?.full_name?.trim() ?? null } : null,
      };
    }),
    followups, companies,
  };
}

// ------------------------------------------------------------ exemptions
// What applies today: a saved decision, else a company trip is exempt.
export const autoExempt = (t: CTrip) => !!t.company;
export const isExempt = (t: CTrip) => t.decision?.exempt ?? autoExempt(t);
export const companyReason = (name: string) => `Company trip: ${name}`;
export const exemptReason = (t: CTrip) => (t.decision?.exempt ? t.decision.reason ?? '' : t.company ? companyReason(t.company.name) : '');

// A rider name typed like a company's ("CEVR", "cevr", "CVR", "C.E.V.R").
const letters = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
const consonants = (x: string) => x.replace(/[aeiou]/g, '');
export function looksLike(t: CTrip, companies: Company[]): Company | null {
  const r = letters(t.rider_name ?? '');
  if (!r) return null;
  return companies.find((c) => {
    const k = letters(c.name);
    return k.length >= 3 && (r === k || r.includes(k) || (consonants(k).length >= 3 && consonants(r) === consonants(k)));
  }) ?? null;
}

// The trips the page leaves out (id -> reason), as decided today.
export const exemptMap = (trips: CTrip[]) => new Map(trips.filter(isExempt).map((t) => [t.id, exemptReason(t)]));

// Save the preview's choices: only what differs from what applies today.
// A choice equal to the automatic rule needs no row (and removes one).
export async function saveExemptions(trips: CTrip[], picks: Map<number, { exempt: boolean; reason: string }>) {
  const upserts: { trip_id: number; exempt: boolean; reason: string | null }[] = [];
  const removes: number[] = [];
  for (const t of trips) {
    const p = picks.get(t.id);
    if (!p) continue;
    const reason = p.reason.trim();
    if (p.exempt === autoExempt(t)) {
      if (t.decision) removes.push(t.id);
      continue;
    }
    if (t.decision && t.decision.exempt === p.exempt && (t.decision.reason ?? '') === reason) continue;
    upserts.push({ trip_id: t.id, exempt: p.exempt, reason: reason || null });
  }
  if (upserts.length) {
    const { error } = await supabase.from('commission_exemptions').upsert(upserts, { onConflict: 'trip_id' });
    if (error) throw new Error(error.message);
  }
  if (removes.length) {
    const { error } = await supabase.from('commission_exemptions').delete().in('trip_id', removes);
    if (error) throw new Error(error.message);
  }
  return upserts.length + removes.length;
}

// Tag a trip to its company (as Trips > Companies does); it is then exempt automatically.
export async function tagToCompany(tripId: number, clientId: string) {
  const { error } = await supabase.from('business_client_trips').insert({ trip_id: tripId, client_id: clientId, note: 'Added from the commission preview' });
  if (error) throw new Error(error.message);
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
export interface ExemptRow { trip: CTrip; reason: string }
// `exempt`: trip id -> reason. Those trips are listed apart and carry no commission.
export function summarise(all: CTrip[], followups: Followup[], days: string[], exempt: Map<number, string> = new Map()) {
  const trips = all.filter((t) => !exempt.has(t.id));
  const left: ExemptRow[] = all.filter((t) => exempt.has(t.id)).map((t) => ({ trip: t, reason: exempt.get(t.id) || 'Left out' }));
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
    exempt: { rows: left, trips: left.length, fares: left.reduce((n, x) => n + Number(x.trip.total_fare ?? 0), 0) },
    drivers: [...drivers.values()].sort((a, b) => b.owed - a.owed || b.expected - a.expected),
    methods: [...byMethod.entries()].map(([method, x]) => ({ method, ...x })).sort((a, b) => b.commission - a.commission),
  };
}

const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
export const timeOf = (t: CTrip) => {
  const at = t.completed_at ?? t.requested_at;
  return at ? new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' }) : '';
};
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
      ...(s.exempt.trips ? [{ label: 'Exempt trips', value: String(s.exempt.trips), sub: `${money(s.exempt.fares)} in fares, no commission` }] : []),
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
      ...(s.exempt.trips ? [{ title: 'Exempt trips (no commission)', note: 'Company trips are paid to Kivu Ride and driven by our own paid drivers.', columns: [
        { header: 'Day', key: 'day', kind: 'date' as const }, { header: 'Time', key: 'time' }, { header: 'Trip', key: 'id', kind: 'int' as const }, { header: 'Driver', key: 'driver', width: 24 }, { header: 'Rider', key: 'rider', width: 18 },
        { header: 'Fare', key: 'fare', kind: 'money' as const }, { header: 'Paid by', key: 'paidBy' }, { header: 'Reason', key: 'reason', width: 30 },
      ], rows: s.exempt.rows.map(({ trip: t, reason }) => ({
        day: t.day, time: timeOf(t), id: t.id, driver: (t.driver_name ?? '').replace(/\s+/g, ' ').trim(), rider: t.rider_name ?? '', fare: Number(t.total_fare ?? 0),
        paidBy: METHOD_LABEL[t.payment_method ?? 'cash'] ?? t.payment_method ?? '', reason,
      })) }] : []),
    ],
    notes: [
      'Commission is 10% of the final fare of every completed trip, on the day it was completed (or requested, when the app gives no completion time).',
      'Taken by the app: the rider paid through the app (Mobile Money, card) or a company account, so the commission is already in. Cash: the driver holds the fare and owes the 10%.',
      'Recorded paid is what the Call Center records in Commission follow-up. The exact amounts in each driver\'s app wallet need KivuRide to give our key the finance permissions.',
      ...(s.exempt.trips ? ['Exempt trips carry no commission and are not in any total above: company trips (tagged in Trips > Companies) are left out automatically; any other was left out by Finance or the MD, with the reason shown.'] : []),
    ],
  };
}
