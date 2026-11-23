// The driver payment rule, in one place with no dependencies, so
// the web app (src/lib/fleet.ts re-exports all of this) and the email
// notification engine (notifications-run) can never disagree about who
// owes what or who is cleared to drive.
//
// PAY FOR THE NEXT DAY (MD, 23 Nov 2026 - DAILY_RULE_START): there is no
// common pay day and no full week to pay any more. A driver pays for the
// day they are going to work, the day before (paying on the morning of
// that day is tolerated). Any amount counts, even part of a day; a week or
// more just moves their next pay day further out, so each driver has their
// own pay day. A working day not paid by the end of that day is a lost day
// and the car is taken back. Days before DAILY_RULE_START keep the weekly
// (Sunday) reading below, so past scores don't change.
//
// Every driver pays on the same day: by Sunday, for the Monday-Sunday
// week ahead. Each working day costs 30,000 and the weekly rest day is
// free, so a full week is 6 x 30,000 = 180,000. Monday morning is the
// gate - a driver whose payments don't yet cover every working day up
// to the coming Sunday isn't cleared to drive. That single check also
// produces the new-driver rule on its own: 180,000 upfront on the start
// day, then on the first Sunday a top-up for the days already driven,
// then 180,000 every Sunday after.
//
// Every driver is on a model (drivers.model, table driver_models; MD 12
// Nov 2026), all paid the same way - by Sunday for the week ahead:
//   one_shift    30,000 a working day, one rest day free  -> 180,000 a week
//   both_shifts  60,000 a working day, one rest day free  -> 360,000 a week
//   solo_car     45,000 a day, no rest day (7 days)       -> 315,000 a week
// A whole-car model (both shifts, Solo car) has shift 'full'; a model with
// no rest day has rest_day null, so every day is a working day.
//
// A driver can change model mid-contract: drivers.rate_history
// ([{from, daily, model, rest_day}]) keeps the terms from each date, so past
// days keep their old rate AND their old rest day. Every contract starts
// with one entry (its start date); empty history = the model's own terms.
//
// A renewed contract (drivers.payments_from / opening_credit) counts only
// its own payments: deposits from payments_from on, the new first payment,
// and any credit carried from the old contract (as paid on the start day).

export const WEEKLY_DEPOSIT_AMOUNT = 180000;
export const DAILY_DEPOSIT_RATE = 30000;

// The models' own terms (mirrors driver_models). Used only when a driver has
// no history entry yet, and for the choices on the screens.
export type DriverModelKey = 'one_shift' | 'both_shifts' | 'solo_car';
export const DRIVER_MODELS: Record<DriverModelKey, { label: string; daily: number; restDay: boolean; wholeCar: boolean; salary: number | null }> = {
  one_shift: { label: 'One shift', daily: 30000, restDay: true, wholeCar: false, salary: 150000 },
  both_shifts: { label: 'Both shifts', daily: 60000, restDay: true, wholeCar: true, salary: 300000 },
  solo_car: { label: 'Solo car', daily: 45000, restDay: false, wholeCar: true, salary: null },
};
export const modelOf = (key: string | null | undefined) => DRIVER_MODELS[(key ?? '') as DriverModelKey] ?? null;
// A model's full week: the day rate times its paid days (6 with a rest day, 7 without).
export const modelWeekly = (key: string | null | undefined) => { const m = modelOf(key); return m ? m.daily * (m.restDay ? 6 : 7) : WEEKLY_DEPOSIT_AMOUNT; };

export interface RateChange { from: string; daily: number; model?: string | null; rest_day?: RestDayKey | null }
type TermsLike = { shift?: string | null; model?: string | null; rest_day?: RestDayKey | string | null; rate_history?: RateChange[] | null };

// The history entry in force on a day (the first one for days before it).
function termsOn(d: TermsLike, day: string): RateChange | null {
  const h = d.rate_history ?? [];
  if (!h.length) return null;
  const sorted = [...h].sort((a, b) => a.from.localeCompare(b.from));
  let e = sorted[0];
  for (const x of sorted) if (x.from <= day) e = x;
  return e;
}

