// Ours On Shift: which of our drivers (and freelancers) should be driving
// at a given moment, and whether they are online in the Kivu Ride app.
// Shared by the "Ours On Shift" page and the Call Center smart task, so
// they always agree. Pure functions, Kigali time (UTC+2, no summer time).

export type ShiftKey = 'day' | 'night';
export interface ShiftHours { day: { starts: string; ends: string }; night: { starts: string; ends: string } }
export const DEFAULT_HOURS: ShiftHours = { day: { starts: '06:00', ends: '18:00' }, night: { starts: '18:00', ends: '06:00' } };

export interface RosterDriver {
  id: string; full_name: string; phone: string | null; vehicle_id: string | null; plate: string | null;
  shift: 'day' | 'night' | 'full' | null; rest_day: string | null; contract_status: string; start_date: string | null;
  pauses?: { start_date: string; end_date: string | null; approval_status: string }[] | null;
}
export interface RosterFreelance {
  id: string; freelancer_id: string; name: string; phone: string | null; vehicle_id: string; plate: string | null;
  shift: 'day' | 'night' | 'full'; day: string; status: string; covering_driver_id: string | null;
}
export interface Expected {
  key: string; kind: 'driver' | 'freelancer'; driverId: string | null; freelancerId: string | null;
  name: string; phone: string | null; plate: string | null; vehicleId: string | null;
  shift: ShiftKey; day: string; start: number; end: number;
  blocked: string | null;           // not cleared to drive (e.g. unpaid): kept off the road on purpose
}
export interface DriverState {
  platform_driver_id: number; kivu_driver_id: string | null; freelancer_id: string | null; is_online: boolean; driver_status: string | null;
  logged_in: boolean | null; last_seen_at: string | null; last_location_at: string | null; status_since: string; app_version: string | null; vehicle_plate: string | null;
}
export interface LogEntry { platform_driver_id: number; is_online: boolean; at: string }

