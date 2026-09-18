import { useEffect, useState, useCallback } from 'react';
import { supabase, Driver, Vehicle, DriverDeposit, DriverFine, DriverFinePayment, DriverContractEvent, DriverStage, DriverRestDay, DepositPaymentMethod, Profile } from './supabase';
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [d, v, dep, fin, finePay, contractEvts] = await Promise.all([
      supabase.from('drivers').select('*, vehicle:vehicles(*)').order('created_at', { ascending: false }),
      supabase.from('vehicles').select('*').order('created_at', { ascending: false }),
      supabase.from('driver_deposits').select('*').order('paid_date', { ascending: false }),
      supabase.from('driver_fines').select('*, driver:drivers(*), vehicle:vehicles(*)').order('fine_date', { ascending: false }),
      supabase.from('driver_fine_payments').select('*').order('paid_date', { ascending: false }),
      supabase.from('driver_contract_events').select('*').order('event_date', { ascending: false }),
    ]);
    setDrivers((d.data as Driver[]) ?? []);
    setVehicles((v.data as Vehicle[]) ?? []);
    setDeposits((dep.data as DriverDeposit[]) ?? []);
    setFines((fin.data as DriverFine[]) ?? []);
    setFinePayments((finePay.data as DriverFinePayment[]) ?? []);
    setContractEvents((contractEvts.data as DriverContractEvent[]) ?? []);
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { drivers, vehicles, deposits, fines, finePayments, contractEvents, loading, reload: load };
}

export const STAGES: { key: DriverStage; label: string; color: string }[] = [
  { key: 'applying', label: 'Applying', color: '#9ca3af' },
  { key: 'training', label: 'Training', color: '#f97316' },
  { key: 'active', label: 'Active', color: '#4F7B3E' },
  { key: 'waiting', label: 'Waiting', color: '#2F8C86' },
  { key: 'flagged', label: 'Flagged', color: '#ef4444' },
  { key: 'inactive', label: 'Inactive', color: '#6b7280' },
];

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

// Only what the waterfall math actually needs - lets the MD dashboard's
// lighter partial-row snapshot fetch feed this the same as a full
// DriverDeposit from useFleetData.
export interface DepositLike {
  paid_date: string;
  amount: number;
  created_at: string;
}

export interface AnnotatedDeposit<T extends DepositLike = DriverDeposit> {
  deposit: T;
  cumulativeBefore: number;
  cumulativeAfter: number;
  remainingAfter: number;
  extra: number;
  closesCycle: boolean;
  cycleAnchor: string;
}

export interface ClosedDepositCycle {
  anchor: string;
  closedDate: string;
  gapDays: number;
  onTime: boolean;
}

export interface DepositWaterfall<T extends DepositLike = DriverDeposit> {
  annotated: AnnotatedDeposit<T>[];
  closedCycles: ClosedDepositCycle[];
  currentAnchor: string | null;
  currentPaid: number;
  currentRemaining: number;
  totalPaid: number;
}

// Deposits are weekly and paid in advance, but not always in one go - a
// driver can pay in installments (30k, then 40k, then 60k) before their
// deadline, and each partial payment must still be logged without
// resetting the clock the way a single "any payment resets the 7-day
// countdown" model would. This walks a driver's deposits oldest-first,
// accumulating them into the CURRENT weekly cycle until the cumulative
// total reaches the full weekly amount - only then does the cycle
// actually close and the next one's 7-day clock start, from the date
// that closing payment landed on. Everything in between (how much is
// still owed, whether a given payment finished the week or overpaid it)
// falls out of this same walk instead of a separate flat calculation.
export function computeDepositWaterfall<T extends DepositLike>(
  initialDepositPaid: boolean,
  initialDepositDate: string | null,
  deposits: T[]
): DepositWaterfall<T> {
  const sorted = [...deposits].sort((a, b) => a.paid_date.localeCompare(b.paid_date) || a.created_at.localeCompare(b.created_at));
  let anchor = initialDepositPaid ? initialDepositDate : null;
  let paidInCycle = 0;
  let totalPaid = 0;
  const annotated: AnnotatedDeposit<T>[] = [];
  const closedCycles: ClosedDepositCycle[] = [];

  for (const dep of sorted) {
    totalPaid += dep.amount;
    if (!anchor) {
      // No initial deposit on file - the first-ever logged payment starts the first cycle itself.
      anchor = dep.paid_date;
      paidInCycle = 0;
    }
    const cumulativeBefore = paidInCycle;
    const cumulativeAfter = cumulativeBefore + dep.amount;
    const closesCycle = cumulativeAfter >= WEEKLY_DEPOSIT_AMOUNT;
    const remainingAfter = Math.max(WEEKLY_DEPOSIT_AMOUNT - cumulativeAfter, 0);
    const extra = Math.max(cumulativeAfter - WEEKLY_DEPOSIT_AMOUNT, 0);
    const cycleAnchor = anchor;

    annotated.push({ deposit: dep, cumulativeBefore, cumulativeAfter, remainingAfter, extra, closesCycle, cycleAnchor });

    if (closesCycle) {
      const gapDays = Math.floor((new Date(`${dep.paid_date}T00:00:00`).getTime() - new Date(`${cycleAnchor}T00:00:00`).getTime()) / 86400000);
      closedCycles.push({ anchor: cycleAnchor, closedDate: dep.paid_date, gapDays, onTime: gapDays <= 7 });
      anchor = dep.paid_date;
      paidInCycle = 0;
    } else {
      paidInCycle = cumulativeAfter;
    }
  }

  return {
    annotated,
    closedCycles,
    currentAnchor: anchor,
    currentPaid: paidInCycle,
    currentRemaining: Math.max(WEEKLY_DEPOSIT_AMOUNT - paidInCycle, 0),
    totalPaid,
  };
}