// The driver's day rate now: their latest terms, else their model's, else their shift's.
export function dailyRateOf(d: TermsLike): number {
  const h = d.rate_history ?? [];
  if (h.length) return Number([...h].sort((a, b) => a.from.localeCompare(b.from))[h.length - 1].daily);
  return modelOf(d.model)?.daily ?? (d.shift === 'full' ? DAILY_DEPOSIT_RATE * 2 : DAILY_DEPOSIT_RATE);
}
// A full week now: 6 paid days with a rest day, 7 without.
export const weeklyAmountOf = (d: TermsLike) => dailyRateOf(d) * (d.rest_day === null ? 7 : 6);

// The daily rate on a given day, following any mid-contract change.
export function dailyRateOn(d: TermsLike, day: string): number {
  const e = termsOn(d, day);
  return e ? Number(e.daily) : dailyRateOf(d);
}
// The rest day on a given day (null: none, every day is a working day).
export function restDayOn(d: TermsLike, day: string): RestDayKey | null {
  const e = termsOn(d, day);
  return (e && 'rest_day' in e ? e.rest_day ?? null : (d.rest_day as RestDayKey | null | undefined) ?? null);
}
// The model on a given day.
export function modelOn(d: TermsLike, day: string): string | null {
  return termsOn(d, day)?.model ?? d.model ?? (d.shift === 'full' ? 'both_shifts' : 'one_shift');
}

export const shiftLabel = (shift: string | null | undefined, long = false) =>
  shift === 'full' ? (long ? 'Both shifts (day & night)' : 'Day & night') : shift === 'day' ? (long ? 'Day shift' : 'Day') : shift === 'night' ? (long ? 'Night shift' : 'Night') : '';
// The short shift label of a driver ("Day", "Night", "Day & night"), with Solo car named as such.
export const driverShiftShort = (d: { model?: string | null; shift?: string | null }, long = false) =>
  d.model === 'solo_car' ? (long ? 'Solo car (the car alone, every day)' : 'Solo car') : shiftLabel(d.shift, long);
// How a driver's terms read everywhere: "Solo car", "Both shifts", "Day shift"...
export function driverTermsLabel(d: { model?: string | null; shift?: string | null }, long = false): string {
  if (d.model === 'solo_car') return long ? 'Solo car (the car alone, every day)' : 'Solo car';
  if (d.model === 'both_shifts' || d.shift === 'full') return long ? 'Both shifts (day & night)' : 'Both shifts';
  return d.shift ? `${shiftLabel(d.shift, long)}${long ? '' : ' shift'}` : 'One shift';
}

// First Monday the Sunday rule is enforced (payments due Sunday 11 Oct
// 2026). Weeks before it ran on the old rolling 7-day cycle from each
// driver's start date, so they're never scored or shown as weekly
// history - only the running balance carries across.
export const SUNDAY_RULE_START = '2026-10-12';

// From this Monday on, the week must be paid by Sunday: a payment dated
// Monday is late and Monday counts as a lost day (MD, 18 Oct 2026 - "the
// first day of the week you start working when you've already paid").
// Before it, a Monday payment was assumed made before the shift.
export const MONDAY_LATE_FROM = '2026-10-19';

// From this day on, the "pay for the next day" rule replaces the Sunday
// rule (MD, 23 Nov 2026). A Monday, so the weekly periods end the Sunday before.
export const DAILY_RULE_START = '2026-11-23';

// Every working day lost to an unpaid week costs 30 points - there's no
// reward for paying on time, only a cost for being late. Counted only
// from the switch-over week onward.
export const DEPOSIT_LATE_PENALTY_PER_DAY = 30;

export type RestDayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
const REST_DAY_ORDER: RestDayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export interface DepositLike {
  paid_date: string;
  amount: number;
  created_at: string;
}

// A pause (sick, car in the garage...): every day from start_date to
// end_date (inclusive; open-ended while end_date is null) counts exactly
// like the weekly rest day - free, never owed, never lost. Rejected
// pauses don't count.
export interface PauseLike {
  start_date: string;
  end_date: string | null;
  approval_status?: string | null;
  reason?: string | null;
}

