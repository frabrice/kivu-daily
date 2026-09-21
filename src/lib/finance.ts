import { useEffect, useState, useCallback } from 'react';
import {
  supabase, FinanceAccount, FinanceTransaction, FinanceTransactionType, FinanceDirection,
  FinanceReconciliation, PayrollRun, Driver, DriverDeposit, Vehicle, VehicleOwner, Profile, Document as Doc,
} from './supabase';
import { todayStr } from './utils';

// Every dedicated Finance page (Revenue, Fleet Collections, Vehicle-Owner
// Payments, Payroll, Suppliers, Transfers, Expense Claims, Accounts,
// Reconciliation, Dashboard) reads from this one shared load - the SOP's
// bank accounts and transaction ledger are one underlying model, just
// presented as separate pages instead of tabs sharing one screen.
export function useFinanceData() {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [reconciliations, setReconciliations] = useState<FinanceReconciliation[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [deposits, setDeposits] = useState<DriverDeposit[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [owners, setOwners] = useState<VehicleOwner[]>([]);
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Weekly margin, owner payouts and monthly management fees are schedule-
    // driven off each vehicle's operation_start_date, not tied to any single
    // driver deposit - this brings the ledger current every time Finance
    // opens the app, without needing a cron job. Awaited first so freshly
    // generated rows show up in the same load.
    try { await supabase.rpc('sync_vehicle_obligations'); } catch { /* ignore */ }

    const [acc, tx, rec, pr, d, dep, v, own, emp, docs] = await Promise.all([
      supabase.from('finance_accounts').select('*').order('key'),
      supabase
        .from('finance_transactions')
        .select('*, account:finance_accounts(*), linked_vehicle:vehicles(*), linked_driver:drivers(*), preparer:profiles!finance_transactions_prepared_by_fkey(*), checker:profiles!finance_transactions_checked_by_fkey(*), approver:profiles!finance_transactions_approved_by_fkey(*), supporting_document:documents(*)')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('finance_reconciliations').select('*, account:finance_accounts(*), reconciler:profiles(*)').order('period', { ascending: false }),
      supabase.from('payroll_runs').select('*, lines:payroll_lines(*, employee:profiles(*))').order('period', { ascending: false }),
      supabase.from('drivers').select('*, vehicle:vehicles(*)'),
      supabase.from('driver_deposits').select('*'),
      supabase.from('vehicles').select('*, owner:vehicle_owners(*)'),
      supabase.from('vehicle_owners').select('*').order('full_name'),
      supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
      supabase.from('documents').select('*').order('created_at', { ascending: false }),
    ]);
    setAccounts((acc.data as FinanceAccount[]) ?? []);
    setTransactions((tx.data as FinanceTransaction[]) ?? []);
    setReconciliations((rec.data as FinanceReconciliation[]) ?? []);
    setPayrollRuns((pr.data as PayrollRun[]) ?? []);
    setDrivers((d.data as Driver[]) ?? []);
    setDeposits((dep.data as DriverDeposit[]) ?? []);
    setVehicles((v.data as Vehicle[]) ?? []);
    setOwners((own.data as VehicleOwner[]) ?? []);
    setEmployees((emp.data as Profile[]) ?? []);
    setDocuments((docs.data as Doc[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('finance-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_transactions' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_reconciliations' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_runs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_lines' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_owners' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_deposits' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const accountBalance = useCallback(
    (accountId: string) => {
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc) return 0;
      let bal = acc.opening_balance;
      for (const t of transactions) {
        if (t.account_id !== accountId) continue;
        bal += t.direction === 'in' ? t.amount : -t.amount;
      }
      return bal;
    },
    [accounts, transactions]
  );

  const balances: Record<string, number> = {};
  for (const a of accounts) balances[a.key] = accountBalance(a.id);

  return {
    accounts, transactions, reconciliations, payrollRuns, drivers, deposits, vehicles, owners, employees, documents,
    loading, reload: load, accountBalance, balances,
  };
}

export const TYPE_META: Record<FinanceTransactionType, { label: string; defaultDirection: FinanceDirection }> = {
  revenue: { label: 'Revenue', defaultDirection: 'in' },
  fleet_collection: { label: 'Fleet Collection', defaultDirection: 'in' },
  vehicle_owner_payment: { label: 'Vehicle-Owner Payment', defaultDirection: 'out' },
  payroll: { label: 'Payroll', defaultDirection: 'out' },
  supplier_payment: { label: 'Supplier Payment', defaultDirection: 'out' },
  transfer: { label: 'Inter-Bank Transfer', defaultDirection: 'out' },
  expense_claim: { label: 'Expense Claim', defaultDirection: 'out' },
  other: { label: 'Other', defaultDirection: 'out' },
  onboarding_fee: { label: 'Onboarding Fee', defaultDirection: 'in' },
  management_margin: { label: 'Management Margin', defaultDirection: 'in' },
};

// What actually counts as Kivu's own income for a "revenue" figure -
// fleet_collection is deliberately excluded even though it's cash 'in':
// most of it (240k of the 360k/week collected per managed car) is money
// that passes straight through to the vehicle owner, not Kivu's to keep.
// Only the margin on that spread, the flat monthly/onboarding fees, and
// whatever Finance logs directly as 'revenue' (trip commissions etc.)
// are genuine income.
export const KIVU_REVENUE_TYPES: FinanceTransactionType[] = ['revenue', 'management_margin', 'onboarding_fee'];

export const STATUS_META = {
  pending: { label: 'Pending', color: '#9ca3af' },
  checked: { label: 'Checked', color: '#f97316' },
  approved: { label: 'Approved', color: '#2F8C86' },
  posted: { label: 'Posted', color: '#4F7B3E' },
  rejected: { label: 'Rejected', color: '#ef4444' },
} as const;

export const WEEKLY_DEPOSIT_AMOUNT = 180000; // mirrors Fleet's driver_deposits weekly amount

export function fmt(n: number): string {
  return `${Math.round(n).toLocaleString()} RWF`;
}

export function sumWhere(
  rows: FinanceTransaction[],
  type: FinanceTransactionType | FinanceTransactionType[],
  direction: FinanceDirection
): number {
  const types = Array.isArray(type) ? type : [type];
  return rows.filter((t) => types.includes(t.type) && t.direction === direction).reduce((s, t) => s + t.amount, 0);
}

// ============================================================
// CAR MANAGEMENT MODEL (confirmed with the operator 2026-09-19)
// ============================================================
// The two shift drivers on a managed car together pay 60,000/day x 6 =
// 360,000/week into Bank of Kigali - exactly WEEKLY_DEPOSIT_AMOUNT x 2,
// since it's the same driver_deposits system already tracked per driver.
// That's the car's operating remittance, not a refundable deposit. The
// owner is paid a flat daily rate x 6 days/week regardless of what was
// actually collected (Kivu absorbs collection risk) - 40,000/day is the
// default (240,000/week), but this varies by car/car type (e.g. Naya
// Solutions' car pays 45,000/day = 270,000/week), so it's editable per
// vehicle (see SetVehicleStartDateDrawer / OnboardVehicleOwnerDrawer).
// The gap between what's collected and what's paid out is Kivu's
// management margin, recognized straight to Equity. Owners also pay a
// separate flat monthly management fee, also to Equity.
export const WEEKLY_COLLECTION_TARGET = WEEKLY_DEPOSIT_AMOUNT * 2; // 360,000 - both shifts
export const OWNER_PAYOUT_DAYS_PER_WEEK = 6;
export const DAILY_OWNER_PAYOUT_DEFAULT = 40000;
export const WEEKLY_OWNER_PAYOUT_DEFAULT = DAILY_OWNER_PAYOUT_DEFAULT * OWNER_PAYOUT_DAYS_PER_WEEK; // 240,000
export const WEEKLY_MANAGEMENT_MARGIN_DEFAULT = WEEKLY_COLLECTION_TARGET - WEEKLY_OWNER_PAYOUT_DEFAULT; // 120,000
export const MONTHLY_MANAGEMENT_FEE_DEFAULT = 30000;

// Onboarding a new managed car: a one-time 140,000 fee (120k device +
// 20k branding) against 90k device cost + 15k branding cost + 15k
// uniforms (7,500 x 2 drivers) - a one-time margin of 20,000 per car.
export const ONBOARDING_FEE = 140000;
export const ONBOARDING_DEVICE_CHARGE = 120000;
export const ONBOARDING_DEVICE_COST = 90000;
export const ONBOARDING_BRANDING_CHARGE = 20000;
export const ONBOARDING_BRANDING_COST = 15000;
export const ONBOARDING_UNIFORM_COST_PER_DRIVER = 7500;
export const ONBOARDING_UNIFORM_COST = ONBOARDING_UNIFORM_COST_PER_DRIVER * 2;

export interface VehicleObligations {
  weeksElapsed: number;
  weeklyPayout: number;
  weeklyMargin: number;
  monthlyFee: number;
  ownerPaid: number;
  ownerPending: number;
  marginRecognized: number;
  managementFeeRecognized: number;
}

// What a managed car owes/earns, read back from the transactions
// sync_vehicle_obligations() already generated on the server - this
// doesn't compute anything new, it just totals what's already there.
export function computeVehicleObligations(vehicle: Vehicle, transactions: FinanceTransaction[]): VehicleObligations {
  const weeklyPayout = vehicle.weekly_owner_payout_amount ?? WEEKLY_OWNER_PAYOUT_DEFAULT;
  const weeklyMargin = WEEKLY_COLLECTION_TARGET - weeklyPayout;
  const monthlyFee = vehicle.monthly_management_fee_amount ?? MONTHLY_MANAGEMENT_FEE_DEFAULT;
  const weeksElapsed = vehicle.operation_start_date
    ? Math.max(Math.floor((new Date(todayStr()).getTime() - new Date(`${vehicle.operation_start_date}T00:00:00`).getTime()) / (7 * 86400000)), 0)
    : 0;

  const vehicleTx = transactions.filter((t) => t.linked_vehicle_id === vehicle.id);
  const ownerPaid = vehicleTx.filter((t) => t.type === 'vehicle_owner_payment' && t.status === 'posted').reduce((s, t) => s + t.amount, 0);
  const ownerPending = vehicleTx.filter((t) => t.type === 'vehicle_owner_payment' && t.status === 'pending').reduce((s, t) => s + t.amount, 0);
  const marginRecognized = vehicleTx.filter((t) => t.type === 'management_margin').reduce((s, t) => s + t.amount, 0);
  const managementFeeRecognized = vehicleTx
    .filter((t) => t.type === 'revenue' && t.description?.startsWith('Monthly management fee'))
    .reduce((s, t) => s + t.amount, 0);

  return { weeksElapsed, weeklyPayout, weeklyMargin, monthlyFee, ownerPaid, ownerPending, marginRecognized, managementFeeRecognized };
}