export function depositDaysSince(anchor: string | null): number | null {
  return anchor ? Math.floor((new Date(todayStr()).getTime() - new Date(`${anchor}T00:00:00`).getTime()) / 86400000) : null;
}

export type DepositTier = 'red' | 'yellow' | 'green' | 'neutral';

// Traffic-light heads-up on top of the 7-day cycle: green 2 days before
// the deposit is due, yellow 1 day before, red on the due day itself
// (and every day it stays unpaid past that). Neutral covers the rest of
// the cycle, where there's nothing to flag yet.
export function depositTier(daysSince: number | null): DepositTier {
  if (daysSince === null || daysSince >= 7) return 'red';
  if (daysSince === 6) return 'yellow';
  if (daysSince === 5) return 'green';
  return 'neutral';
}

export const DEPOSIT_TIER_STYLE: Record<DepositTier, { dot: string; text: string; badge: string }> = {
  red: { dot: 'bg-red-500', text: 'text-red-500', badge: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10' },
  yellow: { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', badge: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10' },
  green: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', badge: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' },
  neutral: { dot: 'bg-gray-200 dark:bg-white/10', text: 'text-gray-400', badge: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5' },
};

// The "X RWF remaining this week" line reads as a simpler 3-color signal
// than the tier badge above it: green for every day that isn't a
// countdown yet (folding "neutral" in with "green" rather than leaving
// it gray), yellow with one day left, red from the due day onward.
export function depositRemainingColor(tier: DepositTier): string {
  if (tier === 'red') return 'text-red-500';
  if (tier === 'yellow') return 'text-amber-500 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

export function depositStatusLabel(daysSince: number | null): string {
  if (daysSince === null) return 'Never paid';
  if (daysSince >= 7) return `Overdue by ${daysSince - 6}d`;
  if (daysSince === 6) return 'Due tomorrow';
  if (daysSince === 5) return 'Due in 2 days';
  return `Paid ${daysSince}d ago`;
}

// The current cycle's due date, for showing an actual date rather than
// just a day-count.
export function nextDepositDueDate(anchor: string | null): string | null {
  return anchor ? dateStr(addDays(new Date(`${anchor}T00:00:00`), 7)) : null;
}

export interface DepositReliability {
  onTime: number;
  late: number;
  totalCycles: number;
  totalPaid: number;
  onTimeRate: number | null;
}

// "How good they are" derived from the same waterfall used for the
// current-cycle status - a cycle only counts as a completed data point
// once its cumulative payments actually reached the full weekly amount,
// on time if that happened within 7 days of the cycle's own start.
export function computeDepositReliability(driver: Driver, deposits: DriverDeposit[]): DepositReliability {
  const driverDeposits = deposits.filter((d) => d.driver_id === driver.id);
  const wf = computeDepositWaterfall(driver.initial_deposit_paid, driver.initial_deposit_date, driverDeposits);
  const onTime = wf.closedCycles.filter((c) => c.onTime).length;
  const late = wf.closedCycles.filter((c) => !c.onTime).length;
  const totalCycles = onTime + late;
  const totalPaid = wf.totalPaid + (driver.initial_deposit_paid ? (driver.initial_deposit_amount ?? 0) : 0);
  return { onTime, late, totalCycles, totalPaid, onTimeRate: totalCycles > 0 ? Math.round((onTime / totalCycles) * 100) : null };
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

export function formatDateLabelSafe(d: string): string {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}