export interface DepositDriverLike {
  start_date: string | null;
  rest_day: RestDayKey | null;
  initial_deposit_paid: boolean;
  initial_deposit_amount: number | null;
  initial_deposit_date: string | null;
  pauses?: PauseLike[] | null;
  shift?: string | null;
  // Current contract only (set on renewal): payments before this date belong to an old contract.
  payments_from?: string | null;
  // Credit carried from the previous contract, counted as paid on start_date.
  opening_credit?: number | null;
  // Daily rate from each date (mid-contract shift changes).
  rate_history?: RateChange[] | null;
  // Adjustments made with the Adjust button (adjust_driver_balance()).
  balance_adjustments?: BalanceAdjustment[] | null;
}

// An adjustment (migration 20261101130000): 'amount' is a credit (+) or
// charge (-) counted like a payment on its date - not money received;
// 'grace' lets the driver drive until `until` although not paid up, and
// those days are not lost.
export interface BalanceAdjustment {
  id: string; kind: 'amount' | 'grace'; date: string; amount?: number; until?: string;
  reason: string; by: string | null; by_name: string | null; at: string;
  // Someone other than the MD: pending until the MD confirms (no status: before the rule, confirmed).
  status?: 'pending' | 'confirmed'; confirmed_by?: string | null; confirmed_at?: string | null;
  before?: { owes?: number; behind?: number; next_due?: string | null } | null;
  after?: { owes?: number; behind?: number; next_due?: string | null } | null;
}
const adjustmentsOf = (driver: DepositDriverLike) => (driver.balance_adjustments ?? []).filter((a) => !driver.payments_from || a.date >= driver.payments_from);
// The grace windows as days off for counting lost days.
const graceDays = (driver: DepositDriverLike): PauseLike[] => adjustmentsOf(driver).filter((a) => a.kind === 'grace' && a.until).map((a) => ({ start_date: a.date, end_date: a.until!, approval_status: 'approved' }));

// Every payment that counts for the driver's current contract, oldest first.
export function contractPayments(driver: DepositDriverLike, deposits: DepositLike[]): { date: string; amount: number; order: string; adjustment?: boolean }[] {
  const start = driver.start_date;
  const initialAmount = driver.initial_deposit_paid ? (driver.initial_deposit_amount ?? 0) : 0;
  const credit = Number(driver.opening_credit ?? 0);
  return [
    ...(credit > 0 && start ? [{ date: start, amount: credit, order: '' }] : []),
    ...(initialAmount > 0 ? [{ date: driver.initial_deposit_date ?? start ?? localToday(), amount: initialAmount, order: '' }] : []),
    ...deposits.filter((d) => !driver.payments_from || d.paid_date >= driver.payments_from).map((d) => ({ date: d.paid_date, amount: Number(d.amount), order: d.created_at })),
    ...adjustmentsOf(driver).filter((a) => a.kind === 'amount' && Number(a.amount)).map((a) => ({ date: a.date, amount: Number(a.amount), order: a.at, adjustment: true })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order));
}

export function pauseOn(pauses: PauseLike[] | null | undefined, d: string): PauseLike | null {
  return (pauses ?? []).find((p) => p.approval_status !== 'rejected' && p.start_date <= d && (p.end_date === null || d <= p.end_date)) ?? null;
}

export type DepositPeriodState = 'on_time' | 'late' | 'open';

export interface DepositPeriod {
  start: string;
  end: string;
  // Total that must have been paid since the start date to be cleared
  // for this period - cumulative, so any earlier shortfall carries in.
  required: number;
  clearedDate: string | null;
  daysLost: number;
  state: DepositPeriodState;
  // A new driver's own first days (start day to that first Sunday), paid
  // as the flat 180,000 upfront rather than a calendar week.
  isStartSegment: boolean;
}

