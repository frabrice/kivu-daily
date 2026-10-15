import { Driver, DriverCarAssignment, DriverDeposit, FinanceTransaction, PauseReason, Vehicle } from './supabase';
import { dailyRateOn, isoWeekday, mondayOf, pauseOn, DAILY_DEPOSIT_RATE } from '../../supabase/functions/_shared/depositRules';
import { addDays, endDateOf, PerfEvent } from './performance';
import { WEEKLY_COLLECTION_TARGET, WEEKLY_OWNER_PAYOUT_DEFAULT, MONTHLY_MANAGEMENT_FEE_DEFAULT } from './finance';

// The Finance overview's model (MD, 15 Oct 2026): every managed car should
// bring in 360,000 a week - two drivers (or one on both shifts) at
// 30,000 per shift per working day. The owner gets a fixed 240,000
// (Naya Solutions 270,000) whatever was collected, so every franc not
// collected comes straight out of Kivu's 120,000.
//
// Judged seat by seat, day by day (days up to today only):
// - a driver on the car: their working day should bring their rate; what
//   their payments (to date - later catch-ups count) covered is collected,
//   the rest is lost: "owes" while on contract, "left owing" once ended;
// - a paused day is lost too, unless the owner's payment was paused with
//   it (then nothing was expected and the owner wasn't paid);
// - the rest day costs nothing; an empty seat loses 180,000/7 a day.

export type LossCause = 'empty' | 'owes' | 'left_owing' | 'paused';
export const CAUSES: { key: LossCause; label: string; help: string }[] = [
  { key: 'empty', label: 'Empty seat', help: 'Car on the road with one driver (or none) — the second shift brought nothing.' },
  { key: 'left_owing', label: 'Left owing', help: 'Days driven by drivers whose contract ended before they paid for them.' },
  { key: 'owes', label: 'Drivers owing', help: 'Days driven and not yet paid by drivers still on contract — still recoverable.' },
  { key: 'paused', label: 'Paused days', help: "Drivers off (sick, garage…) while the owner's payment kept running." },
];
export const CAUSE_LABEL = Object.fromEntries(CAUSES.map((c) => [c.key, c.label])) as Record<LossCause, string>;
const zero = (): Record<LossCause, number> => ({ empty: 0, owes: 0, left_owing: 0, paused: 0 });

export const SEAT_DAY_EXPECTED = WEEKLY_COLLECTION_TARGET / 2 / 7; // an empty seat, per calendar day
export const isManaged = (v: Vehicle) => !!v.owner_id && !!v.operation_start_date;
export const weeklyPayoutOf = (v: Vehicle) => Number(v.weekly_owner_payout_amount ?? WEEKLY_OWNER_PAYOUT_DEFAULT);
export const isFeeRow = (t: FinanceTransaction) => t.type === 'revenue' && !!t.description?.startsWith('Monthly management fee');
const received = (t: FinanceTransaction) => t.status === 'checked' || t.status === 'approved' || t.status === 'posted';
const paidOut = (t: FinanceTransaction) => t.status === 'approved' || t.status === 'posted';
export const paidOnOf = (t: FinanceTransaction) => (t.approved_at ?? t.checked_at ?? t.updated_at).slice(0, 10);

