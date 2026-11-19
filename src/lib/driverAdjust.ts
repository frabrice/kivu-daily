import { useCallback, useEffect, useState } from 'react';
import { supabase, Driver, DriverDeposit, DriverFine, DriverFinePayment, DriverMoneyReview } from './supabase';
import { computeDepositStanding, contractPayments, workingCost, fineAmountPaid, fineKindLabel } from './fleet';
import type { DepositStanding } from './fleet';
import { kigaliToday } from './kigali';

// Driver Adjust (MD Panel, 19 Nov 2026): the MD confirms every driver's
// money once - start date, start deposit, last payment, paid until, what
// they owe besides, what we owe them - and from then on confirms whatever
// anyone else records. A driver may be behind (this week not paid yet) but
// never owe (days already driven and not paid).

// Salary Finance has not paid yet (driver_payroll stays 'pending' until paid).
export interface PayrollRow { id: string; linked_driver_id: string | null; amount: number; transaction_date: string; description: string | null }

export function useDriverAdjustExtras() {
  const [reviews, setReviews] = useState<DriverMoneyReview[]>([]);
  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const [r, p, people] = await Promise.all([
      supabase.from('driver_money_reviews').select('*').order('created_at', { ascending: false }),
      supabase.from('finance_transactions').select('id, linked_driver_id, amount, transaction_date, description')
        .eq('type', 'driver_payroll').eq('status', 'pending').order('transaction_date'),
      supabase.from('profiles').select('id, full_name'),
    ]);
    setNames(new Map(((people.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name])));
    setReviews((r.data as DriverMoneyReview[]) ?? []);
    setPayroll(((p.data ?? []) as PayrollRow[]).map((x) => ({ ...x, amount: Number(x.amount) })));
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { reviews, payroll, names, loading, reload };
}

// Anything someone other than the MD recorded, waiting for the MD.
export type PendingKind = 'deposit' | 'fine' | 'fine_payment' | 'adjustment';
export interface PendingItem { kind: PendingKind; id: string; driverId: string; date: string; amount: number; what: string; by: string | null }

