import { useEffect, useState, useCallback } from 'react';
import { supabase, Driver, Vehicle, DriverDeposit, DriverFine, DriverFinePayment, DriverContractEvent, DriverDocument, DriverDocumentType, DriverStage, DriverContractStatus, DriverRestDay, DepositPaymentMethod, Profile } from './supabase';
import { todayStr, dateStr, addDays } from './utils';

// Fleet's own dashboard, plus the identical bundled view given to Call
// Center and IT (both need the full Fleet picture - not a read-only
// mirror of it, and not fragmented into separate sidebar pages the way
// Fleet's own staff see it) - kept as one helper so the departments
// allowed to edit stay in sync with the RLS policies on the other end.
const FLEET_EDIT_DEPARTMENTS = ['fleet', 'call_center', 'it'];

export function canEditFleet(profile: Profile | null | undefined): boolean {
  return profile?.role === 'managing_director' || FLEET_EDIT_DEPARTMENTS.includes(profile?.department?.slug ?? '');
}

// Shared by every Fleet page (Driver Pipeline, Vehicles, Deposits, Fines) so
// each can be its own nav destination without re-fetching/duplicating the
// same four tables four times over.
export function useFleetData() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [deposits, setDeposits] = useState<DriverDeposit[]>([]);
  const [fines, setFines] = useState<DriverFine[]>([]);
  const [finePayments, setFinePayments] = useState<DriverFinePayment[]>([]);
  const [contractEvents, setContractEvents] = useState<DriverContractEvent[]>([]);
  const [driverDocuments, setDriverDocuments] = useState<DriverDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [d, v, dep, fin, finePay, contractEvts, docs] = await Promise.all([
      supabase.from('drivers').select('*, vehicle:vehicles(*)').order('created_at', { ascending: false }),
      supabase.from('vehicles').select('*').order('created_at', { ascending: false }),
      supabase.from('driver_deposits').select('*').order('paid_date', { ascending: false }),
      supabase.from('driver_fines').select('*, driver:drivers(*), vehicle:vehicles(*)').order('fine_date', { ascending: false }),
      supabase.from('driver_fine_payments').select('*').order('paid_date', { ascending: false }),
      supabase.from('driver_contract_events').select('*').order('event_date', { ascending: false }),
      supabase.from('driver_documents').select('*'),
    ]);
    setDrivers((d.data as Driver[]) ?? []);
    setVehicles((v.data as Vehicle[]) ?? []);
    setDeposits((dep.data as DriverDeposit[]) ?? []);
    setFines((fin.data as DriverFine[]) ?? []);
    setFinePayments((finePay.data as DriverFinePayment[]) ?? []);
    setContractEvents((contractEvts.data as DriverContractEvent[]) ?? []);
    setDriverDocuments((docs.data as DriverDocument[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('fleet-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_deposits' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_fines' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_fine_payments' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_contract_events' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_documents' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { drivers, vehicles, deposits, fines, finePayments, contractEvents, driverDocuments, loading, reload: load };
}

export const DRIVER_DOCUMENT_TYPES: { key: DriverDocumentType; label: string }[] = [
  { key: 'application_letter', label: 'Application Letter' },
  { key: 'cv', label: 'CV' },
  { key: 'id', label: 'National ID' },
  { key: 'driving_license', label: 'Driving License' },
  { key: 'medical_certificate', label: 'Medical Certificate' },
  { key: 'criminal_record', label: 'Criminal Record' },
  { key: 'discipline_certificate', label: 'Discipline Certificate (Village Chief)' },
];

export const STAGES: { key: DriverStage; label: string; color: string }[] = [
  { key: 'applying', label: 'Applying', color: '#9ca3af' },
  { key: 'raw', label: 'Raw', color: '#f97316' },
  { key: 'ready', label: 'Ready', color: '#2F8C86' },
  { key: 'active', label: 'Active', color: '#4F7B3E' },
  { key: 'flagged', label: 'Flagged', color: '#ef4444' },
  { key: 'inactive', label: 'Inactive', color: '#6b7280' },
];

// What Fleet can actually pick by hand - 'active' is excluded because
// it's computed, never a manual choice. Used by DriverDrawer's stage
// picker so the dropdown can't offer a value that would just be
// silently overridden by effectiveStage() anyway.
export const MANUAL_STAGES = STAGES.filter((s) => s.key !== 'active');

interface StageLike {
  stage: DriverStage;
  vehicle_id: string | null;
  initial_deposit_paid: boolean;
  contract_status: DriverContractStatus;
}

// 'Active' is never something Fleet sets directly - it's true exactly
// when a driver has a car, has paid their initial deposit, and their
// contract hasn't ended, so the pipeline can't drift out of sync with
// reality the way a manually-picked stage could. If a driver's stored
// stage is a leftover 'active' from before this existed but they no
// longer qualify (car reassigned, contract ended), this falls back to
// 'ready' rather than trusting the stale stored value.
export function effectiveStage<T extends StageLike>(driver: T): DriverStage {
  const isActive = driver.contract_status === 'active' && !!driver.vehicle_id && driver.initial_deposit_paid;
  if (isActive) return 'active';
  return driver.stage === 'active' ? 'ready' : driver.stage;
}

// Ended drivers still available to pick as "who this new hire replaces" -
// once claimed by some other driver's replaced_driver_id (DB-enforced to
// at most one claim each), they drop out of this list for good.
export function availableForReplacement(drivers: Driver[], excludeDriverId?: string): Driver[] {
  const claimed = new Set(drivers.map((d) => d.replaced_driver_id).filter((id): id is string => !!id));
  return drivers.filter((d) => d.contract_status === 'ended' && d.id !== excludeDriverId && !claimed.has(d.id));
}

export const CONTRACT_END_REASONS: { key: string; label: string }[] = [
  { key: 'missed_deposits', label: 'Failure to make weekly deposits' },
  { key: 'another_job', label: 'Found another job' },
  { key: 'personal_reasons', label: 'Personal reasons' },
  { key: 'medical', label: 'Medical / sickness' },
  { key: 'other', label: 'Other' },
];

export const WEEKLY_DEPOSIT_AMOUNT = 180000;

export const DEPOSIT_PAYMENT_METHODS: { key: DepositPaymentMethod; label: string }[] = [
  { key: 'momo', label: 'MoMo' },
  { key: 'bank', label: 'Bank Transfer' },
];

export const REST_DAYS: { key: DriverRestDay; label: string; short: string }[] = [
  { key: 'monday', label: 'Monday', short: 'Mon' },
  { key: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { key: 'thursday', label: 'Thursday', short: 'Thu' },
  { key: 'friday', label: 'Friday', short: 'Fri' },
  { key: 'saturday', label: 'Saturday', short: 'Sat' },
  { key: 'sunday', label: 'Sunday', short: 'Sun' },
];

// Every driver pays on the same day: by Sunday, for the Monday-Sunday
// week ahead. Each working day costs 30,000 and the weekly rest day is
// free, so a full week is 6 x 30,000 = 180,000. Monday morning is the
// gate - a driver whose payments don't yet cover every working day up
// to the coming Sunday isn't cleared to drive. That single check also
// produces the new-driver rule on its own: 180,000 upfront on the start
// day, then on the first Sunday a top-up for the days already driven,
// then 180,000 every Sunday after.
export const DAILY_DEPOSIT_RATE = 30000;

// First Monday the Sunday rule is enforced (payments due Sunday 11 Oct
// 2026). Weeks before it ran on the old rolling 7-day cycle from each
// driver's start date, so they're never scored or shown as weekly
// history - only the running balance carries across.
export const SUNDAY_RULE_START = '2026-10-12';

// Only what the standing math needs - lets the MD dashboard's lighter
// partial-row snapshot fetch feed this the same as a full DriverDeposit.
export interface DepositLike {
  paid_date: string;
  amount: number;
  created_at: string;
}

export interface DepositDriverLike {
  start_date: string | null;
  rest_day: DriverRestDay | null;
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
  // Working days already driven but not yet paid for - the same truth
  // under the old rule and the new one, used before the rule starts.
  behind: number;
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

function shiftDay(d: string, n: number): string {
  return dateStr(addDays(parseDay(d), n));
}

function isoWeekday(d: string): number {
  const w = parseDay(d).getDay();
  return w === 0 ? 7 : w;
}

function restDayIso(restDay: DriverRestDay | null): number {
  return REST_DAYS.findIndex((r) => r.key === restDay) + 1;
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

export function countWorkingDays(from: string, to: string, restDay: DriverRestDay | null): number {
  const rest = restDayIso(restDay);
  let n = 0;
  for (let d = from; d <= to; d = shiftDay(d, 1)) if (isoWeekday(d) !== rest) n++;
  return n;
}

// The last day a given total covers, walking working days from the start
// date at 30,000 each - a rest day right after the last paid working day
// counts as covered too, since it costs nothing.
export function paidThroughDate(startDate: string, restDay: DriverRestDay | null, amount: number): string | null {
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
export function firstSundayPayment(startDate: string, restDay: DriverRestDay | null): { date: string; amount: number } {
  const switchoverSunday = shiftDay(SUNDAY_RULE_START, -1);
  const firstSunday = sundayOf(startDate) < switchoverSunday ? switchoverSunday : sundayOf(startDate);
  const amount = countWorkingDays(startDate, shiftDay(firstSunday, 7), restDay) * DAILY_DEPOSIT_RATE - WEEKLY_DEPOSIT_AMOUNT;
  return { date: firstSunday, amount: Math.max(amount, 0) };
}

export function computeDepositStanding(driver: DepositDriverLike, deposits: DepositLike[], today: string = todayStr()): DepositStanding {
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
      hasStarted: false, ruleInForce, periods: [], current: null, totalPaid, paidThrough: null, behind: 0,
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
  const behind = Math.max(costThrough(today) - paidToDate, 0);
  const owedNow = ruleInForce && current ? Math.max(current.required - paidToDate, 0) : behind;
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
    behind,
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

export type DepositTier = 'red' | 'yellow' | 'green' | 'neutral';

// Red: not cleared (or, before the rule starts, behind). Yellow: cleared
// for now but next Sunday's payment isn't in and Sunday is today or
// tomorrow. Green: already paid for the coming week. Neutral: cleared,
// mid-week, nothing to flag yet.
export function depositStandingTier(s: DepositStanding, today: string = todayStr()): DepositTier {
  if (!s.hasStarted) return 'neutral';
  if (!s.isCleared) return 'red';
  if (s.nextDueAmount <= 0) return 'green';
  if (s.nextDueDate && daysUntilDate(today, s.nextDueDate) <= 1) return 'yellow';
  return 'neutral';
}

export const DEPOSIT_TIER_STYLE: Record<DepositTier, { dot: string; text: string; badge: string }> = {
  red: { dot: 'bg-red-500', text: 'text-red-500', badge: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10' },
  yellow: { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', badge: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10' },
  green: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', badge: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' },
  neutral: { dot: 'bg-gray-200 dark:bg-white/10', text: 'text-gray-400', badge: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5' },
};

// Some displays (the deposits list's side bar, the remaining-balance
// line) want a simpler 3-color read than the tier badge: green for every
// day that isn't a countdown yet, folding "neutral" into "green" rather
// than leaving it gray, yellow with one day left, red from the due day
// onward.
export function foldDepositTier(tier: DepositTier): 'red' | 'yellow' | 'green' {
  return tier === 'neutral' ? 'green' : tier;
}

export function depositRemainingColor(tier: DepositTier): string {
  return DEPOSIT_TIER_STYLE[foldDepositTier(tier)].text;
}

export function formatRwf(amount: number): string {
  return `${amount.toLocaleString()} RWF`;
}

export function depositStandingLabel(s: DepositStanding, today: string = todayStr()): string {
  if (!s.hasStarted) return 'Not started';
  if (!s.isCleared) {
    if (!s.ruleInForce) return `Behind ${formatRwf(s.behind)}`;
    const lost = s.current?.daysLost ?? 0;
    return lost > 0 ? `Not cleared · ${lost}d lost` : 'Not cleared to drive';
  }
  if (s.nextDueAmount <= 0) return 'Paid for next week';
  const days = s.nextDueDate ? daysUntilDate(today, s.nextDueDate) : null;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return s.ruleInForce ? 'Cleared to drive' : 'Up to date';
}

// Every working day lost to an unpaid week costs 30 points - there's no
// reward for paying on time, only a cost for being late. Counted only
// from the switch-over week onward.
export const DEPOSIT_LATE_PENALTY_PER_DAY = 30;

export interface LeaderboardRow {
  driver: Driver;
  standing: DepositStanding;
  tier: DepositTier;
}

// One ranking, reused by Fleet's Leaderboard, the same tab inside the
// MD/Call Center/IT Fleet view, and Finance's Driver Leaderboard, so it
// can never drift between departments. Ended drivers and anyone without
// a vehicle or start date are excluded - there's nothing to rank.
export function buildDepositLeaderboard<T extends DepositLike & { driver_id: string }>(
  drivers: Driver[],
  deposits: T[],
  today: string = todayStr()
): LeaderboardRow[] {
  return drivers
    .filter((d) => d.contract_status !== 'ended' && d.vehicle_id && d.start_date)
    .map((d) => {
      const standing = computeDepositStanding(d, deposits.filter((dep) => dep.driver_id === d.id), today);
      return { driver: d, standing, tier: depositStandingTier(standing, today) };
    })
    .sort((a, b) => b.standing.score - a.standing.score || Number(b.standing.isCleared) - Number(a.standing.isCleared) || a.driver.full_name.localeCompare(b.driver.full_name));
}

export type FineStatus = 'unpaid' | 'partial' | 'paid';

export function fineAmountPaid(fineId: string, finePayments: DriverFinePayment[]): number {
  return finePayments.filter((p) => p.fine_id === fineId).reduce((sum, p) => sum + p.amount, 0);
}

export function fineStatus(fineAmount: number, amountPaid: number): FineStatus {
  if (amountPaid <= 0) return 'unpaid';
  if (amountPaid >= fineAmount) return 'paid';
  return 'partial';
}

export const FINE_STATUS_STYLE: Record<FineStatus, { dot: string; text: string; badge: string; border: string }> = {
  unpaid: { dot: 'bg-red-500', text: 'text-red-500', badge: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10', border: 'border-red-200 dark:border-red-500/20' },
  partial: { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', badge: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20' },
  paid: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', badge: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20' },
};

export function fineStatusLabel(status: FineStatus, fineAmount: number, amountPaid: number): string {
  if (status === 'paid') return 'Paid in full';
  if (status === 'partial') return `${amountPaid.toLocaleString()} of ${fineAmount.toLocaleString()} RWF paid`;
  return 'Unpaid';
}

export function depositPeriodLabel(p: DepositPeriod): string {
  if (p.state === 'open') return p.daysLost > 0 ? `Not cleared · ${p.daysLost}d lost` : 'Not cleared';
  if (p.state === 'late') return `Cleared ${p.daysLost} day${p.daysLost === 1 ? '' : 's'} late`;
  return 'Cleared on time';
}

export function formatDateLabelSafe(d: string): string {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}
