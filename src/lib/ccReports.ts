import { supabase } from './supabase';
import { CallCenterShift } from './shifts';
import { Dispatch } from './dispatch';
import { kigaliDay as kDayFast, kigaliToday as kTodayFast, kigaliHour } from './kigali';

// Call Center reports (page /call-center/reports): every booking that
// needed a car - app bookings and hotline dispatches - next to the shifts
// and the agents' own shift reports.
//
// Hotline dispatches come from two places: Kivu Daily's Dispatch page
// (dispatches, who booked is recorded) and the KivuRide admin dashboard
// (platform_trips with dispatch_method 'manual'; the admin account says
// who, through kivuride_admin_accounts). App bookings are the riders' own
// (dispatch_method app/auto/passenger_triggered). Trips a driver started
// on the street are not bookings and are left out.
//
// The app does not say yet who cancelled or why, only whether a driver had
// accepted: "no car" = cancelled before any driver accepted.

export type Channel = 'app' | 'hotline';
export type Source = 'app' | 'kivu_daily' | 'dashboard';
export type Outcome = 'completed' | 'cancelled_after' | 'no_car' | 'running' | 'failed';
export const OUTCOME_LABEL: Record<Outcome, string> = { completed: 'Completed', cancelled_after: 'Cancelled after a driver accepted', no_car: 'No car (cancelled before any driver)', running: 'Still running', failed: 'Not booked' };
export const OUTCOME_SHORT: Record<Outcome, string> = { completed: 'Completed', cancelled_after: 'Cancelled after driver', no_car: 'No car', running: 'Running', failed: 'Not booked' };
export const SOURCE_LABEL: Record<Source, string> = { app: 'App', kivu_daily: 'Hotline · Kivu Daily', dashboard: 'Hotline · admin dashboard' };

export interface Booking {
  key: string; channel: Channel; source: Source; at: string; status: string; outcome: Outcome; gotCar: boolean;
  day: string; hour: number;   // Kigali day and hour of `at`, worked out once
  acceptSecs: number | null; refusals: number | null;
  by: string | null;          // the agent who dispatched it (hotline)
  team: boolean;              // hotline from a shared account or none: the team on shift
  adminId: number | null; tripId: number | null;
  client: string | null; phone: string | null; pickup: string | null; destination: string | null;
  driver: string | null; plate: string | null; fare: number | null; vehicleType: string | null;
  dispatch: Dispatch | null;
}
export interface AdminAccount { admin_id: number; profile_id: string | null; kind: 'agent' | 'shared'; note: string | null }
export interface Person { id: string; full_name: string; is_active: boolean; dept: string | null }

interface TripRow {
  id: number; status: string; requested_at: string | null; created_at: string; accepted_at: string | null; dispatch_method: string | null; dispatched_by_admin_id: number | null;
  rejected_driver_count: number | null; rider_name: string | null; rider_phone: string | null; pickup_address: string | null; destination_address: string | null;
  driver_name: string | null; vehicle_plate: string | null; total_fare: number | null; vehicle_type: string | null;
}
const APP_METHODS = ['app', 'auto', 'passenger_triggered'];
const TRIP_COLS = 'id, status, requested_at, created_at, accepted_at, dispatch_method, dispatched_by_admin_id, rejected_driver_count, rider_name, rider_phone, pickup_address, destination_address, driver_name, vehicle_plate, total_fare, vehicle_type';

// The first trip on the platform: "All time" starts here.
export const FIRST_DAY = '2026-05-31';
export const todayK = () => kTodayFast();
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayStart = (day: string) => `${day}T00:00:00+02:00`;
export const dayOf = (iso: string) => kDayFast(iso);
export const hourOf = (iso: string) => kigaliHour(iso);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
// A shift's window: start to end; one still open runs to now (at most 10 h).
export const shiftEnd = (s: CallCenterShift) => s.ended_at ?? new Date(Math.min(Date.now(), Date.parse(s.started_at) + 10 * 3_600_000)).toISOString();
export const inShift = (s: CallCenterShift, iso: string) => iso >= s.started_at && iso <= shiftEnd(s);

