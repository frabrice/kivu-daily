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
  // How the initial deposit itself landed relative to one week's amount -
  // short of it leaves initialRemaining owed, over it leaves initialExtra,
  // which is the same amount already folded into the running cycle below.
  initialRemaining: number;
  initialExtra: number;
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
//
// The cycle's anchor is the driver's start date, not when (or whether)
// the initial deposit was actually paid - a driver is expected to be
// paying from day one of driving, so a driver who's been on since their
// start date without ever paying should show as overdue from that date,
// not show no cycle at all until they eventually pay. initial_deposit_date
// itself is accounting-only now (confirming the money arrived), and no
// longer schedules anything.
//
// The initial deposit amount is still the first payment toward the
// first cycle when it exists, not a freebie the model ignores: short of
// 180k it leaves a balance due (e.g. paid 100k, still owes 80k before
// the first weekly deadline even starts counting against them), and
// over 180k the extra rolls forward as credit against the next cycle
// (e.g. paid 210k, owes only 150k next week) - exactly like an
// overpayment on any later logged deposit rolls into the cycle after it.
export function computeDepositWaterfall<T extends DepositLike>(
  initialDepositPaid: boolean,
  startDate: string | null,
  initialDepositAmount: number | null,
  deposits: T[]
): DepositWaterfall<T> {
  const sorted = [...deposits].sort((a, b) => a.paid_date.localeCompare(b.paid_date) || a.created_at.localeCompare(b.created_at));
  let anchor = startDate;
  const initialAmount = initialDepositPaid ? (initialDepositAmount ?? 0) : 0;
  const initialRemaining = anchor ? Math.max(WEEKLY_DEPOSIT_AMOUNT - initialAmount, 0) : 0;
  const initialExtra = anchor ? Math.max(initialAmount - WEEKLY_DEPOSIT_AMOUNT, 0) : 0;
  const initialCloses = anchor ? initialAmount >= WEEKLY_DEPOSIT_AMOUNT : false;
  // Short of the week, the initial deposit itself is what's still owed.
  // At or over the week, the cycle it opened is done - the next one
  // starts fresh (0, or the rollover credit if there was extra) rather
  // than leaving the full weekly amount sitting in paidInCycle forever,
  // which would make every later week look already covered with no
  // deposit ever logged for it.
  let paidInCycle = anchor ? Math.min(initialAmount, WEEKLY_DEPOSIT_AMOUNT) : 0;
  if (initialCloses) paidInCycle = initialExtra;
  let totalPaid = initialAmount;
  const annotated: AnnotatedDeposit<T>[] = [];
  const closedCycles: ClosedDepositCycle[] = [];

  for (const dep of sorted) {
    totalPaid += dep.amount;
    if (!anchor) {
      // No start date on file - the first-ever logged payment starts the first cycle itself.
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
      paidInCycle = extra; // overpaying this cycle rolls the excess into the next one too
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
    initialRemaining,
    initialExtra,
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
  const wf = computeDepositWaterfall(driver.initial_deposit_paid, driver.start_date, driver.initial_deposit_amount, driverDeposits);
  const onTime = wf.closedCycles.filter((c) => c.onTime).length;
  const late = wf.closedCycles.filter((c) => !c.onTime).length;
  const totalCycles = onTime + late;
  return { onTime, late, totalCycles, totalPaid: wf.totalPaid, onTimeRate: totalCycles > 0 ? Math.round((onTime / totalCycles) * 100) : null };
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