export interface DepositStanding {
  hasStarted: boolean;
  ruleInForce: boolean;
  periods: DepositPeriod[];
  current: DepositPeriod | null;
  totalPaid: number;
  // Sum of the credits (+) and charges (-) made with Adjust.
  adjusted: number;
  // An Adjust grace running today: may drive until this date.
  graceUntil: string | null;
  paidThrough: string | null;
  // The pause covering today (if any), and paused working days this week.
  pausedToday: PauseLike | null;
  pausedDaysThisWeek: number;
  // The two amounts every dashboard shows (confirmed with the operator):
  // OWES - working days already driven (start of the week through today)
  // that haven't been paid for. Grows by 30,000 each unpaid working day.
  owes: number;
  // BEHIND - the whole week that should have been paid on its first day,
  // minus what's been paid. Only shrinks as payments come in. Being
  // cleared to drive depends on this reaching zero, not on owes.
  weekBehind: number;
  isCleared: boolean;
  owedNow: number;
  // When the next payment should be made. Under the daily rule: the day
  // before the first working day not paid yet (paying on that day itself
  // is tolerated); today or earlier when today isn't paid.
  nextDueDate: string | null;
  nextDueAmount: number;
  // Daily rule: true from DAILY_RULE_START.
  dailyRule: boolean;
  // Daily rule: the first working day not paid for yet (the day the next payment is for).
  nextUnpaidDay: string | null;
  // Daily rule: today is a working day not paid yet - paying today is
  // tolerated; not paid by tonight, the day is lost and the car taken back.
  payToday: boolean;
  daysLost: number;
  score: number;
  onTimeWeeks: number;
  lateWeeks: number;
}

const DAY_MS = 86400000;

function parseDay(d: string): Date {
  return new Date(`${d}T00:00:00`);
}

function formatDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftDay(d: string, n: number): string {
  const x = parseDay(d);
  x.setDate(x.getDate() + n);
  return formatDay(x);
}

export function isoWeekday(d: string): number {
  const w = parseDay(d).getDay();
  return w === 0 ? 7 : w;
}

function restDayIso(restDay: RestDayKey | null): number {
  return REST_DAY_ORDER.indexOf(restDay as RestDayKey) + 1;
}

// A rest day given once (the same every week) or day by day (it can change
// with the driver's model, see restDayOn).
export type RestDayRule = RestDayKey | null | ((day: string) => RestDayKey | null);
const isRestDay = (rule: RestDayRule, d: string) => isoWeekday(d) === restDayIso(typeof rule === 'function' ? rule(d) : rule);

function localToday(): string {
  return formatDay(new Date());
}

export function mondayOf(d: string): string {
  return shiftDay(d, 1 - isoWeekday(d));
}

export function sundayOf(d: string): string {
  return shiftDay(mondayOf(d), 6);
}

