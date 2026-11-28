import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { DEFAULT_HOURS, LogEntry, RosterDriver, ShiftHours, ShiftKey, expectedFor, kigaliDay, onlineMinutes } from './onShift';

// Driver performance (MD, 28 Nov 2026): every driver on a car we manage -
// how long they are online, the trips they do, and what they do with the
// offers the Kivu Ride app sends them (accept, refuse, let expire).
// Online time comes from our own log (driver-status-sync, every 2 minutes);
// trips and offers from the app (trips-sync, platform_trips and
// platform_trip_offers). All days are Kigali days.

export type Outcome = 'accepted' | 'refused' | 'ignored' | 'dropped' | 'lost' | 'other';
export const OUTCOME: Record<Outcome, { label: string; hint: string }> = {
  accepted: { label: 'Accepted', hint: 'Took the trip' },
  dropped: { label: 'Dropped', hint: 'Accepted, then cancelled' },
  refused: { label: 'Refused', hint: 'Pressed decline' },
  ignored: { label: 'Ignored', hint: 'No answer before the offer ran out' },
  lost: { label: 'Taken by another', hint: 'Another driver accepted first: not counted' },
  other: { label: 'Other', hint: '' },
};
export function outcomeOf(o: { status: string; responded_at: string | null }): Outcome {
  switch (o.status) {
    case 'accepted': return 'accepted';
    case 'rejected': return 'refused';
    case 'cancelled': return 'dropped';
    // The app closes the other offers of a batch when one driver accepts
    // (they get a response time); with none, the driver never answered.
    case 'expired': return o.responded_at ? 'lost' : 'ignored';
    default: return 'other';
  }
}

export interface PerfDriver {
  id: string; name: string; phone: string | null; plate: string | null; vehicleId: string | null;
  shift: 'day' | 'night' | 'full' | null; model: string | null; roster: RosterDriver; accounts: number[];
}
export interface Offer { trip_id: number; platform_driver_id: number; offered_at: string; responded_at: string | null; status: string; rejection_reason: string | null; distance_km: number | null; outcome: Outcome }
export interface Trip { id: number; platform_driver_id: number; status: string; created_at: string; completed_at: string | null; total_fare: number | null; actual_distance_km: number | null; actual_duration_minutes: number | null; pickup_address: string | null; destination_address: string | null }

export interface DayStat {
  day: string;
  shiftMin: number;      // shift hours due that day (0: rest day, day off, before start)
  inShiftMin: number;    // online during those hours
  onlineMin: number;     // online at any time of the day
  trips: number; fare: number; km: number; tripMin: number;
  accepted: number; dropped: number; refused: number; ignored: number; lost: number;
}
export interface DriverStats {
  d: PerfDriver; days: DayStat[]; offers: Offer[]; trips: Trip[]; inApp: boolean;
  // One day only: when they were online, and their shift hours (ms), for the timeline.
  segments: [number, number][]; windows: [number, number][];
  total: Omit<DayStat, 'day'> & { answered: number; offered: number; acceptRate: number | null; shiftShare: number | null; workDays: number; perHour: number | null;
    dueDays: number;          // their hours as whole days (today counts as the part gone by)
    perDayMin: number | null; // online in their hours, per whole day
  };
}

export type Period = 'today' | 'yesterday' | '7d' | '30d';
export const PERIOD_LABEL: Record<Period, string> = { today: 'Today', yesterday: 'Yesterday', '7d': '7 days', '30d': '30 days' };
const DAY = 86400_000;
const dayStart = (day: string) => Date.parse(`${day}T00:00:00+02:00`);
export function daysOf(p: Period, now: number): string[] {
  const today = kigaliDay(now);
  const n = p === '7d' ? 7 : p === '30d' ? 30 : 1;
  const last = p === 'yesterday' ? kigaliDay(dayStart(today) - DAY / 2) : today;
  return Array.from({ length: n }, (_, i) => kigaliDay(dayStart(last) - (n - 1 - i) * DAY + DAY / 2));
}

