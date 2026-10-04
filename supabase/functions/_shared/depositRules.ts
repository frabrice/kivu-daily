// The driver weekly-payment rule, in one place with no dependencies, so
// the web app (src/lib/fleet.ts re-exports all of this) and the email
// notification engine (notifications-run) can never disagree about who
// owes what or who is cleared to drive.
//
// Every driver pays on the same day: by Sunday, for the Monday-Sunday
// week ahead. Each working day costs 30,000 and the weekly rest day is
// free, so a full week is 6 x 30,000 = 180,000. Monday morning is the
// gate - a driver whose payments don't yet cover every working day up
// to the coming Sunday isn't cleared to drive. That single check also
// produces the new-driver rule on its own: 180,000 upfront on the start
// day, then on the first Sunday a top-up for the days already driven,
// then 180,000 every Sunday after.

export const WEEKLY_DEPOSIT_AMOUNT = 180000;
export const DAILY_DEPOSIT_RATE = 30000;

// First Monday the Sunday rule is enforced (payments due Sunday 11 Oct
// 2026). Weeks before it ran on the old rolling 7-day cycle from each
// driver's start date, so they're never scored or shown as weekly
// history - only the running balance carries across.
export const SUNDAY_RULE_START = '2026-10-12';

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

export interface DepositDriverLike {
  start_date: string | null;
  rest_day: RestDayKey | null;
  initial_deposit_paid: boolean;
  initial_deposit_amount: number | null;
  initial_deposit_date: string | null;
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
  paidThrough: string | null;
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
  nextDueDate: string | null;
  nextDueAmount: number;
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

export function countWorkingDays(from: string, to: string, restDay: RestDayKey | null): number {
  const rest = restDayIso(restDay);
  let n = 0;
  for (let d = from; d <= to; d = shiftDay(d, 1)) if (isoWeekday(d) !== rest) n++;
  return n;
}

// The last day a given total covers, walking working days from the start
// date at 30,000 each - a rest day right after the last paid working day
// counts as covered too, since it costs nothing.
export function paidThroughDate(startDate: string, restDay: RestDayKey | null, amount: number): string | null {
  const rest = restDayIso(restDay);
  let remaining = amount;
  let last: string | null = null;
  let d = startDate;
  for (let i = 0; i < 2000; i++) {
    if (isoWeekday(d) === rest) {
      last = d;
    } else {
      if (remaining < DAILY_DEPOSIT_RATE) break;
      remaining -= DAILY_DEPOSIT_RATE;
      last = d;
    }
    d = shiftDay(d, 1);
  }
  return last;
}

// What a brand new driver pays on their first Sunday after the 180,000
// upfront - the working days already driven by then, or the normal
// 180,000 when they start on a Monday. Before the rule starts, the first
// enforced Sunday is the switch-over Sunday, not an earlier one.
export function firstSundayPayment(startDate: string, restDay: RestDayKey | null): { date: string; amount: number } {
  const switchoverSunday = shiftDay(SUNDAY_RULE_START, -1);
  const firstSunday = sundayOf(startDate) < switchoverSunday ? switchoverSunday : sundayOf(startDate);
  const amount = countWorkingDays(startDate, shiftDay(firstSunday, 7), restDay) * DAILY_DEPOSIT_RATE - WEEKLY_DEPOSIT_AMOUNT;
  return { date: firstSunday, amount: Math.max(amount, 0) };
}

export function computeDepositStanding(driver: DepositDriverLike, deposits: DepositLike[], today: string = localToday()): DepositStanding {
  const start = driver.start_date;
  const rest = driver.rest_day;
  const ruleInForce = today >= SUNDAY_RULE_START;
  const initialAmount = driver.initial_deposit_paid ? (driver.initial_deposit_amount ?? 0) : 0;
  const payments = [
    ...(initialAmount > 0 ? [{ date: driver.initial_deposit_date ?? start ?? today, amount: initialAmount, order: '' }] : []),
    ...deposits.map((d) => ({ date: d.paid_date, amount: d.amount, order: d.created_at })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order));
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  if (!start || start > today) {
    return {
      hasStarted: false, ruleInForce, periods: [], current: null, totalPaid, paidThrough: null, owes: 0, weekBehind: 0,
      isCleared: true, owedNow: 0, nextDueDate: start, nextDueAmount: Math.max(WEEKLY_DEPOSIT_AMOUNT - totalPaid, 0),
      daysLost: 0, score: 0, onTimeWeeks: 0, lateWeeks: 0,
    };
  }

  const costThrough = (d: string) => (d < start ? 0 : countWorkingDays(start, d, rest) * DAILY_DEPOSIT_RATE);
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
    raw.push({ start, end: sundayOf(start), required: WEEKLY_DEPOSIT_AMOUNT, isStartSegment: true });
  }
  const firstMonday = isoWeekday(start) === 1 ? start : shiftDay(mondayOf(start), 7);
  for (let m = firstMonday < SUNDAY_RULE_START ? SUNDAY_RULE_START : firstMonday; m <= today; m = shiftDay(m, 7)) {
    raw.push({ start: m, end: shiftDay(m, 6), required: costThrough(shiftDay(m, 6)), isStartSegment: false });
  }

  // A payment logged on Monday counts as on time - deposits carry a date,
  // not a time, so it's assumed made before that day's shift. Only working
  // days count as lost; a rest day missed while unpaid costs nothing.
  const periods: DepositPeriod[] = raw.map((p) => {
    const cleared = clearedOn(p.required);
    const clearedDate = cleared && cleared <= today ? cleared : null;
    const lostEnd = [clearedDate ?? today, today, shiftDay(p.end, 1)].sort()[0];
    const daysLost = countWorkingDays(p.start, shiftDay(lostEnd, -1), rest);
    const state: DepositPeriodState = clearedDate ? (daysLost > 0 ? 'late' : 'on_time') : 'open';
    return { ...p, clearedDate, daysLost, state };
  });

  const current = periods.length > 0 ? periods[periods.length - 1] : null;
  const owes = Math.max(costThrough(today) - paidToDate, 0);
  const owedNow = ruleInForce && current ? Math.max(current.required - paidToDate, 0) : owes;
  // Before the Sunday rule starts there's no enforced week yet, so the
  // week is simply Monday-Sunday: everything up to this Sunday.
  const weekBehind = ruleInForce ? owedNow : Math.max(costThrough(sundayOf(today)) - paidToDate, 0);
  const nextDueDate = ruleInForce ? sundayOf(today) : shiftDay(SUNDAY_RULE_START, -1);
  const nextDueAmount = Math.max(costThrough(shiftDay(nextDueDate, 7)) - paidToDate, 0);
  const daysLost = periods.reduce((s, p) => s + p.daysLost, 0);

  return {
    hasStarted: true,
    ruleInForce,
    periods,
    current,
    totalPaid,
    paidThrough: paidThroughDate(start, rest, paidToDate),
    owes,
    weekBehind,
    isCleared: owedNow === 0,
    owedNow,
    nextDueDate,
    nextDueAmount,
    daysLost,
    score: -DEPOSIT_LATE_PENALTY_PER_DAY * daysLost,
    onTimeWeeks: periods.filter((p) => p.state === 'on_time').length,
    lateWeeks: periods.filter((p) => p.state === 'late').length,
  };
}
