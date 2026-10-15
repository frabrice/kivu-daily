import { useCallback, useEffect, useState } from 'react';
import { supabase, Driver, DriverDeposit, Vehicle, FinanceTransaction, CallTicket, PauseReason } from './supabase';
import { computeDepositStanding, pauseOn, paidThroughDate, isoWeekday, DepositStanding, contractPayments, dailyRateOn } from '../../supabase/functions/_shared/depositRules';
import { CallCenterShift } from './shifts';
import { OutreachCall } from './outreach';
import { KIVU_REVENUE_TYPES } from './finance';

// MD Performance hub: one load of everything, and the history rebuilt from
// it - day by day - so trends work from the first day of data, not only
// from the day this page was built.

export interface PerfProfile { id: string; full_name: string; role: string; is_active: boolean; terminated_at: string | null; department: { slug: string; name: string } | null }
export interface PerfTask {
  id: string; user_id: string; title: string; date: string; completed: boolean; completed_at: string | null; due_time: string | null;
  is_carried_over: boolean; smart_key: string | null; smart_total: number | null; smart_done: number | null; auto_completed: boolean | null; priority: string | null;
  assigned_by: string | null; review_status: string | null;
}
export interface PerfFine { id: string; driver_id: string; vehicle_id: string | null; amount: number; fine_date: string; payments: { amount: number; paid_date: string }[] }
export interface PerfEvent { driver_id: string; event_type: string; event_date: string }

export interface PerfData {
  profiles: PerfProfile[];
  tasks: PerfTask[];
  drivers: Driver[];
  vehicles: Vehicle[];
  deposits: DriverDeposit[];
  fines: PerfFine[];
  events: PerfEvent[];
  transactions: FinanceTransaction[];
  tickets: CallTicket[];
  shifts: CallCenterShift[];
  outreach: OutreachCall[];
  waiting: { pauses: number; finance: number; financeAmount: number; emergencies: number; deposits: number; reviews: number };
}