export function pendingItems(drivers: Driver[], deposits: DriverDeposit[], fines: DriverFine[], finePayments: DriverFinePayment[]): PendingItem[] {
  const fineById = new Map(fines.map((f) => [f.id, f]));
  return [
    ...deposits.filter((d) => d.status === 'pending').map((d) => ({ kind: 'deposit' as const, id: d.id, driverId: d.driver_id, date: d.paid_date, amount: Number(d.amount), what: `Payment · ${d.payment_method === 'momo' ? 'MoMo' : d.bank_name ?? 'Bank'}`, by: d.created_by })),
    ...fines.filter((f) => f.status === 'pending').map((f) => ({ kind: 'fine' as const, id: f.id, driverId: f.driver_id, date: f.fine_date, amount: Number(f.amount), what: `${fineKindLabel(f.kind)}${f.reason ? ` · ${f.reason}` : ''}`, by: f.created_by })),
    ...finePayments.filter((p) => p.status === 'pending' && fineById.has(p.fine_id)).map((p) => {
      const f = fineById.get(p.fine_id)!;
      return { kind: 'fine_payment' as const, id: p.id, driverId: f.driver_id, date: p.paid_date, amount: Number(p.amount), what: `Paid on a ${fineKindLabel(f.kind).toLowerCase()}${f.reason ? ` (${f.reason})` : ''}`, by: p.created_by };
    }),
    ...drivers.flatMap((d) => (d.balance_adjustments ?? []).filter((a) => a.status === 'pending').map((a) => ({
      kind: 'adjustment' as const, id: a.id, driverId: d.id, date: a.date, amount: Number(a.amount ?? 0),
      what: a.kind === 'grace' ? `Adjust: may drive until ${a.until} · ${a.reason}` : `Adjust: ${Number(a.amount) > 0 ? 'credit' : 'charge'} · ${a.reason}`, by: a.by,
    }))),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

// The driver as they would be with the start date and start deposit confirmed.
export function withConfirmedStart(d: Driver, start: string, depositAmount: number, depositDate: string | null): Driver {
  const paid = depositAmount > 0;
  return { ...d, start_date: start || d.start_date, initial_deposit_paid: paid, initial_deposit_amount: paid ? depositAmount : null, initial_deposit_date: paid ? depositDate || start : null };
}

// The credit (+) or charge (-) that makes the payments cover exactly up to
// `paidUntil` (0 when they already do). Not money received.
export function correctionFor(d: Driver, deposits: DriverDeposit[], paidUntil: string, today: string = kigaliToday()): number {
  if (!d.start_date || !paidUntil) return 0;
  const s = computeDepositStanding(d, deposits, today);
  if (s.paidThrough === paidUntil) return 0;
  const paidToDate = contractPayments(d, deposits).reduce((t, p) => (p.date <= today ? t + p.amount : t), 0);
  const target = paidUntil < d.start_date ? 0 : workingCost(d, d.start_date, paidUntil);
  return target - paidToDate;
}

// A day-dated adjustment as Adjust records it, to preview the numbers after.
export function withCorrection(d: Driver, amount: number, today: string = kigaliToday()): Driver {
  if (!amount) return d;
  return { ...d, balance_adjustments: [...(d.balance_adjustments ?? []), { id: 'preview', kind: 'amount', date: today, amount, reason: '', by: null, by_name: null, at: new Date().toISOString(), status: 'confirmed' }] };
}

export const snapOf = (s: DepositStanding) => ({ owes: s.owes, behind: s.weekBehind, next_due: s.nextDueDate, paid_through: s.paidThrough });

// Everything one row of the page needs.
export interface AdjustRow {
  driver: Driver;
  standing: DepositStanding;
  deposits: DriverDeposit[];
  fines: DriverFine[];
  review: DriverMoneyReview | null;
  pending: PendingItem[];
  owedBesides: number;     // fines, damage, advances... still unpaid
  salaryOwed: number;      // salary Finance has not paid yet
  lastPayment: string | null;
  futurePayments: DriverDeposit[];
}

export function buildAdjustRows(
  drivers: Driver[], deposits: DriverDeposit[], fines: DriverFine[], finePayments: DriverFinePayment[],
  reviews: DriverMoneyReview[], payroll: PayrollRow[], today: string = kigaliToday(),
): AdjustRow[] {
  const pending = pendingItems(drivers, deposits, fines, finePayments);
  return drivers
    .filter((d) => d.contract_status !== 'ended')
    .map((driver) => {
      const deps = deposits.filter((x) => x.driver_id === driver.id && (!driver.payments_from || x.paid_date >= driver.payments_from));
      const own = fines.filter((f) => f.driver_id === driver.id);
      const dates = [...deps.filter((x) => x.paid_date <= today).map((x) => x.paid_date), ...(driver.initial_deposit_paid && driver.initial_deposit_date ? [driver.initial_deposit_date] : [])].sort();
      return {
        driver,
        standing: computeDepositStanding(driver, deps, today),
        deposits: deps,
        fines: own,
        review: reviews.find((r) => r.driver_id === driver.id) ?? null,
        pending: pending.filter((p) => p.driverId === driver.id),
        owedBesides: own.reduce((t, f) => t + Math.max(Number(f.amount) - fineAmountPaid(f.id, finePayments), 0), 0),
        salaryOwed: payroll.filter((p) => p.linked_driver_id === driver.id).reduce((t, p) => t + p.amount, 0),
        lastPayment: dates[dates.length - 1] ?? null,
        futurePayments: deps.filter((x) => x.paid_date > today),
      };
    })
    .sort((a, b) => Number(!!a.review) - Number(!!b.review) || b.pending.length - a.pending.length || a.driver.full_name.localeCompare(b.driver.full_name));
}

export async function confirmPending(p: PendingItem) {
  return supabase.rpc('md_confirm_driver_money', { p_kind: p.kind, p_id: p.id, p_driver: p.driverId });
}
export async function rejectPending(p: PendingItem, reason: string | null) {
  return supabase.rpc('md_reject_driver_money', { p_kind: p.kind, p_id: p.id, p_driver: p.driverId, p_reason: reason });
}