function outcomeOf(status: string, accepted: boolean): Outcome {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return accepted ? 'cancelled_after' : 'no_car';
  if (status === 'failed') return 'failed';
  return 'running';
}
const secsBetween = (a: string | null, b: string | null) => { if (!a || !b) return null; const s = (Date.parse(b) - Date.parse(a)) / 1000; return s >= 0 && s < 7200 ? s : null; };

// Calls after trips (migration 20261101170000), as the score needs them.
export interface TripCallLite { id: string; created_at: string; status: string; attempts: number; last_attempt_at: string | null; last_attempt_by: string | null; called_at: string | null; called_by: string | null; outcome: string | null; answer: string | null }
export interface ReportData { people: Person[]; accounts: AdminAccount[]; shifts: CallCenterShift[]; bookings: Booking[]; tripCalls: TripCallLite[] }

// The server returns at most 1000 rows a request: read page after page.
async function all<T>(page: (lo: number, hi: number) => PromiseLike<{ data: T[] | null }>): Promise<{ data: T[] }> {
  const out: T[] = [];
  for (let lo = 0; lo < 50_000; lo += 1000) {
    const { data } = await page(lo, lo + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { data: out };
}

// Everything from `from` to `to` (Kigali days). Shifts start one day early:
// a night shift that began the evening before covers the first hours.
export async function loadReport(from: string, to: string): Promise<ReportData> {
  const start = dayStart(from), end = dayStart(addDays(to, 1));
  const [p, a, s, t, d, tc] = await Promise.all([
    supabase.from('profiles').select('id, full_name, is_active, department:departments(slug)'),
    supabase.from('kivuride_admin_accounts').select('admin_id, profile_id, kind, note'),
    all((lo, hi) => supabase.from('call_center_shifts').select('*').gte('started_at', dayStart(addDays(from, -1))).lt('started_at', end).order('started_at').order('id').range(lo, hi)),
    all((lo, hi) => supabase.from('platform_trips').select(TRIP_COLS).gte('requested_at', start).lt('requested_at', end).in('dispatch_method', [...APP_METHODS, 'manual']).order('id').range(lo, hi)),
    all((lo, hi) => supabase.from('dispatches').select('*').eq('sandbox', false).gte('created_at', start).lt('created_at', end).order('id').range(lo, hi)),
    all((lo, hi) => supabase.from('trip_calls').select('id, created_at, status, attempts, last_attempt_at, last_attempt_by, called_at, called_by, outcome, answer').gte('created_at', dayStart(addDays(from, -1))).lt('created_at', end).order('id').range(lo, hi)),
  ]);
  const people = ((p.data ?? []) as unknown as { id: string; full_name: string; is_active: boolean; department: { slug: string } | null }[])
    .map((x) => ({ id: x.id, full_name: x.full_name.trim(), is_active: x.is_active, dept: x.department?.slug ?? null }));
  const accounts = (a.data as AdminAccount[]) ?? [];
  const byAccount = new Map(accounts.map((x) => [x.admin_id, x]));
  const dispatches = (d.data as Dispatch[]) ?? [];
  const trips = (t.data as TripRow[]) ?? [];
  const tripById = new Map(trips.map((x) => [x.id, x]));
  const fromKd = new Set(dispatches.map((x) => x.platform_trip_id).filter(Boolean) as number[]);

  const bookings: Booking[] = [];
  for (const x of dispatches) {
    const trip = x.platform_trip_id ? tripById.get(x.platform_trip_id) : undefined;
    const accepted = !!x.accepted_at;
    bookings.push({
      key: `kd-${x.id}`, channel: 'hotline', source: 'kivu_daily', at: x.created_at, day: dayOf(x.created_at), hour: hourOf(x.created_at), status: x.status, outcome: outcomeOf(x.status, accepted), gotCar: accepted,
      acceptSecs: secsBetween(x.created_at, x.accepted_at), refusals: trip?.rejected_driver_count ?? null, by: x.created_by, team: false, adminId: null, tripId: x.platform_trip_id,
      client: x.client_name, phone: x.client_phone, pickup: x.pickup_address, destination: x.destination_address, driver: x.driver_name, plate: x.vehicle_plate,
      fare: x.fare ?? x.estimated_fare, vehicleType: x.vehicle_type, dispatch: x,
    });
  }
  for (const x of trips) {
    if (fromKd.has(x.id)) continue;
    const at = x.requested_at ?? x.created_at;
    const manual = x.dispatch_method === 'manual';
    const acc = manual && x.dispatched_by_admin_id != null ? byAccount.get(x.dispatched_by_admin_id) : undefined;
    const accepted = !!x.accepted_at;
    bookings.push({
      key: `pt-${x.id}`, channel: manual ? 'hotline' : 'app', source: manual ? 'dashboard' : 'app', at, day: dayOf(at), hour: hourOf(at), status: x.status, outcome: outcomeOf(x.status, accepted), gotCar: accepted,
      acceptSecs: secsBetween(at, x.accepted_at), refusals: x.rejected_driver_count, by: acc?.kind === 'agent' ? acc.profile_id : null, team: manual && acc?.kind !== 'agent',
      adminId: x.dispatched_by_admin_id, tripId: x.id, client: x.rider_name, phone: x.rider_phone, pickup: x.pickup_address, destination: x.destination_address,
      driver: x.driver_name, plate: x.vehicle_plate, fare: x.total_fare, vehicleType: x.vehicle_type, dispatch: null,
    });
  }
  bookings.sort((x, y) => y.at.localeCompare(x.at));
  return { people, accounts, shifts: (s.data as CallCenterShift[]) ?? [], bookings, tripCalls: (tc.data as TripCallLite[]) ?? [] };
}

// A call after a trip can be made from 07:00 to 21:00 Kigali: one that comes
// in at night is due at 07:00.
export function callableAt(iso: string): string {
  const h = hourOf(iso);
  if (h >= 7 && h < 21) return iso;
  const d = h >= 21 ? addDays(dayOf(iso), 1) : dayOf(iso);
  return new Date(Date.parse(`${d}T07:00:00+02:00`)).toISOString();
}
// When someone first did something with the call (we keep the last try and the conversation).
const touchedAt = (c: TripCallLite) => (c.attempts > 0 ? c.called_at ?? c.last_attempt_at : null);

// ------------------------------------------------------------------ numbers
export interface BookingStats {
  n: number; gotCar: number; completed: number; noCar: number; cancelledAfter: number; running: number; failed: number; pending: number;
  medianWait: number | null; refusals: number; withRefusals: number;
}
export function bookingStats(list: Booking[]): BookingStats {
  const waits = list.map((b) => b.acceptSecs).filter((x): x is number => x != null).sort((a, b) => a - b);
  return {
    n: list.length, gotCar: list.filter((b) => b.gotCar).length, completed: list.filter((b) => b.outcome === 'completed').length,
    noCar: list.filter((b) => b.outcome === 'no_car').length, cancelledAfter: list.filter((b) => b.outcome === 'cancelled_after').length,
    running: list.filter((b) => b.outcome === 'running').length, failed: list.filter((b) => b.outcome === 'failed').length,
    pending: list.filter((b) => b.outcome === 'running' && !b.gotCar).length,
    medianWait: waits.length ? waits[Math.floor(waits.length / 2)] : null,
    refusals: list.reduce((n, b) => n + (b.refusals ?? 0), 0), withRefusals: list.filter((b) => (b.refusals ?? 0) > 0).length,
  };
}
// Share that got a car, out of the bookings whose fate is known (not those still searching, not those never booked).
export const carRate = (s: BookingStats) => { const decided = s.n - s.failed - s.pending; return decided ? Math.round((s.gotCar / decided) * 100) : null; };

// Started more than 4 hours after the shift chosen: the agent picked the wrong shift, not late.
export const wrongSlot = (s: CallCenterShift) => s.late_minutes > 240;

export interface ShiftStats { shifts: number; minutes: number; onTime: number; timed: number; wrongSlot: number; notEnded: number; withReport: number; received: number; made: number; missed: number; contacts: number; solved: number }
export function shiftStats(list: CallCenterShift[]): ShiftStats {
  const minutes = (s: CallCenterShift) => (Date.parse(shiftEnd(s)) - Date.parse(s.started_at)) / 60000;
  const wrote = (s: CallCenterShift) => s.status === 'closed' && [s.report.worked_on, s.report.resolved_summary, s.report.problems, s.report.feedback, s.report.suggestions, s.report.unresolved_summary].some((v) => v && String(v).trim());
  return {
    shifts: list.length, minutes: list.reduce((n, s) => n + minutes(s), 0), onTime: list.filter((s) => s.late_minutes <= 10).length,
    timed: list.filter((s) => !wrongSlot(s)).length, wrongSlot: list.filter(wrongSlot).length,
    notEnded: list.filter((s) => s.status === 'auto_closed').length, withReport: list.filter(wrote).length,
    received: list.reduce((n, s) => n + Number(s.report.calls_received ?? 0), 0), made: list.reduce((n, s) => n + Number(s.report.calls_made ?? 0), 0),
    missed: list.reduce((n, s) => n + Number(s.report.calls_missed ?? 0), 0), contacts: list.reduce((n, s) => n + Number(s.stats.contacts_logged ?? 0), 0),
    solved: list.reduce((n, s) => n + Number(s.stats.solved_on_call ?? 0), 0),
  };
}

// One agent over the period: their shifts, the hotline trips they
// dispatched themselves, the team ones and the app bookings while on shift.
export interface TripCallStats { due: number; madeOnShift: number; byThem: number; reached: number; yes: number }
export interface AgentRow {
  id: string; name: string; active: boolean; sh: ShiftStats; mine: BookingStats; teamHotline: BookingStats; app: BookingStats; calls: TripCallStats;
  score: number | null; parts: { label: string; value: number | null; weight: number }[]; flags: string[];
}
export function agentRows(data: ReportData, shifts: CallCenterShift[], bookings: Booking[]): AgentRow[] {
  const ids = [...new Set(shifts.map((s) => s.agent_id))];
  const name = (id: string) => data.people.find((p) => p.id === id);
  const rows = ids.map((id) => {
    const mineShifts = shifts.filter((s) => s.agent_id === id);
    const during = (b: Booking) => mineShifts.some((s) => inShift(s, b.at));
    const sh = shiftStats(mineShifts);
    const mine = bookingStats(bookings.filter((b) => b.channel === 'hotline' && b.by === id));
    const teamHotline = bookingStats(bookings.filter((b) => b.channel === 'hotline' && b.team && during(b)));
    const app = bookingStats(bookings.filter((b) => b.channel === 'app' && during(b)));
    // Calls after trips that became due during their shifts, and whether
    // they were made on that shift (by them or the colleague on it).
    const dueHere = (data.tripCalls ?? []).map((c) => ({ c, s: mineShifts.find((s) => inShift(s, callableAt(c.created_at))) })).filter((x) => x.s);
    const madeOnShift = dueHere.filter(({ c, s }) => { const t = touchedAt(c); return !!t && inShift(s!, t); }).length;
    const own = (data.tripCalls ?? []).filter((c) => c.called_by === id || (c.last_attempt_by === id && c.attempts > 0));
    const calls: TripCallStats = {
      due: dueHere.length, madeOnShift, byThem: own.length,
      reached: own.filter((c) => c.called_by === id && c.outcome === 'reached').length,
      yes: own.filter((c) => c.called_by === id && ['both', 'branding', 'device'].includes(c.answer ?? '')).length,
    };
    return { id, name: name(id)?.full_name ?? 'Agent', active: name(id)?.is_active ?? true, sh, mine, teamHotline, app, calls, score: null as number | null, parts: [] as AgentRow['parts'], flags: [] as string[] };
  });
  // Yes to branding / device, compared with the team's best (a low rate is normal; what matters is who converts best).
  const yesRate = (r: (typeof rows)[number]) => (r.calls.reached >= 3 ? r.calls.yes / r.calls.reached : null);
  const bestYes = Math.max(0, ...rows.map((r) => yesRate(r) ?? 0));
  // Calls made per hour, compared with the team's best.
  const perHour = (r: (typeof rows)[number]) => (r.sh.minutes ? r.sh.made / (r.sh.minutes / 60) : 0);
  const bestPace = Math.max(0.001, ...rows.map(perHour));
  for (const r of rows) {
    const answered = r.sh.received + r.sh.missed;
    r.parts = [
      { label: 'Started on time', value: r.sh.timed ? (r.sh.onTime / r.sh.timed) * 100 : null, weight: 10 },
      { label: 'Shift reports written', value: r.sh.shifts ? (r.sh.withReport / r.sh.shifts) * 100 : null, weight: 10 },
      { label: 'Calls answered', value: answered ? (r.sh.received / answered) * 100 : null, weight: 10 },
      { label: 'Their dispatches got a car', value: r.mine.n >= 3 ? carRate(r.mine) : null, weight: 20 },
      { label: 'App bookings on their shifts got a car', value: r.app.n >= 3 ? carRate(r.app) : null, weight: 15 },
      { label: 'Calls made per hour (vs the team\'s best)', value: r.sh.minutes ? Math.min(100, (perHour(r) / bestPace) * 100) : null, weight: 10 },
      { label: 'Calls after trips made on their shifts', value: r.calls.due >= 2 ? (r.calls.madeOnShift / r.calls.due) * 100 : null, weight: 15 },
      { label: 'Drivers who said yes to branding / device (vs the team\'s best)', value: yesRate(r) != null && bestYes > 0 ? ((yesRate(r) as number) / bestYes) * 100 : null, weight: 10 },
    ];
    const used = r.parts.filter((p) => p.value != null);
    const w = used.reduce((n, p) => n + p.weight, 0);
    r.score = w >= 30 ? Math.round(used.reduce((n, p) => n + (p.value as number) * p.weight, 0) / w) : null;
    const f: string[] = [];
    if (r.sh.timed && r.sh.onTime / r.sh.timed < 0.8) f.push(`Late on ${r.sh.timed - r.sh.onTime} of ${r.sh.timed} shifts`);
    if (r.sh.wrongSlot) f.push(`Picked the wrong shift ${r.sh.wrongSlot} time${r.sh.wrongSlot === 1 ? '' : 's'}`);
    if (r.sh.notEnded) f.push(`${r.sh.notEnded} shift${r.sh.notEnded === 1 ? '' : 's'} not ended (no report)`);
    if (r.sh.shifts && r.sh.withReport / r.sh.shifts < 0.7) f.push(`Wrote a report on only ${r.sh.withReport} of ${r.sh.shifts} shifts`);
    if (answered >= 10 && r.sh.missed / answered > 0.15) f.push(`Missed ${Math.round((r.sh.missed / answered) * 100)}% of calls`);
    const mr = carRate(r.mine);
    if (r.mine.n >= 3 && mr != null && mr < 60) f.push(`Only ${mr}% of their dispatches got a car`);
    const ar = carRate(r.app);
    if (r.app.n >= 5 && ar != null && ar < 60) f.push(`${r.app.noCar} app bookings on their shifts got no car`);
    if (r.sh.shifts >= 3 && r.mine.n === 0) f.push('No hotline dispatch in the period');
    if (r.calls.due >= 2 && r.calls.madeOnShift / r.calls.due < 0.7) f.push(`${r.calls.due - r.calls.madeOnShift} of ${r.calls.due} calls after trips not made on their shifts`);
    if (r.calls.reached >= 5 && r.calls.yes === 0) f.push(`No yes to branding from ${r.calls.reached} drivers reached`);
    r.flags = f;
  }
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

export const fmtWait = (s: number | null) => (s == null ? '—' : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
