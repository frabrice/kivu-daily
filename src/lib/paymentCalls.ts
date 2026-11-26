import { useCallback, useEffect, useState } from 'react';
import { supabase, DriverDeposit } from './supabase';
import { kigaliDay } from './kigali';

// Calls to drivers about money, their promises, and cars taken back
// (MD, 26 Nov 2026 - table driver_payment_calls). One row per call; taking
// the car back and giving it back are rows too.

export type CallOutcome = 'promised' | 'paid' | 'no_answer' | 'refused' | 'wrong_number' | 'car_taken' | 'car_returned';

export interface PaymentCall {
  id: string;
  driver_id: string;
  outcome: CallOutcome;
  owed_at_call: number | null;
  promised_amount: number | null;
  promised_at: string | null;
  car_location: string | null;
  note: string | null;
  happened_at: string;
  created_by: string | null;
  created_at: string;
  author?: { full_name: string } | null;
}

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  promised: 'Promised to pay',
  paid: 'Paid on the call',
  no_answer: 'No answer',
  refused: 'Refused / problem',
  wrong_number: 'Wrong number',
  car_taken: 'Car taken back',
  car_returned: 'Car given back',
};
export const CALL_OUTCOMES: CallOutcome[] = ['promised', 'paid', 'no_answer', 'refused', 'wrong_number'];

let seq = 0;
export function usePaymentCalls() {
  const [calls, setCalls] = useState<PaymentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from('driver_payment_calls').select('*, author:profiles!driver_payment_calls_created_by_fkey(full_name)')
      .order('happened_at', { ascending: false }).limit(2000);
    setCalls((data as PaymentCall[] | null) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`payment-calls-${++seq}`).on('postgres_changes', { event: '*', schema: 'public', table: 'driver_payment_calls' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { calls, loading, reload: load };
}

export const callsOf = (calls: PaymentCall[], driverId: string) => calls.filter((c) => c.driver_id === driverId);

// The car is with us when the latest car row is "taken".
export function carTaken(calls: PaymentCall[], driverId: string): PaymentCall | null {
  const last = calls.filter((c) => c.driver_id === driverId && (c.outcome === 'car_taken' || c.outcome === 'car_returned'))
    .sort((a, b) => b.happened_at.localeCompare(a.happened_at))[0];
  return last?.outcome === 'car_taken' ? last : null;
}

// The latest conversation (car rows aside).
export function latestCall(calls: PaymentCall[], driverId: string): PaymentCall | null {
  return calls.filter((c) => c.driver_id === driverId && c.outcome !== 'car_taken' && c.outcome !== 'car_returned')
    .sort((a, b) => b.happened_at.localeCompare(a.happened_at))[0] ?? null;
}

export type PromiseState = 'pending' | 'kept' | 'broken';
// Kept once deposits logged after the call reach the promised amount;
// broken when the time passes first; pending until then.
export function promiseState(c: PaymentCall, deposits: DriverDeposit[], now: Date = new Date()): PromiseState | null {
  if (c.outcome !== 'promised' || !c.promised_at) return null;
  const paid = deposits.filter((d) => d.driver_id === c.driver_id && d.created_at >= c.created_at).reduce((s, d) => s + Number(d.amount), 0);
  if (paid >= (c.promised_amount ?? 1)) return 'kept';
  return new Date(c.promised_at) <= now ? 'broken' : 'pending';
}

const rwf = (n: number) => `${Math.round(n).toLocaleString()} RWF`;
const kigali = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Kigali', ...opts });
export const callTime = (iso: string) => kigali(iso, { hour: '2-digit', minute: '2-digit' });
export const callDay = (iso: string) => kigali(iso, { day: 'numeric', month: 'short' });
export const kigaliDayOf = (iso: string) => kigaliDay(iso);

// "Promised 95,000 by 17:00 today · Janviere, 10:12" - one line, the same everywhere.
export function callLine(c: PaymentCall, deposits: DriverDeposit[], today: string): { text: string; tone: 'danger' | 'attention' | 'good' | 'muted' } {
  const who = c.author?.full_name?.trim().split(' ')[0] ?? 'someone';
  const when = kigaliDayOf(c.happened_at) === today ? callTime(c.happened_at) : `${callDay(c.happened_at)} ${callTime(c.happened_at)}`;
  const by = ` · ${who}, ${when}`;
  if (c.outcome === 'car_taken') return { text: `Car taken back ${callDay(c.happened_at)} ${callTime(c.happened_at)}${c.car_location ? ` · ${c.car_location}` : ''} · ${who}`, tone: 'danger' };
  if (c.outcome === 'promised' && c.promised_at) {
    const st = promiseState(c, deposits);
    const due = kigaliDayOf(c.promised_at) === today ? `${callTime(c.promised_at)} today` : `${callDay(c.promised_at)} ${callTime(c.promised_at)}`;
    const amount = c.promised_amount ? rwf(c.promised_amount) : 'to pay';
    if (st === 'kept') return { text: `Kept promise: ${amount}${by}`, tone: 'good' };
    if (st === 'broken') return { text: `Broke promise: ${amount} by ${due}${by}`, tone: 'danger' };
    return { text: `Promised ${amount} by ${due}${by}`, tone: 'attention' };
  }
  return { text: `${OUTCOME_LABEL[c.outcome]}${c.note ? `: ${c.note}` : ''}${by}`, tone: c.outcome === 'paid' ? 'good' : c.outcome === 'refused' ? 'danger' : 'muted' };
}

export const toneClass = (t: 'danger' | 'attention' | 'good' | 'muted') =>
  t === 'danger' ? 'text-red-600 dark:text-red-400' : t === 'attention' ? 'text-amber-700 dark:text-amber-300' : t === 'good' ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg-muted';

// The last real payment: date and amount (initial deposit included).
export function lastPayment(driver: { initial_deposit_paid: boolean; initial_deposit_amount: number | null; initial_deposit_date: string | null }, deposits: DriverDeposit[]):
  { date: string; amount: number; pending: boolean } | null {
  const last = [...deposits].sort((a, b) => b.paid_date.localeCompare(a.paid_date) || b.created_at.localeCompare(a.created_at))[0];
  if (last) return { date: last.paid_date, amount: Number(last.amount), pending: last.status === 'pending' };
  if (driver.initial_deposit_paid && driver.initial_deposit_date) return { date: driver.initial_deposit_date, amount: Number(driver.initial_deposit_amount ?? 0), pending: false };
  return null;
}

// Who may take a car back / give it back (the database checks it too).
export function canTakeCar(profile: { role?: string; department?: { slug?: string | null } | null } | null | undefined, isFollowup: boolean): boolean {
  return !!profile && (profile.role === 'managing_director' || ['fleet', 'it', 'finance'].includes(profile.department?.slug ?? '') || isFollowup);
}