// ------------------------------------------------------------ periods
export type PeriodKey = 'all' | 'week' | 'month' | 'last_month' | 'custom';
export interface Range { from: string; to: string }
// `start` = the first day anything happened (for All time).
export function rangeOf(key: PeriodKey, today: string, custom?: Range, start?: string): Range {
  if (key === 'all') return { from: start && start < today ? start : today, to: today };
  if (key === 'week') return { from: mondayOf(today), to: today };
  if (key === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (key === 'last_month') {
    const first = `${today.slice(0, 7)}-01`;
    const to = addDays(first, -1);
    return { from: `${to.slice(0, 7)}-01`, to };
  }
  return custom && custom.from <= custom.to ? custom : { from: mondayOf(today), to: today };
}
const inRange = (d: string, r: Range) => d >= r.from && d <= r.to;

// The first day with any money or any car on the road.
export function firstDayOf(vehicles: Vehicle[], transactions: FinanceTransaction[]): string | null {
  const days = [...vehicles.filter(isManaged).map((v) => v.operation_start_date!), ...transactions.map((t) => t.transaction_date)].filter(Boolean).sort();
  return days[0] ?? null;
}

// Same date every month (clamped to the month's last day, like Postgres).
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

// ------------------------------------------------------------ per driver, per day
type DayState = { kind: 'rest' } | { kind: 'paused'; owner: boolean; reason: PauseReason; rate: number } | { kind: 'work'; rate: number; paid: number };

// Every day of a driver's contract up to `until`, with what their payments
// covered (all payments to date, so a later catch-up counts).
function driverDays(d: Driver, deposits: DriverDeposit[], until: string): Map<string, DayState> {
  const out = new Map<string, DayState>();
  if (!d.start_date) return out;
  const restIso = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(d.rest_day ?? '') + 1;
  const credit = Number(d.opening_credit ?? 0) + (d.initial_deposit_paid ? Number(d.initial_deposit_amount ?? 0) : 0);
  let remaining = credit + deposits.filter((x) => x.driver_id === d.id && (!d.payments_from || x.paid_date >= d.payments_from)).reduce((s, x) => s + Number(x.amount), 0);
  for (let day = d.start_date; day <= until; day = addDays(day, 1)) {
    if (isoWeekday(day) === restIso) { out.set(day, { kind: 'rest' }); continue; }
    const rate = dailyRateOn(d, day);
    const p = pauseOn(d.pauses, day) as (NonNullable<Driver['pauses']>[number] | null);
    if (p) { out.set(day, { kind: 'paused', owner: !!p.owner_payout_paused, reason: p.reason, rate }); continue; }
    const paid = Math.min(remaining, rate);
    remaining -= paid;
    out.set(day, { kind: 'work', rate, paid });
  }
  return out;
}

// ------------------------------------------------------------ cars
export type CarStatus = 'losing' | 'below' | 'on_target';
export const CAR_STATUS: Record<CarStatus, { label: string; tone: 'danger' | 'attention' | 'success'; help: string }> = {
  losing: { label: 'Losing money', tone: 'danger', help: 'Collected less than its owner is paid — Kivu pays the difference.' },
  below: { label: 'Below target', tone: 'attention', help: 'Covers its owner, but brings Kivu less than it should.' },
  on_target: { label: 'On target', tone: 'success', help: 'Collected everything it should have.' },
};

export interface Money { expected: number; collected: number; ownerCost: number; lost: number; byCause: Record<LossCause, number> }
const money = (): Money => ({ expected: 0, collected: 0, ownerCost: 0, lost: 0, byCause: zero() });
export const shareOf = (m: Money) => m.collected - m.ownerCost;
export const targetShareOf = (m: Money) => m.expected - m.ownerCost;

export interface CarDriverRow { driver: Driver; days: number; expected: number; collected: number; lost: number; cause: LossCause | null; ended: boolean }
export interface CarWeek extends Money { week: string; days: number }
export interface CarEconomics extends Money {
  vehicle: Vehicle; ownerName: string; weeklyPayout: number; days: number;
  oneSeatDays: number; noDriverDays: number; ownerPausedShifts: number;
  status: CarStatus; weeks: CarWeek[]; drivers: CarDriverRow[];
}
export interface DriverLoss { driver: Driver; cause: Exclude<LossCause, 'empty'>; amount: number; days: number; cars: string[]; reasons: PauseReason[] }
export interface UnlinkedRow { assignment: DriverCarAssignment; driver: Driver; days: number; lost: number }
export interface Leakage extends Money { cars: CarEconomics[]; drivers: DriverLoss[]; unlinked: UnlinkedRow[]; range: Range }

export interface OverviewInput {
  vehicles: Vehicle[]; drivers: Driver[]; deposits: DriverDeposit[]; transactions: FinanceTransaction[];
  assignments: DriverCarAssignment[]; events: PerfEvent[]; owners: { id: string; full_name: string }[];
}

const add = (a: Money, b: { expected?: number; collected?: number; ownerCost?: number; cause?: LossCause; lost?: number }) => {
  a.expected += b.expected ?? 0;
  a.collected += b.collected ?? 0;
  a.ownerCost += b.ownerCost ?? 0;
  if (b.cause && b.lost) { a.lost += b.lost; a.byCause[b.cause] += b.lost; }
};

export function computeLeakage(input: OverviewInput, range: Range, today: string): Leakage {
  const to = range.to < today ? range.to : today;
  const out: Leakage = { ...money(), cars: [], drivers: [], unlinked: [], range: { from: range.from, to } };
  if (range.from > to) return out;

  const endOf = new Map(input.drivers.map((d) => [d.id, endDateOf(d, input.events)]));
  const daysOf = new Map<string, Map<string, DayState>>();
  const daysFor = (d: Driver) => {
    let m = daysOf.get(d.id);
    if (!m) { const end = endOf.get(d.id); m = driverDays(d, input.deposits, end && end < to ? end : to); daysOf.set(d.id, m); }
    return m;
  };
  const byId = new Map(input.drivers.map((d) => [d.id, d]));
  const onContract = (d: Driver, day: string) => !!d.start_date && d.start_date <= day && (!endOf.get(d.id) || day <= endOf.get(d.id)!);
  const losses = new Map<string, DriverLoss>();
  const loss = (d: Driver, cause: DriverLoss['cause'], amount: number, plate: string, reason?: PauseReason) => {
    const k = `${d.id}:${cause}`;
    const row = losses.get(k) ?? { driver: d, cause, amount: 0, days: 0, cars: [], reasons: [] };
    row.amount += amount; row.days += 1;
    if (plate && !row.cars.includes(plate)) row.cars.push(plate);
    if (reason && !row.reasons.includes(reason)) row.reasons.push(reason);
    losses.set(k, row);
  };

  // What the owner is owed for each day: their weekly payout rows (unpaid
  // ones included - they're owed), spread over the 7 days they cover.
  const payouts = input.transactions.filter((t) => t.type === 'vehicle_owner_payment' && t.system_generated && t.status !== 'rejected' && t.linked_vehicle_id);

  for (const v of input.vehicles.filter(isManaged)) {
    const from = range.from > v.operation_start_date! ? range.from : v.operation_start_date!;
    if (from > to) continue;
    const plate = v.plate_number;
    const car: CarEconomics = {
      ...money(), vehicle: v, weeklyPayout: weeklyPayoutOf(v), days: 0, oneSeatDays: 0, noDriverDays: 0, ownerPausedShifts: 0,
      ownerName: input.owners.find((o) => o.id === v.owner_id)?.full_name ?? '—', status: 'on_target', weeks: [], drivers: [],
    };
    const carPayouts = payouts.filter((t) => t.linked_vehicle_id === v.id);
    const rows = input.assignments.filter((a) => a.vehicle_id === v.id);
    const perDriver = new Map<string, CarDriverRow>();
    const weeks = new Map<string, CarWeek>();

    for (let day = from; day <= to; day = addDays(day, 1)) {
      car.days += 1;
      const wk = mondayOf(day);
      const week = weeks.get(wk) ?? { ...money(), week: wk, days: 0 };
      week.days += 1;
      weeks.set(wk, week);
      const both = (x: Parameters<typeof add>[1]) => { add(car, x); add(week, x); add(out, x); };

      const ownerCost = carPayouts.filter((t) => t.transaction_date <= day && day <= addDays(t.transaction_date, 6)).reduce((s, t) => s + Number(t.amount) / 7, 0);
      both({ ownerCost });

      const here = rows.filter((a) => a.from_date <= day && (!a.to_date || day <= a.to_date)).map((a) => byId.get(a.driver_id)).filter((d): d is Driver => !!d && onContract(d, day));
      let seats = 0;
      for (const d of [...new Map(here.map((x) => [x.id, x])).values()]) {
        const st = daysFor(d).get(day);
        const rate = st && st.kind !== 'rest' ? st.rate : dailyRateOn(d, day);
        seats += rate >= DAILY_DEPOSIT_RATE * 2 ? 2 : 1;
        const row = perDriver.get(d.id) ?? { driver: d, days: 0, expected: 0, collected: 0, lost: 0, cause: null, ended: !!endOf.get(d.id) };
        row.days += 1;
        perDriver.set(d.id, row);
        if (!st || st.kind === 'rest') continue;
        if (st.kind === 'paused') {
          if (st.owner) { car.ownerPausedShifts += rate >= DAILY_DEPOSIT_RATE * 2 ? 2 : 1; continue; }
          both({ expected: st.rate, cause: 'paused', lost: st.rate });
          row.expected += st.rate; row.lost += st.rate; row.cause = 'paused';
          loss(d, 'paused', st.rate, plate, st.reason);
          continue;
        }
        const short = st.rate - st.paid;
        const cause: LossCause = endOf.get(d.id) ? 'left_owing' : 'owes';
        both({ expected: st.rate, collected: st.paid, cause, lost: short });
        row.expected += st.rate; row.collected += st.paid; row.lost += short;
        if (short > 0) { row.cause = row.cause ?? cause; loss(d, cause, short, plate); }
      }
      const empty = Math.max(0, 2 - seats);
      if (empty) {
        both({ expected: empty * SEAT_DAY_EXPECTED, cause: 'empty', lost: empty * SEAT_DAY_EXPECTED });
        if (empty === 2) car.noDriverDays += 1; else car.oneSeatDays += 1;
      }
    }

    car.weeks = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
    car.drivers = [...perDriver.values()].sort((a, b) => b.days - a.days);
    car.status = shareOf(car) < 0 ? 'losing' : car.lost >= 1000 ? 'below' : 'on_target';
    out.cars.push(car);
  }

  // Drivers whose car for some days couldn't be proven: their days are on
  // no car. Listed whatever the period, until someone sets the car.
  for (const a of input.assignments.filter((x) => !x.vehicle_id)) {
    const d = byId.get(a.driver_id);
    if (!d) continue;
    let days = 0, lost = 0;
    const end = a.to_date && a.to_date < today ? a.to_date : today;
    const all = driverDays(d, input.deposits, endOf.get(d.id) && endOf.get(d.id)! < today ? endOf.get(d.id)! : today);
    for (let day = a.from_date; day <= end; day = addDays(day, 1)) {
      if (!onContract(d, day)) continue;
      const st = all.get(day);
      if (!st || st.kind === 'rest') continue;
      days += 1;
      if (st.kind === 'work') lost += st.rate - st.paid;
      else if (!st.owner) lost += st.rate;
    }
    if (days) out.unlinked.push({ assignment: a, driver: d, days, lost });
  }

  const rank: Record<CarStatus, number> = { losing: 0, below: 1, on_target: 2 };
  out.cars.sort((a, b) => rank[a.status] - rank[b.status] || b.lost - a.lost);
  out.drivers = [...losses.values()].sort((a, b) => b.amount - a.amount);
  return out;
}

// ------------------------------------------------------------ what's going wrong
export interface Insight { tone: 'danger' | 'attention' | 'info'; text: string; car?: string; driver?: string }
const r = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
export function insightsOf(l: Leakage): Insight[] {
  const out: Insight[] = [];
  if (!l.expected) return out;
  const losing = l.cars.filter((c) => c.status === 'losing');
  if (losing.length) {
    const gap = losing.reduce((s, c) => s + (c.ownerCost - c.collected), 0);
    out.push({ tone: 'danger', text: `${losing.length} car${losing.length === 1 ? '' : 's'} collected less than ${losing.length === 1 ? 'its owner is' : 'their owners are'} paid — Kivu covered ${r(gap)} out of its own pocket (${losing.map((c) => c.vehicle.plate_number).join(', ')}).` });
  }
  const ranked = [...(Object.entries(l.byCause) as [LossCause, number][])].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  for (const [cause, n] of ranked) {
    const pct = Math.round((n / l.lost) * 100);
    if (cause === 'empty') {
      const worst = [...l.cars].sort((a, b) => b.byCause.empty - a.byCause.empty)[0];
      out.push({ tone: pct >= 40 ? 'danger' : 'attention', car: worst?.vehicle.id, text: `Empty seats cost ${r(n)} (${pct}% of the loss).${worst ? ` Worst: ${worst.vehicle.plate_number} — ${worst.oneSeatDays} day${worst.oneSeatDays === 1 ? '' : 's'} with one driver${worst.noDriverDays ? `, ${worst.noDriverDays} with none` : ''}.` : ''}` });
    } else {
      const list = l.drivers.filter((d) => d.cause === cause);
      const top = list[0];
      const what = cause === 'left_owing' ? 'Drivers who left without paying' : cause === 'owes' ? 'Drivers still owing' : 'Paused days with the owner still paid';
      out.push({ tone: cause === 'paused' ? 'info' : 'attention', driver: top?.driver.id, text: `${what}: ${r(n)} (${pct}%) across ${list.length} driver${list.length === 1 ? '' : 's'}.${top ? ` Largest: ${top.driver.full_name.trim()} — ${r(top.amount)}.` : ''}` });
    }
  }
  if (l.unlinked.length) out.push({ tone: 'info', text: `${l.unlinked.length} driver${l.unlinked.length === 1 ? "'s" : "s'"} car for part of this period isn't recorded — set it below so each car's numbers are exact.` });
  return out;
}

// ------------------------------------------------------------ income
export interface FeeItem { vehicle: Vehicle; ownerName: string; due: string; amount: number; row: FinanceTransaction | null; paid: boolean; paidOn: string | null; nextDue: string; lateDays: number }
export function managementFees(input: OverviewInput, range: Range, today: string): FeeItem[] {
  const out: FeeItem[] = [];
  for (const v of input.vehicles.filter(isManaged)) {
    const rows = input.transactions.filter((t) => isFeeRow(t) && t.linked_vehicle_id === v.id && t.status !== 'rejected');
    for (let i = 0; i < 240; i++) {
      const due = addMonths(v.operation_start_date!, i);
      if (due > range.to) break;
      if (due < range.from) continue;
      const row = rows.find((t) => t.transaction_date === due) ?? rows.find((t) => t.transaction_date.slice(0, 7) === due.slice(0, 7)) ?? null;
      const paid = !!row && received(row);
      const late = !paid && due <= today ? Math.round((Date.parse(today) - Date.parse(due)) / 86400000) : 0;
      out.push({
        vehicle: v, ownerName: input.owners.find((o) => o.id === v.owner_id)?.full_name ?? row?.counterparty ?? '—', due,
        amount: Number(row?.amount ?? v.monthly_management_fee_amount ?? MONTHLY_MANAGEMENT_FEE_DEFAULT), row, paid,
        paidOn: paid && row ? paidOnOf(row) : null, nextDue: addMonths(v.operation_start_date!, i + 1), lateDays: late,
      });
    }
  }
  return out.sort((a, b) => Number(a.paid) - Number(b.paid) || a.due.localeCompare(b.due));
}

export interface OnboardingItem { row: FinanceTransaction; vehicle: Vehicle | null; ownerName: string; paid: boolean; paidOn: string | null; costs: FinanceTransaction[] }
export function onboardingFees(input: OverviewInput, range: Range): OnboardingItem[] {
  return input.transactions.filter((t) => t.type === 'onboarding_fee' && t.status !== 'rejected' && inRange(t.transaction_date, range)).map((row) => {
    const vehicle = input.vehicles.find((v) => v.id === row.linked_vehicle_id) ?? null;
    return {
      row, vehicle, ownerName: input.owners.find((o) => o.id === vehicle?.owner_id)?.full_name ?? row.counterparty ?? '—',
      paid: received(row), paidOn: received(row) ? paidOnOf(row) : null,
      costs: input.transactions.filter((t) => t.type === 'supplier_payment' && t.status !== 'rejected' && !!vehicle && t.linked_vehicle_id === vehicle.id && isOnboardingCost(t)),
    };
  }).sort((a, b) => b.row.transaction_date.localeCompare(a.row.transaction_date));
}
export const isOnboardingCost = (t: FinanceTransaction) => /^(Device cost|Branding cost|Uniforms)/.test(t.description ?? '');

// App commissions: one entry per Monday-Sunday week, due the Friday after.
export const COMMISSIONS_START = '2026-10-05'; // first week to enter (due Fri 16 Oct 2026)
export interface CommissionWeek { week: string; sunday: string; dueOn: string; row: FinanceTransaction | null; state: 'entered' | 'missing' | 'open' }
export function commissionWeeks(transactions: FinanceTransaction[], from: string, to: string, today: string): CommissionWeek[] {
  const rows = transactions.filter((t) => t.type === 'app_commission' && t.status !== 'rejected');
  const out: CommissionWeek[] = [];
  for (let w = mondayOf(from < COMMISSIONS_START ? COMMISSIONS_START : from); w <= to; w = addDays(w, 7)) {
    const row = rows.find((t) => t.transaction_date === w) ?? null;
    const dueOn = addDays(w, 11);
    out.push({ week: w, sunday: addDays(w, 6), dueOn, row, state: row ? 'entered' : dueOn <= today ? 'missing' : 'open' });
  }
  return out;
}

// ------------------------------------------------------------ made / spent
export type OutGroup = 'owners' | 'onboarding' | 'drivers' | 'staff' | 'other';
export const OUT_GROUPS: { key: OutGroup; label: string }[] = [
  { key: 'owners', label: 'Owner payments' },
  { key: 'onboarding', label: 'Devices, branding & uniforms' },
  { key: 'drivers', label: 'Driver salaries' },
  { key: 'staff', label: 'Staff salaries' },
  { key: 'other', label: 'Other costs' },
];
export function outGroupOf(t: FinanceTransaction): OutGroup | null {
  if (t.direction !== 'out' || t.type === 'transfer') return null;
  if (t.type === 'vehicle_owner_payment') return 'owners';
  if (t.type === 'driver_payroll') return 'drivers';
  if (t.type === 'payroll') return 'staff';
  if (t.type === 'supplier_payment' && isOnboardingCost(t)) return 'onboarding';
  return 'other';
}
export type InGroup = 'collections' | 'fees' | 'onboarding' | 'commissions' | 'other';
export const IN_GROUPS: { key: InGroup; label: string }[] = [
  { key: 'collections', label: 'Fleet collections' },
  { key: 'fees', label: 'Management fees' },
  { key: 'onboarding', label: 'Onboarding fees' },
  { key: 'commissions', label: 'App commissions' },
  { key: 'other', label: 'Other income' },
];
// Kivu's own bookkeeping entries (the weekly margin) aren't money coming in.
export function inGroupOf(t: FinanceTransaction): InGroup | null {
  if (t.direction !== 'in' || t.type === 'transfer' || t.type === 'management_margin') return null;
  if (t.type === 'fleet_collection') return 'collections';
  if (t.type === 'onboarding_fee') return 'onboarding';
  if (t.type === 'app_commission') return 'commissions';
  if (isFeeRow(t)) return 'fees';
  return 'other';
}

export interface Totals { total: number; done: number; open: number; rows: FinanceTransaction[] }
export interface MoneySummary { made: Record<InGroup, Totals>; spent: Record<OutGroup, Totals>; madeTotal: number; toReceive: number; spentTotal: number; paidTotal: number; toPay: number }
const totals = (): Totals => ({ total: 0, done: 0, open: 0, rows: [] });
// Made = money received in the period (fees still unpaid are "to receive",
// commissions count once logged). Spent = every cost of the period, paid
// or still to pay - owners are owed their weeks either way.
export function moneySummary(transactions: FinanceTransaction[], range: Range): MoneySummary {
  const made = Object.fromEntries(IN_GROUPS.map((g) => [g.key, totals()])) as Record<InGroup, Totals>;
  const spent = Object.fromEntries(OUT_GROUPS.map((g) => [g.key, totals()])) as Record<OutGroup, Totals>;
  for (const t of transactions) {
    if (t.status === 'rejected' || !inRange(t.transaction_date, range)) continue;
    const a = Number(t.amount);
    const ig = inGroupOf(t);
    if (ig) {
      const done = ig === 'commissions' || ig === 'collections' || received(t);
      const b = made[ig];
      b.rows.push(t);
      if (done) { b.done += a; b.total += a; } else b.open += a;
      continue;
    }
    const og = outGroupOf(t);
    if (og) {
      const b = spent[og];
      b.rows.push(t); b.total += a;
      if (paidOut(t)) b.done += a; else b.open += a;
    }
  }
  const sum = <K extends string>(rec: Record<K, Totals>, f: (x: Totals) => number) => Object.values<Totals>(rec).reduce((s, x) => s + f(x), 0);
  return {
    made, spent, madeTotal: sum(made, (x) => x.total), toReceive: sum(made, (x) => x.open),
    spentTotal: sum(spent, (x) => x.total), paidTotal: sum(spent, (x) => x.done), toPay: sum(spent, (x) => x.open),
  };
}
