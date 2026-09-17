import { useEffect, useState, useCallback } from 'react';
import { supabase, Driver, Vehicle, DriverDeposit, DriverFine, DriverFinePayment, DriverStage, DriverRestDay, DepositPaymentMethod, Profile } from './supabase';
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [d, v, dep, fin, finePay] = await Promise.all([
      supabase.from('drivers').select('*, vehicle:vehicles(*)').order('created_at', { ascending: false }),
      supabase.from('vehicles').select('*').order('created_at', { ascending: false }),
      supabase.from('driver_deposits').select('*').order('paid_date', { ascending: false }),
      supabase.from('driver_fines').select('*, driver:drivers(*), vehicle:vehicles(*)').order('fine_date', { ascending: false }),
      supabase.from('driver_fine_payments').select('*').order('paid_date', { ascending: false }),
    ]);
    setDrivers((d.data as Driver[]) ?? []);
    setVehicles((v.data as Vehicle[]) ?? []);
    setDeposits((dep.data as DriverDeposit[]) ?? []);
    setFines((fin.data as DriverFine[]) ?? []);
    setFinePayments((finePay.data as DriverFinePayment[]) ?? []);
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { drivers, vehicles, deposits, fines, finePayments, loading, reload: load };
}

export const STAGES: { key: DriverStage; label: string; color: string }[] = [
  { key: 'applying', label: 'Applying', color: '#9ca3af' },
  { key: 'training', label: 'Training', color: '#f97316' },
  { key: 'active', label: 'Active', color: '#4F7B3E' },
  { key: 'waiting', label: 'Waiting', color: '#2F8C86' },
  { key: 'flagged', label: 'Flagged', color: '#ef4444' },
  { key: 'inactive', label: 'Inactive', color: '#6b7280' },
];

export const WEEKLY_DEPOSIT_AMOUNT = 180000;

export const DEPOSIT_PAYMENT_METHODS: { key: DepositPaymentMethod; label: string }[] = [
  { key: 'momo', label: 'MoMo' },
  { key: 'bank', label: 'Bank Transfer' },
];

// A deposit under the full weekly amount still counts as this week's
// payment (it resets the cycle) but leaves a balance the driver still
// owes for the week - shown in red rather than silently rounded away.
export function depositShortfall(amountPaid: number): number {
  return Math.max(WEEKLY_DEPOSIT_AMOUNT - amountPaid, 0);
}

export const REST_DAYS: { key: DriverRestDay; label: string; short: string }[] = [
  { key: 'monday', label: 'Monday', short: 'Mon' },
  { key: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { key: 'thursday', label: 'Thursday', short: 'Thu' },
  { key: 'friday', label: 'Friday', short: 'Fri' },
  { key: 'saturday', label: 'Saturday', short: 'Sat' },
  { key: 'sunday', label: 'Sunday', short: 'Sun' },
];

// The 7-day deposit cycle counts from whichever is more recent: the last
// driver_deposits row actually logged in this app, or - for a driver
// onboarded before this app tracked deposits - the date their initial
// deposit was paid. Without the latter, every driver entered with
// initial_deposit_paid already true but zero logged rows read as "Never
// paid" and was immediately flagged overdue, regardless of when they
// really paid. Takes plain fields rather than a Driver so it works both
// against full driver rows and the lighter partial rows the MD
// dashboard's snapshot fetches.
export function effectiveLastDepositDate(
  lastLoggedDate: string | null,
  initialDepositPaid: boolean,
  initialDepositDate: string | null
): string | null {
  const initial = initialDepositPaid ? initialDepositDate : null;
  if (lastLoggedDate && initial) return lastLoggedDate > initial ? lastLoggedDate : initial;
  return lastLoggedDate ?? initial ?? null;
}

export function depositDaysSince(
  lastLoggedDate: string | null,
  initialDepositPaid: boolean,
  initialDepositDate: string | null
): number | null {
  const date = effectiveLastDepositDate(lastLoggedDate, initialDepositPaid, initialDepositDate);
  return date ? Math.floor((new Date(todayStr()).getTime() - new Date(date).getTime()) / 86400000) : null;
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

export function depositStatusLabel(daysSince: number | null): string {
  if (daysSince === null) return 'Never paid';
  if (daysSince >= 7) return `Overdue by ${daysSince - 6}d`;
  if (daysSince === 6) return 'Due tomorrow';
  if (daysSince === 5) return 'Due in 2 days';
  return `Paid ${daysSince}d ago`;
}

// The 7-day cycle's next due date, for showing an actual date rather
// than just a day-count - same effective-start-date rule as
// depositDaysSince (last logged deposit, or the initial deposit date
// when nothing's been logged yet).
export function nextDepositDueDate(
  lastLoggedDate: string | null,
  initialDepositPaid: boolean,
  initialDepositDate: string | null
): string | null {
  const effective = effectiveLastDepositDate(lastLoggedDate, initialDepositPaid, initialDepositDate);
  return effective ? dateStr(addDays(new Date(`${effective}T00:00:00`), 7)) : null;
}

export interface DepositReliability {
  onTime: number;
  late: number;
  totalCycles: number;
  totalPaid: number;
  onTimeRate: number | null;
}

// Walks a driver's logged deposits in date order, treating each gap from
// the previous payment (or the initial deposit date, for the first one)
// as one week's cycle - on time if it landed within 7 days, late
// otherwise. This is the closest thing to "how good they are" that can
// be derived from the data actually on file, without inventing a fixed
// due-date ledger the app doesn't otherwise keep.
export function computeDepositReliability(driver: Driver, deposits: DriverDeposit[]): DepositReliability {
  const history = deposits
    .filter((d) => d.driver_id === driver.id)
    .slice()
    .sort((a, b) => a.paid_date.localeCompare(b.paid_date));

  let anchor = driver.initial_deposit_paid ? driver.initial_deposit_date : null;
  let onTime = 0;
  let late = 0;
  let totalPaid = 0;

  for (const dep of history) {
    totalPaid += dep.amount;
    if (anchor) {
      const gapDays = Math.floor((new Date(`${dep.paid_date}T00:00:00`).getTime() - new Date(`${anchor}T00:00:00`).getTime()) / 86400000);
      if (gapDays <= 7) onTime++; else late++;
    }
    anchor = dep.paid_date;
  }

  const totalCycles = onTime + late;
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