const OFFSET_MS = 2 * 3600_000;
const REST = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const kigaliDay = (ms: number) => new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
export const kigaliClock = (ms: number) => new Date(ms + OFFSET_MS).toISOString().slice(11, 16);
const at = (day: string, hm: string) => Date.parse(`${day}T${hm.slice(0, 5)}:00+02:00`);
const addDay = (day: string, n: number) => kigaliDay(at(day, '12:00') + n * 86400_000);
const isoWeekday = (day: string) => { const w = new Date(`${day}T12:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };

// The window of a shift that starts on a given day (a night shift ends the next morning).
export function windowOf(hours: ShiftHours, shift: ShiftKey, day: string) {
  const h = hours[shift];
  const start = at(day, h.starts);
  const crosses = h.ends <= h.starts;
  return { start, end: at(crosses ? addDay(day, 1) : day, h.ends) };
}
// Which day's shift is "this" one: the one running now, else the next to start.
export function currentShiftDay(hours: ShiftHours, shift: ShiftKey, now: number): string {
  const today = kigaliDay(now);
  for (const d of [addDay(today, -1), today]) { const w = windowOf(hours, shift, d); if (now >= w.start && now < w.end) return d; }
  return windowOf(hours, shift, today).start > now ? today : addDay(today, 1);
}
export function shiftLabelOf(hours: ShiftHours, shift: ShiftKey) {
  return `${shift === 'day' ? 'Day' : 'Night'} ${hours[shift].starts.slice(0, 5)}–${hours[shift].ends.slice(0, 5)}`;
}

const works = (d: RosterDriver, day: string, shift: ShiftKey) =>
  d.contract_status === 'active' && !!d.vehicle_id && !!d.shift && (d.shift === 'full' || d.shift === shift)
  && (!d.start_date || d.start_date <= day)
  && !(d.rest_day && REST.indexOf(d.rest_day) + 1 === isoWeekday(day))
  && !(d.pauses ?? []).some((p) => p.approval_status !== 'rejected' && p.start_date <= day && (p.end_date === null || day <= p.end_date));

// Everyone expected on one shift (the one starting on `day`): our drivers,
// minus seats a freelancer covers that day, plus the freelancers.
export function expectedFor(hours: ShiftHours, shift: ShiftKey, day: string, drivers: RosterDriver[], freelance: RosterFreelance[], blockedOf?: (driverId: string) => string | null): Expected[] {
  const w = windowOf(hours, shift, day);
  const fl = freelance.filter((f) => f.day === day && (f.shift === 'full' || f.shift === shift) && f.status !== 'cancelled');
  const out: Expected[] = [];
  for (const d of drivers) {
    if (!works(d, day, shift)) continue;
    if (fl.some((f) => f.covering_driver_id === d.id || (!f.covering_driver_id && f.vehicle_id === d.vehicle_id))) continue;
    out.push({ key: `d:${d.id}:${shift}:${day}`, kind: 'driver', driverId: d.id, freelancerId: null, name: d.full_name.trim(), phone: d.phone, plate: d.plate, vehicleId: d.vehicle_id, shift, day, start: w.start, end: w.end, blocked: blockedOf?.(d.id) ?? null });
  }
  for (const f of fl) {
    out.push({ key: `f:${f.id}:${shift}`, kind: 'freelancer', driverId: null, freelancerId: f.freelancer_id, name: f.name.trim(), phone: f.phone, plate: f.plate, vehicleId: f.vehicle_id, shift, day, start: w.start, end: w.end, blocked: null });
  }
  return out;
}

// Everyone whose shift is running right now.
export function expectedNow(hours: ShiftHours, now: number, drivers: RosterDriver[], freelance: RosterFreelance[], blockedOf?: (driverId: string) => string | null): Expected[] {
  const out: Expected[] = [];
  for (const s of ['day', 'night'] as ShiftKey[]) {
    const day = currentShiftDay(hours, s, now);
    const w = windowOf(hours, s, day);
    if (now >= w.start && now < w.end) out.push(...expectedFor(hours, s, day, drivers, freelance, blockedOf));
  }
  // A driver on both shifts is listed once (the shift running now).
  return [...new Map(out.map((e) => [e.driverId ?? e.key, e])).values()];
}

// The driver's (or freelancer's) account in the app: the online one first, then the most recently seen.
export function stateOf(e: Expected, states: DriverState[]): DriverState | null {
  const mine = states.filter((s) => (e.driverId && s.kivu_driver_id === e.driverId) || (e.freelancerId && s.freelancer_id === e.freelancerId));
  return mine.sort((a, b) => Number(b.is_online) - Number(a.is_online) || (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''))[0] ?? null;
}

// Minutes online between from and to, from the online/offline changes.
export function onlineMinutes(platformId: number, log: LogEntry[], nowOnline: boolean, from: number, to: number): number {
  if (to <= from) return 0;
  const mine = log.filter((l) => l.platform_driver_id === platformId).sort((a, b) => a.at.localeCompare(b.at));
  // The state at `from`: the last change before it, else the opposite of the first change after it, else now.
  const before = [...mine].reverse().find((l) => Date.parse(l.at) <= from);
  const firstAfter = mine.find((l) => Date.parse(l.at) > from);
  let on = before ? before.is_online : firstAfter ? !firstAfter.is_online : nowOnline;
  let t = from, total = 0;
  for (const l of mine) {
    const x = Date.parse(l.at);
    if (x <= from) continue;
    if (x >= to) break;
    if (on) total += x - t;
    on = l.is_online; t = x;
  }
  if (on) total += to - t;
  return Math.round(total / 60000);
}

// Grace before someone counts as offline (between trips, a phone restarting...).
export const OFFLINE_GRACE_MIN = 10;
// Online but the app hasn't been heard from for this long: the phone may be off.
export const STALE_MIN = 15;

export type Presence = 'online' | 'stale' | 'offline' | 'not_in_app' | 'blocked';
export function presenceOf(e: Expected, s: DriverState | null, now: number): { presence: Presence; minutes: number } {
  if (e.blocked) return { presence: 'blocked', minutes: 0 };
  if (!s) return { presence: 'not_in_app', minutes: 0 };
  const since = Math.max(Date.parse(s.status_since), e.start);
  const minutes = Math.max(0, Math.round((now - since) / 60000));
  if (s.is_online) {
    const seen = s.last_seen_at ? Math.round((now - Date.parse(s.last_seen_at)) / 60000) : null;
    return seen !== null && seen >= STALE_MIN ? { presence: 'stale', minutes: seen } : { presence: 'online', minutes };
  }
  return { presence: 'offline', minutes };
}
// Needs a call: offline (past the grace) or online with no sign of the app.
export const needsCall = (p: { presence: Presence; minutes: number }) => (p.presence === 'offline' && p.minutes >= OFFLINE_GRACE_MIN) || p.presence === 'stale';