export function daysUntilDate(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

function countDays(from: string, to: string, include: (d: string) => boolean): number {
  let n = 0;
  for (let d = from; d <= to; d = shiftDay(d, 1)) if (include(d)) n++;
  return n;
}

// What the working days from..to cost, at each day's own rate.
export function workingCost(driver: DepositDriverLike, from: string, to: string): number {
  let total = 0;
  for (let d = from; d <= to; d = shiftDay(d, 1)) if (!isRestDay((x) => restDayOn(driver, x), d) && !pauseOn(driver.pauses, d)) total += dailyRateOn(driver, d);
  return total;
}

export function countWorkingDays(from: string, to: string, restDay: RestDayRule, pauses?: PauseLike[] | null): number {
  let n = 0;
  for (let d = from; d <= to; d = shiftDay(d, 1)) if (!isRestDay(restDay, d) && !pauseOn(pauses, d)) n++;
  return n;
}

// The last day a given total covers, walking working days from the start
// date at 30,000 each - a rest day right after the last paid working day
// counts as covered too, since it costs nothing.
export function paidThroughDate(startDate: string, restDay: RestDayRule, amount: number, pauses?: PauseLike[] | null, rate: number | ((day: string) => number) = DAILY_DEPOSIT_RATE): string | null {
  const rateOn = typeof rate === 'function' ? rate : () => rate;
  let remaining = amount;
  let last: string | null = null;
  let d = startDate;
  for (let i = 0; i < 2000; i++) {
    if (isRestDay(restDay, d) || pauseOn(pauses, d)) {
      last = d;
    } else {
      const r = rateOn(d);
      if (remaining < r) break;
      remaining -= r;
      last = d;
    }
    d = shiftDay(d, 1);
  }
  return last;
}

// What a brand new driver pays on their first Sunday after their first
// week upfront - the working days already driven by then, or a normal
// week when they start on a Monday. A week is 6 paid days with a rest day,
// 7 without (Solo car). Before the rule starts, the first enforced Sunday
// is the switch-over Sunday, not an earlier one.
export function firstSundayPayment(startDate: string, restDay: RestDayKey | null, rate: number = DAILY_DEPOSIT_RATE): { date: string; amount: number } {
  const switchoverSunday = shiftDay(SUNDAY_RULE_START, -1);
  const firstSunday = sundayOf(startDate) < switchoverSunday ? switchoverSunday : sundayOf(startDate);
  const amount = countWorkingDays(startDate, shiftDay(firstSunday, 7), restDay) * rate - rate * (restDay ? 6 : 7);
  return { date: firstSunday, amount: Math.max(amount, 0) };
}

export function computeDepositStanding(driver: DepositDriverLike, deposits: DepositLike[], today: string = localToday()): DepositStanding {
  const start = driver.start_date;
  // The rest day day by day: a driver moved to Solo car keeps their old rest day before the move.
  const rest: RestDayRule = (day) => restDayOn(driver, day);
  const ruleInForce = today >= SUNDAY_RULE_START;
  // The first week (paid upfront): the terms the contract started on.
  const weekly = start ? dailyRateOn(driver, start) * (restDayOn(driver, start) ? 6 : 7) : weeklyAmountOf(driver);
  const payments = contractPayments(driver, deposits);
  // Paid in total is real money only; adjustments are added separately.
  const totalPaid = payments.reduce((s, p) => s + (p.adjustment ? 0 : p.amount), 0);
  const adjusted = payments.reduce((s, p) => s + (p.adjustment ? p.amount : 0), 0);
  const grace = adjustmentsOf(driver).filter((a) => a.kind === 'grace' && a.until && a.date <= today && today <= a.until).sort((a, b) => b.until!.localeCompare(a.until!))[0] ?? null;
  const graceUntil = grace?.until ?? null;

  if (!start || start > today) {
    return {
      hasStarted: false, ruleInForce, periods: [], current: null, totalPaid, adjusted, graceUntil, paidThrough: null, pausedToday: null, pausedDaysThisWeek: 0, owes: 0, weekBehind: 0,
      isCleared: true, owedNow: 0, nextDueDate: start,
      // Daily rule: the start day must be paid for before it begins.
      nextDueAmount: start && start >= DAILY_RULE_START ? Math.max(dailyRateOn(driver, start) - totalPaid - adjusted, 0) : Math.max(weekly - totalPaid, 0),
      dailyRule: today >= DAILY_RULE_START, nextUnpaidDay: start, payToday: false,
      daysLost: 0, score: 0, onTimeWeeks: 0, lateWeeks: 0,
    };
  }

  const pauses = driver.pauses ?? [];
  const pausesAndGrace = [...pauses, ...graceDays(driver)];
  const costThrough = (d: string) => (d < start ? 0 : workingCost(driver, start, d));
  const paidToDate = payments.reduce((s, p) => (p.date <= today ? s + p.amount : s), 0);
  const clearedOn = (required: number): string | null => {
    let cum = 0;
    for (const p of payments) {
      cum += p.amount;
      if (cum >= required) return p.date;
    }
    return null;
  };

  const raw: { start: string; end: string; required: number; isStartSegment: boolean }[] = [];
  if (start >= SUNDAY_RULE_START && isoWeekday(start) !== 1) {
    raw.push({ start, end: sundayOf(start), required: weekly, isStartSegment: true });
  }
  const firstMonday = isoWeekday(start) === 1 ? start : shiftDay(mondayOf(start), 7);
  // Under the daily rule the weekly (Sunday) weeks stop the Sunday before DAILY_RULE_START.
  const dailyRule = today >= DAILY_RULE_START;
  const weeksUntil = dailyRule ? shiftDay(DAILY_RULE_START, -1) : today;
  if (dailyRule && raw.length && raw[0].start >= DAILY_RULE_START) raw.length = 0;
  for (let m = firstMonday < SUNDAY_RULE_START ? SUNDAY_RULE_START : firstMonday; m <= weeksUntil; m = shiftDay(m, 7)) {
    raw.push({ start: m, end: shiftDay(m, 6), required: costThrough(shiftDay(m, 6)), isStartSegment: false });
  }

  // The week must be paid by its Sunday. From MONDAY_LATE_FROM a payment
  // dated on or after the Monday is late: the day it comes in is lost too
  // (the car wasn't given that morning), and so is today while unpaid.
  // Earlier weeks, and a new driver's own first days (paid on the start
  // day), keep the old reading: paying on the first day is on time. Only
  // working days count as lost; a rest day missed while unpaid costs nothing.
  const periods: DepositPeriod[] = raw.map((p) => {
    const cleared = clearedOn(p.required);
    const clearedDate = cleared && cleared <= today ? cleared : null;
    const strict = !p.isStartSegment && p.start >= MONDAY_LATE_FROM;
    const lostEnd = strict
      ? shiftDay([clearedDate ?? today, today, p.end].sort()[0], 1)
      : [clearedDate ?? today, today, shiftDay(p.end, 1)].sort()[0];
    const daysLost = clearedDate && clearedDate < p.start ? 0 : countWorkingDays(p.start, shiftDay(lostEnd, -1), rest, pausesAndGrace);
    const state: DepositPeriodState = clearedDate ? (daysLost > 0 ? 'late' : 'on_time') : 'open';
    return { ...p, clearedDate, daysLost, state };
  });

  if (dailyRule) {
    return dailyStanding({
      driver, today, start, rest, pauses, pausesAndGrace, payments, totalPaid, adjusted, graceUntil, paidToDate, costThrough, clearedOn,
      weeklyPeriods: periods,
    });
  }

  const current = periods.length > 0 ? periods[periods.length - 1] : null;
  const owes = Math.max(costThrough(today) - paidToDate, 0);
  const owedNow = ruleInForce && current ? Math.max(current.required - paidToDate, 0) : owes;
  // Before the Sunday rule starts there's no enforced week yet, so the
  // week is simply Monday-Sunday: everything up to this Sunday.
  const weekBehind = ruleInForce ? owedNow : Math.max(costThrough(sundayOf(today)) - paidToDate, 0);
  const nextDueDate = graceUntil ?? (ruleInForce ? sundayOf(today) : shiftDay(SUNDAY_RULE_START, -1));
  const nextDueAmount = Math.max(costThrough(shiftDay(nextDueDate, 7)) - paidToDate, 0);
  const daysLost = periods.reduce((s, p) => s + p.daysLost, 0);

  return {
    hasStarted: true,
    ruleInForce,
    periods,
    current,
    totalPaid,
    adjusted,
    graceUntil,
    paidThrough: paidThroughDate(start, rest, paidToDate, pauses, (day) => dailyRateOn(driver, day)),
    pausedToday: pauseOn(pauses, today),
    pausedDaysThisWeek: countDays(mondayOf(today), sundayOf(today), (d) => !isRestDay(rest, d) && !!pauseOn(pauses, d) && d >= start),
    owes,
    weekBehind,
    isCleared: owedNow === 0 || !!graceUntil,
    owedNow,
    nextDueDate,
    nextDueAmount,
    dailyRule: false,
    nextUnpaidDay: null,
    payToday: false,
    daysLost,
    score: -DEPOSIT_LATE_PENALTY_PER_DAY * daysLost,
    onTimeWeeks: periods.filter((p) => p.state === 'on_time').length,
    lateWeeks: periods.filter((p) => p.state === 'late').length,
  };
}

// The "pay for the next day" rule (from DAILY_RULE_START). Each working day
// must be paid by the end of that day at the latest (the day before is the
// rule, the same day is tolerated); otherwise it is lost. Weeks before the
// rule keep their weekly reading (weeklyPeriods); the days from the rule on
// are grouped Monday-Sunday only so the weekly history screens still read.
function dailyStanding(x: {
  driver: DepositDriverLike; today: string; start: string; rest: RestDayRule; pauses: PauseLike[]; pausesAndGrace: PauseLike[];
  payments: { date: string; amount: number }[]; totalPaid: number; adjusted: number; graceUntil: string | null; paidToDate: number;
  costThrough: (d: string) => number; clearedOn: (required: number) => string | null; weeklyPeriods: DepositPeriod[];
}): DepositStanding {
  const { driver, today, start, rest, pauses, pausesAndGrace, totalPaid, adjusted, graceUntil, paidToDate, costThrough, clearedOn } = x;
  const rateOn = (d: string) => dailyRateOn(driver, d);
  const costs = (d: string) => !isRestDay(rest, d) && !pauseOn(pauses, d);
  const paidThrough = paidThroughDate(start, rest, paidToDate, pauses, rateOn);
  // The first working day not paid for yet - the day the next payment is for.
  let nextUnpaidDay = paidThrough ? shiftDay(paidThrough, 1) : start;
  for (let i = 0; i < 400 && !costs(nextUnpaidDay); i++) nextUnpaidDay = shiftDay(nextUnpaidDay, 1);
  // Part of a day already paid towards it counts (MD: any amount is accepted).
  const leftover = Math.max(paidToDate - (paidThrough ? costThrough(paidThrough) : 0), 0);
  const owes = Math.max(costThrough(today) - paidToDate, 0);
  const payToday = nextUnpaidDay === today && owes > 0;
  const nextDueDate = graceUntil ?? (nextUnpaidDay <= today ? today : shiftDay(nextUnpaidDay, -1));
  const nextDueAmount = nextUnpaidDay <= today ? owes : Math.max(rateOn(nextUnpaidDay) - leftover, 0);

  // Day by day from the rule: a working day is lost when it wasn't paid by
  // the end of that day (today, while still unpaid, isn't lost yet).
  const from = start > DAILY_RULE_START ? start : DAILY_RULE_START;
  const lostOn = (d: string) => {
    if (!costs(d) || pauseOn(pausesAndGrace, d)) return false;
    const paidBy = clearedOn(costThrough(d));
    return paidBy ? paidBy > d : d < today;
  };
  const weeks: DepositPeriod[] = [];
  for (let m = mondayOf(from); m <= today; m = shiftDay(m, 7)) {
    const ws = m < from ? from : m;
    const we = shiftDay(m, 6);
    const last = we < today ? we : today;
    let lost = 0;
    for (let d = ws; d <= last; d = shiftDay(d, 1)) if (lostOn(d)) lost++;
    const required = costThrough(last);
    const cleared = clearedOn(required);
    const clearedDate = cleared && cleared <= today ? cleared : null;
    const state: DepositPeriodState = lost > 0 ? 'late' : clearedDate || required === 0 ? 'on_time' : 'open';
    weeks.push({ start: ws, end: we, required, clearedDate, daysLost: lost, state, isStartSegment: false });
  }
  const periods = [...x.weeklyPeriods, ...weeks];
  const daysLost = periods.reduce((s, p) => s + p.daysLost, 0);

  return {
    hasStarted: true,
    ruleInForce: true,
    periods,
    current: periods.length ? periods[periods.length - 1] : null,
    totalPaid,
    adjusted,
    graceUntil,
    paidThrough,
    pausedToday: pauseOn(pauses, today),
    pausedDaysThisWeek: countDays(mondayOf(today), sundayOf(today), (d) => !isRestDay(rest, d) && !!pauseOn(pauses, d) && d >= start),
    owes,
    // No more "behind on the week": only days already started and not paid count.
    weekBehind: 0,
    isCleared: owes === 0 || !!graceUntil,
    owedNow: owes,
    nextDueDate,
    nextDueAmount,
    dailyRule: true,
    nextUnpaidDay,
    payToday,
    daysLost,
    score: -DEPOSIT_LATE_PENALTY_PER_DAY * daysLost,
    onTimeWeeks: periods.filter((p) => p.state === 'on_time').length,
    lateWeeks: periods.filter((p) => p.state === 'late').length,
  };
}