// Supabase answers 1,000 rows at most per call.
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await q(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// Trips and offers of some app accounts between two moments.
export async function loadActivity(pids: number[], from: number, to: number) {
  if (!pids.length) return { trips: [] as Trip[], offers: [] as Offer[], offersReady: true };
  const [trips, offers] = await Promise.all([
    all<Trip>((a, b) => supabase.from('platform_trips').select('id, platform_driver_id, status, created_at, completed_at, total_fare, actual_distance_km, actual_duration_minutes, pickup_address, destination_address')
      .in('platform_driver_id', pids).eq('status', 'completed').gte('created_at', new Date(from - DAY).toISOString()).lt('created_at', new Date(to).toISOString()).order('created_at').range(a, b)),
    all<Omit<Offer, 'outcome'>>((a, b) => supabase.from('platform_trip_offers').select('trip_id, platform_driver_id, offered_at, responded_at, status, rejection_reason, distance_km')
      .in('platform_driver_id', pids).gte('offered_at', new Date(from).toISOString()).lt('offered_at', new Date(to).toISOString()).order('offered_at').range(a, b))
      // Before the offers table exists (migration 20261128100000), the rest still works.
      .catch(() => null),
  ]);
  return { trips, offers: (offers ?? []).map((o) => ({ ...o, outcome: outcomeOf(o) })), offersReady: offers !== null };
}

// The stretches online between from and to (same rules as onlineMinutes).
export function onlineSegments(platformId: number, log: LogEntry[], nowOnline: boolean, from: number, to: number): [number, number][] {
  if (to <= from) return [];
  const mine = log.filter((l) => l.platform_driver_id === platformId).sort((a, b) => a.at.localeCompare(b.at));
  const before = [...mine].reverse().find((l) => Date.parse(l.at) <= from);
  const firstAfter = mine.find((l) => Date.parse(l.at) > from);
  let on = before ? before.is_online : firstAfter ? !firstAfter.is_online : nowOnline;
  let t = from;
  const out: [number, number][] = [];
  for (const l of mine) {
    const x = Date.parse(l.at);
    if (x <= from) continue;
    if (x >= to) break;
    if (on && x > t) out.push([t, x]);
    on = l.is_online; t = x;
  }
  if (on && to > t) out.push([t, to]);
  return out;
}

// Minutes in one shift, from its start and end times.
function windowOfDay(hours: ShiftHours, sh: ShiftKey) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const a = m(hours[sh].starts), b = m(hours[sh].ends);
  return b > a ? b - a : 1440 - a + b;
}

// Their hours on a day: the whole calendar day for the whole car (day & night,
// Solo car), else their shift starting that day - none on a rest day, a day
// off or before their start.
function hoursOn(d: PerfDriver, hours: ShiftHours, day: string): [number, number][] {
  if (!d.shift) return [];
  if (d.shift === 'full') {
    const working = expectedFor(hours, 'day', day, [d.roster], []).length > 0;
    return working ? [[dayStart(day), dayStart(day) + DAY]] : [];
  }
  return expectedFor(hours, d.shift, day, [d.roster], []).map((e) => [e.start, e.end] as [number, number]);
}

const blank = (day: string): DayStat => ({ day, shiftMin: 0, inShiftMin: 0, onlineMin: 0, trips: 0, fare: 0, km: 0, tripMin: 0, accepted: 0, dropped: 0, refused: 0, ignored: 0, lost: 0 });

// One driver's numbers, day by day. Several app accounts: the most online one counts each moment.
export function statsOf(d: PerfDriver, days: string[], hours: ShiftHours, log: LogEntry[], online: Map<number, boolean>, trips: Trip[], offers: Offer[], now: number): DriverStats {
  const mins = (from: number, to: number) => Math.max(0, ...d.accounts.map((pid) => onlineMinutes(pid, log, online.get(pid) ?? false, from, Math.min(to, now))));
  const mine = new Set(d.accounts);
  const myTrips = trips.filter((t) => mine.has(t.platform_driver_id));
  const myOffers = offers.filter((o) => mine.has(o.platform_driver_id));
  const out = days.map((day) => {
    const s = blank(day);
    const start = dayStart(day);
    // Before their contract started they weren't ours yet: nothing counts.
    if (start > now || (d.roster.start_date && day < d.roster.start_date)) return s;
    s.onlineMin = mins(start, start + DAY);
    for (const [a, b] of hoursOn(d, hours, day)) {
      const end = Math.min(b, now);
      if (end <= a) continue;
      s.shiftMin += Math.round((end - a) / 60000);
      s.inShiftMin += mins(a, end);
    }
    for (const t of myTrips) {
      if (kigaliDay(Date.parse(t.completed_at ?? t.created_at)) !== day) continue;
      s.trips++; s.fare += Number(t.total_fare ?? 0); s.km += Number(t.actual_distance_km ?? 0); s.tripMin += Number(t.actual_duration_minutes ?? 0);
    }
    for (const o of myOffers) {
      if (kigaliDay(Date.parse(o.offered_at)) !== day || o.outcome === 'other') continue;
      s[o.outcome]++;
    }
    return s;
  });
  const sum = out.reduce((t, x) => {
    for (const k of Object.keys(t) as (keyof Omit<DayStat, 'day'>)[]) t[k] += x[k];
    return t;
  }, { ...blank('') } as Omit<DayStat, 'day'> & { day?: string });
  delete sum.day;
  // A full day of their hours: 24h for the whole car (day & night, Solo car), else one shift.
  const fullDay = d.shift === 'full' ? 1440 : d.shift ? windowOfDay(hours, d.shift) : 0;
  const dueDays = fullDay ? sum.shiftMin / fullDay : 0;
  const answered = sum.accepted + sum.dropped;
  const offered = answered + sum.refused + sum.ignored;
  const inDays = new Set(days);
  const one = days.length === 1 ? dayStart(days[0]) : null;
  const windows: [number, number][] = [];
  if (one !== null) {
    // A night shift that started the evening before runs into this morning.
    for (const day of [kigaliDay(one - DAY / 2), days[0]]) for (const [x, y] of hoursOn(d, hours, day)) {
      const a = Math.max(x, one), b = Math.min(y, one + DAY);
      if (b > a) windows.push([a, b]);
    }
  }
  return {
    d, days: out, inApp: d.accounts.length > 0, windows,
    segments: one === null ? [] : d.accounts.flatMap((pid) => onlineSegments(pid, log, online.get(pid) ?? false, one, Math.min(one + DAY, now))),
    offers: myOffers.filter((o) => inDays.has(kigaliDay(Date.parse(o.offered_at)))).reverse(),
    trips: myTrips.filter((t) => inDays.has(kigaliDay(Date.parse(t.completed_at ?? t.created_at)))).reverse(),
    total: {
      ...sum, answered, offered,
      acceptRate: offered ? answered / offered : null,
      shiftShare: sum.shiftMin ? Math.min(1, sum.inShiftMin / sum.shiftMin) : null,
      workDays: out.filter((x) => x.shiftMin > 0).length,
      perHour: sum.onlineMin >= 30 ? sum.trips / (sum.onlineMin / 60) : null,
      dueDays, perDayMin: dueDays >= 0.05 ? sum.inShiftMin / dueDays : null,
    },
  };
}

