import { useEffect, useState, useCallback } from 'react';
import {
  supabase, FinanceAccount, FinanceTransaction, FinanceTransactionType, FinanceDirection,
  FinanceReconciliation, PayrollRun, Driver, Vehicle, Profile, Document as Doc,
} from './supabase';

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
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [acc, tx, rec, pr, d, v, emp, docs] = await Promise.all([
      supabase.from('finance_accounts').select('*').order('key'),
      supabase
        .from('finance_transactions')
        .select('*, account:finance_accounts(*), linked_vehicle:vehicles(*), linked_driver:drivers(*), preparer:profiles!finance_transactions_prepared_by_fkey(*), checker:profiles!finance_transactions_checked_by_fkey(*), approver:profiles!finance_transactions_approved_by_fkey(*), supporting_document:documents(*)')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('finance_reconciliations').select('*, account:finance_accounts(*), reconciler:profiles(*)').order('period', { ascending: false }),
      supabase.from('payroll_runs').select('*, lines:payroll_lines(*, employee:profiles(*))').order('period', { ascending: false }),
      supabase.from('drivers').select('*, vehicle:vehicles(*)'),
      supabase.from('vehicles').select('*'),
      supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
      supabase.from('documents').select('*').order('created_at', { ascending: false }),
    ]);
    setAccounts((acc.data as FinanceAccount[]) ?? []);
    setTransactions((tx.data as FinanceTransaction[]) ?? []);
    setReconciliations((rec.data as FinanceReconciliation[]) ?? []);
    setPayrollRuns((pr.data as PayrollRun[]) ?? []);
    setDrivers((d.data as Driver[]) ?? []);
    setVehicles((v.data as Vehicle[]) ?? []);
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
    accounts, transactions, reconciliations, payrollRuns, drivers, vehicles, employees, documents,
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
};

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