// Every row, past the 1,000-row cap of a single request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all<T>(make: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export function usePerformanceData() {
  const [data, setData] = useState<PerfData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [profiles, tasks, drivers, vehicles, deposits, fines, events, transactions, tickets, shifts, outreach, pendingPauses, pendingTx, emergencies, pendingDeposits] = await Promise.all([
        all<PerfProfile>(() => supabase.from('profiles').select('id, full_name, role, is_active, terminated_at, department:departments(slug, name)').order('full_name')),
        all<PerfTask>(() => supabase.from('tasks').select('id, user_id, title, date, completed, completed_at, due_time, is_carried_over, smart_key, smart_total, smart_done, auto_completed, priority, assigned_by, review_status').order('date')),
        all<Driver>(() => supabase.from('drivers').select('*, vehicle:vehicles(*), pauses:driver_pauses(*)').order('full_name')),
        all<Vehicle>(() => supabase.from('vehicles').select('*').order('plate_number')),
        all<DriverDeposit>(() => supabase.from('driver_deposits').select('*').order('paid_date')),
        all<PerfFine>(() => supabase.from('driver_fines').select('id, driver_id, vehicle_id, amount, fine_date, payments:driver_fine_payments(amount, paid_date)')),
        all<PerfEvent>(() => supabase.from('driver_contract_events').select('driver_id, event_type, event_date')),
        all<FinanceTransaction>(() => supabase.from('finance_transactions').select('*').order('transaction_date')),
        all<CallTicket>(() => supabase.from('call_tickets').select('id, reference, category, priority, status, created_at, assigned_at, first_response_at, closed_at, resolved_at, assignee_id, created_by, resolved_on_call, satisfaction, outcome_kind, md_acknowledged_at')),
        all<CallCenterShift>(() => supabase.from('call_center_shifts').select('*').order('started_at')),
        all<OutreachCall>(() => supabase.from('platform_outreach_calls').select('*').order('created_at')),
        supabase.from('driver_pauses').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending'),
        supabase.from('finance_transactions').select('amount').in('status', ['pending', 'checked']),
        supabase.from('call_tickets').select('id', { count: 'exact', head: true }).eq('priority', 'emergency').is('md_acknowledged_at', null),
        supabase.from('driver_deposits').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);
      const pendingTxRows = (pendingTx.data as { amount: number }[]) ?? [];
      setData({
        profiles, tasks, drivers, vehicles, deposits, fines, events, transactions, tickets, shifts, outreach,
        waiting: {
          pauses: pendingPauses.count ?? 0,
          finance: pendingTxRows.length,
          financeAmount: pendingTxRows.reduce((s, t) => s + Number(t.amount), 0),
          emergencies: emergencies.count ?? 0,
          deposits: pendingDeposits.count ?? 0,
          reviews: tasks.filter((t) => t.completed && !t.review_status && t.assigned_by).length,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

// ------------------------------------------------------------ periods
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
export const kDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export interface Period { from: string; to: string; prevFrom: string; prevTo: string; days: number }
export function periodOf(days: number, end = today()): Period {
  const from = addDays(end, -(days - 1));
  return { from, to: end, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), days };
}
export const within = (d: string, from: string, to: string) => d >= from && d <= to;

// ------------------------------------------------------------ drivers & cars
// The last day a driver was on contract (null = still on it).
export function endDateOf(d: Driver, events: PerfEvent[]): string | null {
  if (d.contract_status !== 'ended') return null;
  const ended = events.filter((e) => e.driver_id === d.id && e.event_type === 'ended').map((e) => e.event_date).sort();
  return ended.length ? ended[ended.length - 1] : kDay(d.updated_at);
}
// Drivers who actually drive: on a car now, or on one until their contract
// ended. Recruits with a start date but no car don't count.
export const drives = (d: Driver) => !!d.start_date && (!!d.vehicle_id || d.contract_status === 'ended');
export const onContract = (d: Driver, end: string | null, day: string) => !!d.start_date && d.start_date <= day && (!end || day <= end);

export type DriverDayState = 'paid' | 'unpaid' | 'paused' | 'rest';
export interface DriverDay { driver: Driver; state: DriverDayState; reason?: PauseReason }

const REST_ISO: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

// What a driver's day was, judged with only the payments made by then:
// rest day, paused (sick, garage...), covered by payments, or worked unpaid.
export function driverDay(d: Driver, deps: DriverDeposit[], day: string): DriverDayState {
  if (d.rest_day && REST_ISO[d.rest_day] === isoWeekday(day)) return 'rest';
  if (pauseOn(d.pauses, day)) return 'paused';
  const paid = contractPayments(d, deps).filter((p) => p.date <= day).reduce((s, p) => s + p.amount, 0);
  const through = paidThroughDate(d.start_date!, d.rest_day, paid, d.pauses, (x) => dailyRateOn(d, x));
  return through && through >= day ? 'paid' : 'unpaid';
}

export interface DriverRow {
  driver: Driver; end: string | null; standing: DepositStanding;
  paid: number; unpaid: number; paused: number; rest: number; pausedBy: Partial<Record<PauseReason, number>>;
  collected: number; fines: number; finesUnpaid: number;
}

export function driverRows(data: PerfData, p: Period): DriverRow[] {
  const t = today();
  return data.drivers.filter(drives).map((d) => {
    const end = endDateOf(d, data.events);
    const deps = data.deposits.filter((x) => x.driver_id === d.id);
    const row: DriverRow = {
      driver: d, end, standing: computeDepositStanding(d, deps, t),
      paid: 0, unpaid: 0, paused: 0, rest: 0, pausedBy: {},
      collected: deps.filter((x) => within(x.paid_date, p.from, p.to)).reduce((s, x) => s + Number(x.amount), 0),
      fines: 0, finesUnpaid: 0,
    };
    for (let day = p.from; day <= p.to; day = addDays(day, 1)) {
      if (!onContract(d, end, day)) continue;
      const st = driverDay(d, deps, day);
      row[st] += 1;
      if (st === 'paused') {
        const r = (pauseOn(d.pauses, day)?.reason ?? 'other') as PauseReason;
        row.pausedBy[r] = (row.pausedBy[r] ?? 0) + 1;
      }
    }
    for (const f of data.fines.filter((x) => x.driver_id === d.id && within(x.fine_date, p.from, p.to))) {
      row.fines += Number(f.amount);
      row.finesUnpaid += Math.max(0, Number(f.amount) - f.payments.reduce((s, x) => s + Number(x.amount), 0));
    }
    return row;
  }).filter((r) => r.paid + r.unpaid + r.paused + r.rest > 0 || r.collected > 0);
}

export type CarDayState = 'working' | 'paused' | 'rest' | 'unpaid' | 'no_driver';
export const CAR_STATE_LABEL: Record<CarDayState, string> = { working: 'Working (paid up)', paused: 'Days off (paused)', rest: 'Rest day', unpaid: 'Driver not paid up', no_driver: 'No driver' };

// One car's day, from the drivers on it (current assignments) that day.
export function carDay(v: Vehicle, data: PerfData, day: string): CarDayState | null {
  if (v.operation_start_date && day < v.operation_start_date) return null;
  if (!v.operation_start_date && v.created_at && day < kDay(v.created_at)) return null;
  const ds = data.drivers.filter((d) => d.vehicle_id === v.id && onContract(d, endDateOf(d, data.events), day));
  if (!ds.length) return 'no_driver';
  const states = ds.map((d) => driverDay(d, data.deposits.filter((x) => x.driver_id === d.id), day));
  if (states.includes('paid')) return 'working';
  if (states.every((s) => s === 'rest')) return 'rest';
  if (states.every((s) => s === 'paused' || s === 'rest')) return 'paused';
  return 'unpaid';
}

export interface FleetDay { day: string; working: number; paused: number; rest: number; unpaid: number; no_driver: number }
export function fleetDays(data: PerfData, from: string, to: string): FleetDay[] {
  const out: FleetDay[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const row: FleetDay = { day, working: 0, paused: 0, rest: 0, unpaid: 0, no_driver: 0 };
    for (const v of data.vehicles) { const s = carDay(v, data, day); if (s) row[s] += 1; }
    out.push(row);
  }
  return out;
}

// Working days nobody paid for (per day, all drivers) - the "days lost".
export function lostDays(data: PerfData, from: string, to: string): { day: string; lost: number; paused: number }[] {
  const out: { day: string; lost: number; paused: number }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    let lost = 0, paused = 0;
    for (const d of data.drivers) {
      if (!drives(d) || !onContract(d, endDateOf(d, data.events), day)) continue;
      const st = driverDay(d, data.deposits.filter((x) => x.driver_id === d.id), day);
      if (st === 'unpaid') lost += 1;
      if (st === 'paused') paused += 1;
    }
    out.push({ day, lost, paused });
  }
  return out;
}

// ------------------------------------------------------------ team tasks
export interface PersonRow {
  id: string; name: string; dept: string; given: number; done: number; onTime: number; late: number; missed: number; carried: number;
  smartItems: number; smartDone: number; auto: number; urgent: number; urgentDone: number;
}
const doneOnTime = (t: PerfTask) => {
  if (!t.completed || !t.completed_at) return false;
  const doneDay = kDay(t.completed_at);
  if (doneDay < t.date) return true;
  if (doneDay > t.date) return false;
  if (!t.due_time) return true;
  const hm = new Date(t.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Kigali' });
  return hm <= t.due_time.slice(0, 5);
};
export function personRows(data: PerfData, p: Period): PersonRow[] {
  const t = today();
  const staff = data.profiles.filter((x) => x.role === 'employee' && x.is_active);
  return staff.map((s) => {
    const list = data.tasks.filter((x) => x.user_id === s.id && within(x.date, p.from, p.to));
    const smart = list.filter((x) => x.smart_key);
    const urgent = list.filter((x) => x.priority === 'high' || x.priority === 'urgent');
    return {
      id: s.id, name: s.full_name.trim(), dept: s.department?.name ?? '—',
      given: list.length, done: list.filter((x) => x.completed).length, onTime: list.filter(doneOnTime).length,
      late: list.filter((x) => x.completed && !doneOnTime(x)).length,
      missed: list.filter((x) => !x.completed && x.date < t).length,
      carried: list.filter((x) => x.is_carried_over).length,
      smartItems: smart.reduce((a, x) => a + (x.smart_total ?? 0), 0), smartDone: smart.reduce((a, x) => a + (x.smart_done ?? 0), 0),
      auto: smart.filter((x) => x.auto_completed).length,
      urgent: urgent.length, urgentDone: urgent.filter((x) => x.completed).length,
    };
  }).filter((r) => r.given > 0).sort((a, b) => (b.done / b.given) - (a.done / a.given) || b.given - a.given);
}
export function teamDaily(data: PerfData, from: string, to: string): { day: string; rate: number | null; given: number; done: number }[] {
  const staff = new Set(data.profiles.filter((x) => x.role === 'employee' && x.is_active).map((x) => x.id));
  const out: { day: string; rate: number | null; given: number; done: number }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const list = data.tasks.filter((x) => x.date === day && staff.has(x.user_id));
    const done = list.filter((x) => x.completed).length;
    out.push({ day, given: list.length, done, rate: list.length ? Math.round((done / list.length) * 100) : null });
  }
  return out;
}

// ------------------------------------------------------------ money
const counted = (t: FinanceTransaction) => t.status === 'posted' || t.status === 'approved';
// Real cash moving in and out of Kivu's accounts. Transfers move money
// between our own banks and the management margin is a book entry on top
// of fleet collections, so neither is counted as cash.
export const CASH_IN_TYPES = ['fleet_collection', 'onboarding_fee', 'revenue'];
export function moneyIn(list: FinanceTransaction[], from: string, to: string) {
  return list.filter((t) => counted(t) && t.direction === 'in' && CASH_IN_TYPES.includes(t.type) && within(t.transaction_date, from, to)).reduce((s, t) => s + Number(t.amount), 0);
}
export function moneyOut(list: FinanceTransaction[], from: string, to: string) {
  return list.filter((t) => counted(t) && t.direction === 'out' && t.type !== 'transfer' && within(t.transaction_date, from, to)).reduce((s, t) => s + Number(t.amount), 0);
}
export function kivuRevenue(list: FinanceTransaction[], from: string, to: string) {
  return list.filter((t) => counted(t) && t.direction === 'in' && KIVU_REVENUE_TYPES.includes(t.type) && within(t.transaction_date, from, to)).reduce((s, t) => s + Number(t.amount), 0);
}
export function collected(data: PerfData, from: string, to: string) {
  return data.deposits.filter((x) => within(x.paid_date, from, to)).reduce((s, x) => s + Number(x.amount), 0);
}

// Weeks (Mon-Sun) covering the period, for weekly money charts.
export function weeksOf(from: string, to: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let m = addDays(from, -(isoWeekday(from) - 1));
  while (m <= to) { out.push({ start: m, end: addDays(m, 6) }); m = addDays(m, 7); }
  return out;
}