// Every driver on a car we manage (active contract, on a car), with their app accounts.
export function useDriverPerformance(period: Period) {
  const [state, setState] = useState<{ stats: DriverStats[]; days: string[]; hours: ShiftHours; offersSince: string | null; offersPending: number; offersReady: boolean; now: number } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const now = Date.now();
      const days = daysOf(period, now);
      const from = dayStart(days[0]);
      const to = Math.min(now, dayStart(days[days.length - 1]) + DAY);
      const [drv, acc, hrs, first, pending] = await Promise.all([
        supabase.from('drivers').select('id, full_name, phone, start_date, rest_day, contract_status, vehicle_id, shift, model, vehicle:vehicles(plate_number), pauses:driver_pauses(start_date, end_date, approval_status)').eq('contract_status', 'active').not('vehicle_id', 'is', null),
        supabase.from('platform_driver_status').select('platform_driver_id, kivu_driver_id, is_online').not('kivu_driver_id', 'is', null),
        supabase.from('fleet_shift_hours').select('shift, starts, ends'),
        supabase.from('platform_trip_offers').select('offered_at').order('offered_at').limit(1).maybeSingle(),
        supabase.from('platform_trips').select('id', { count: 'exact', head: true }).in('status', ['completed', 'cancelled']).is('offers_read_at', null),
      ]);
      if (drv.error) throw new Error(drv.error.message);
      const hours: ShiftHours = { day: { ...DEFAULT_HOURS.day }, night: { ...DEFAULT_HOURS.night } };
      for (const x of (hrs.data ?? []) as { shift: ShiftKey; starts: string; ends: string }[]) hours[x.shift] = { starts: x.starts.slice(0, 5), ends: x.ends.slice(0, 5) };
      const accounts = (acc.data ?? []) as { platform_driver_id: number; kivu_driver_id: string; is_online: boolean }[];
      const online = new Map(accounts.map((a) => [a.platform_driver_id, a.is_online]));
      type Row = { id: string; full_name: string; phone: string | null; start_date: string | null; rest_day: string | null; contract_status: string; vehicle_id: string | null; shift: PerfDriver['shift']; model: string | null; vehicle: { plate_number: string } | null; pauses: RosterDriver['pauses'] };
      const drivers: PerfDriver[] = ((drv.data ?? []) as unknown as Row[]).map((x) => ({
        id: x.id, name: x.full_name.trim(), phone: x.phone, plate: x.vehicle?.plate_number ?? null, vehicleId: x.vehicle_id, shift: x.shift, model: x.model,
        accounts: accounts.filter((a) => a.kivu_driver_id === x.id).map((a) => a.platform_driver_id),
        roster: { id: x.id, full_name: x.full_name, phone: x.phone, vehicle_id: x.vehicle_id, plate: x.vehicle?.plate_number ?? null, shift: x.shift, rest_day: x.rest_day, contract_status: x.contract_status, start_date: x.start_date, pauses: x.pauses },
      }));
      const pids = drivers.flatMap((x) => x.accounts);
      // The online log from a day before (to know who was online when the period began).
      const [log, act] = await Promise.all([
        pids.length ? all<LogEntry>((a, b) => supabase.from('driver_online_log').select('platform_driver_id, is_online, at').in('platform_driver_id', pids).gte('at', new Date(from - DAY).toISOString()).order('at').range(a, b)) : Promise.resolve([]),
        loadActivity(pids, from, to),
      ]);
      setState({
        stats: drivers.map((x) => statsOf(x, days, hours, log, online, act.trips, act.offers, now)),
        days, hours, now,
        offersSince: (first.data as { offered_at: string } | null)?.offered_at ?? null,
        offersPending: pending.error ? 0 : pending.count ?? 0,
        offersReady: act.offersReady,
      });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [period]);
  useEffect(() => {
    setState(null);
    load();
    const t = window.setInterval(load, 120_000);
    return () => window.clearInterval(t);
  }, [load]);
  return { data: state, error, reload: load };
}

export const hm = (min: number) => { const m = Math.round(min); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`; };
export const pctText = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
