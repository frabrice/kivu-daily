import { useEffect, useState, useCallback } from 'react';
import { supabase, Driver, Vehicle, DriverDeposit, DriverFine, DriverFinePayment, DriverContractEvent, DriverDocument, DriverDocumentType, DriverStage, DriverContractStatus, DriverRestDay, DepositPaymentMethod, Profile } from './supabase';
import { todayStr } from './utils';

// Who may change Fleet data - kept in step with the RLS policies. Call
// Center sees the same bundled Fleet view but read-only (confirmed with
// the operator): the only thing they may set is a Non-Insider car's
// branding / device answers, see canSetCarInterest.
const FLEET_EDIT_DEPARTMENTS = ['fleet', 'it'];

export function canEditFleet(profile: Profile | null | undefined): boolean {
  return profile?.role === 'managing_director' || FLEET_EDIT_DEPARTMENTS.includes(profile?.department?.slug ?? '');
}

// Is branded / allows branding / wants our device, plus a note - via the
// set_platform_car_interest RPC.
export function canSetCarInterest(profile: Profile | null | undefined): boolean {
  return canEditFleet(profile) || profile?.department?.slug === 'call_center';
}

// Driver documents (ID, criminal record, medical) are hidden from Call Center.
export function canSeeDriverDocuments(profile: Profile | null | undefined): boolean {
  return profile?.department?.slug !== 'call_center';
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

// The weekly-payment rule lives in a dependency-free shared module so the
// email notification engine computes exactly the same standing as the app.
export * from '../../supabase/functions/_shared/depositRules';
import { computeDepositStanding, daysUntilDate } from '../../supabase/functions/_shared/depositRules';
import type { DepositLike, DepositPeriod, DepositStanding } from '../../supabase/functions/_shared/depositRules';

export type DepositTier = 'red' | 'yellow' | 'green' | 'neutral';

// Red: owes for days already worked, or not cleared to drive. Yellow:
// owes nothing yet but is behind on the week, or next Sunday's payment
// isn't in and Sunday is today or tomorrow. Green: already paid for the
// coming week. Neutral: up to date, mid-week, nothing to flag yet.
export function depositStandingTier(s: DepositStanding, today: string = todayStr()): DepositTier {
  if (!s.hasStarted) return 'neutral';
  if (!s.isCleared || s.owes > 0) return 'red';
  if (s.weekBehind > 0) return 'yellow';
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

// The badge on the right: Behind = the whole week still unpaid (it should
// have been paid on the week's first day). The red "Owes" line beside the
// name is depositOwesLabel.
export function depositStandingLabel(s: DepositStanding, today: string = todayStr()): string {
  if (!s.hasStarted) return 'Not started';
  if (s.weekBehind > 0) {
    const lost = s.ruleInForce ? s.current?.daysLost ?? 0 : 0;
    return `Behind ${formatRwf(s.weekBehind)}${lost > 0 ? ` · ${lost}d lost` : ''}`;
  }
  if (s.nextDueAmount <= 0) return 'Paid for next week';
  const days = s.nextDueDate ? daysUntilDate(today, s.nextDueDate) : null;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return s.ruleInForce ? 'Cleared to drive' : 'Up to date';
}

// The red line: working days already driven and not paid for. Null when
// nothing is owed (even if the driver is still behind on the week).
export function depositOwesLabel(s: DepositStanding): string | null {
  return s.hasStarted && s.owes > 0 ? `Owes ${formatRwf(s.owes)}` : null;
}

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
