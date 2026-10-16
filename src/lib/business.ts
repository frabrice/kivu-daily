import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { PlatformTrip, kigaliDayOf, shortAddress } from './trips';

// Business clients (companies whose people ride with Kivu Ride and are
// billed weekly): their tagged trips, invoices and payments.
// See migration 20261016130000_business_clients_invoicing.sql.

export interface BusinessClient {
  id: string; name: string; legal_name: string | null; tin: string | null; contact_name: string | null; contact_phone: string | null;
  billing_emails: string[]; address: string | null; billing_cycle: 'weekly' | 'monthly'; payment_terms_days: number;
  agreement: string | null; notes: string | null; status: 'active' | 'paused' | 'ended'; created_at: string;
}
export interface ClientRider { id: string; client_id: string; name: string | null; phone: string; phone_key: string }
export interface ClientTrip {
  trip_id: number; client_id: string; invoice_id: string | null; note: string | null; added_by: string | null; added_at: string;
  status: 'pending' | 'verified'; verified_by: string | null; verified_at: string | null; trip: PlatformTrip | null;
}
export interface TripLogEntry { id: number; trip_id: number; client_id: string | null; action: 'added' | 'verified' | 'rejected' | 'removed' | 'invoiced' | 'released'; actor: string | null; note: string | null; at: string }
export const LOG_ACTION: Record<TripLogEntry['action'], string> = { added: 'added', verified: 'verified', rejected: 'rejected', removed: 'took off', invoiced: 'invoiced', released: 'released (invoice cancelled)' };
export interface BusinessInvoice {
  id: string; number: string; client_id: string; period_from: string; period_to: string; issue_date: string; due_date: string;
  trip_count: number; distance_km: number; subtotal: number; vat_rate: number; vat_amount: number; total: number; amount_paid: number;
  status: 'issued' | 'part_paid' | 'paid' | 'void'; notes: string | null; pdf_path: string | null; sent_at: string | null; sent_to: string[] | null;
  void_reason: string | null; voided_at: string | null; created_at: string; created_by: string | null;
}
export interface InvoicePayment { id: string; invoice_id: string; amount: number; paid_on: string; method: string; reference: string | null; notes: string | null; recorded_at: string }
export interface InvoiceSettings {
  legal_name: string; tin: string | null; address: string | null; phone: string | null; email: string | null; website: string | null;
  bank_name: string | null; bank_account_name: string | null; bank_account_number: string | null; momo_number: string | null; momo_name: string | null;
  vat_rate: number; payment_terms_days: number; footer_note: string | null;
}
export interface InvoiceLine {
  trip_id: number; date: string; completed_at: string | null; rider: string | null; rider_phone: string | null; from: string | null; to: string | null;
  driver: string | null; plate: string | null; vehicle_type: string | null; km: number | null; minutes: number | null;
  waiting_minutes: number | null; waiting_fee: number | null; extras: number | null; extra_items: { amount: number; reason: string }[]; fare: number;
}
export interface InvoiceSnapshot { lines: InvoiceLine[]; client: BusinessClient; issuer: InvoiceSettings }

export const INVOICE_STATUS: Record<BusinessInvoice['status'], { label: string; tone: 'accent' | 'attention' | 'success' | 'neutral' }> = {
  issued: { label: 'Unpaid', tone: 'accent' },
  part_paid: { label: 'Part paid', tone: 'attention' },
  paid: { label: 'Paid', tone: 'success' },
  void: { label: 'Cancelled', tone: 'neutral' },
};
export const PAYMENT_METHODS = [
  { key: 'bank', label: 'Bank transfer' }, { key: 'momo', label: 'Mobile Money' }, { key: 'cheque', label: 'Cheque' }, { key: 'cash', label: 'Cash' }, { key: 'other', label: 'Other' },
] as const;

const TRIP_COLS = 'id, status, created_at, requested_at, accepted_at, started_at, completed_at, cancelled_at, vehicle_type, pickup_address, destination_address, rider_kind, rider_name, rider_phone, driver_name, driver_phone, vehicle_plate, kivu_driver_id, kivu_vehicle_id, estimated_distance_km, actual_distance_km, estimated_duration_minutes, actual_duration_minutes, waiting_minutes, waiting_fee, extras_total, total_fare, payment_method, payment_status, dispatch_method';

// ------------------------------------------------------------ dates (Kigali, Monday-Sunday weeks)
export const todayK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
export const addDaysK = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const mondayOfK = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return addDaysK(d, -((w + 6) % 7)); };
export const dayLabel = (d: string, year = false) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
export const tripDay = (t: Pick<PlatformTrip, 'started_at' | 'created_at'>) => kigaliDayOf(t.started_at ?? t.created_at);
export const lastWeek = () => { const m = addDaysK(mondayOfK(todayK()), -7); return { from: m, to: addDaysK(m, 6) }; };
export const thisWeek = () => { const m = mondayOfK(todayK()); return { from: m, to: addDaysK(m, 6) }; };
export const thisMonth = () => { const t = todayK(); return { from: `${t.slice(0, 7)}-01`, to: t }; };
export const phoneKey = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-9);

export type TripBilling = 'pending' | 'live' | 'unbilled' | 'invoiced' | 'paid' | 'cancelled';
export function billingOf(ct: ClientTrip, invoices: BusinessInvoice[]): TripBilling {
  if (ct.trip?.status === 'cancelled') return 'cancelled';
  if (ct.invoice_id) return invoices.find((i) => i.id === ct.invoice_id)?.status === 'paid' ? 'paid' : 'invoiced';
  if (ct.status === 'pending') return 'pending';
  return ct.trip?.status === 'completed' ? 'unbilled' : 'live';
}
export const BILLING_LABEL: Record<TripBilling, { label: string; tone: 'neutral' | 'attention' | 'accent' | 'success' | 'danger' }> = {
  pending: { label: 'Waiting for verification', tone: 'attention' },
  live: { label: 'Trip in progress', tone: 'neutral' },
  unbilled: { label: 'Verified · not invoiced', tone: 'accent' },
  invoiced: { label: 'Invoiced', tone: 'neutral' },
  paid: { label: 'Paid', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};
export const outstandingOf = (i: BusinessInvoice) => (i.status === 'void' ? 0 : Math.max(0, Number(i.total) - Number(i.amount_paid)));
export const isOverdue = (i: BusinessInvoice) => outstandingOf(i) > 0 && i.due_date < todayK();

// ------------------------------------------------------------ loading
let seq = 0;
export function useBusinessData() {
  const [clients, setClients] = useState<BusinessClient[]>([]);
  const [riders, setRiders] = useState<ClientRider[]>([]);
  const [clientTrips, setClientTrips] = useState<ClientTrip[]>([]);
  const [invoices, setInvoices] = useState<BusinessInvoice[]>([]);
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [settings, setSettings] = useState<InvoiceSettings | null>(null);
  const [log, setLog] = useState<TripLogEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    const [c, r, ct, inv, pay, set, lg, ppl] = await Promise.all([
      supabase.from('business_clients').select('*').order('name'),
      supabase.from('business_client_riders').select('*').order('name'),
      fetchAll<ClientTrip>(() => supabase.from('business_client_trips').select(`*, trip:platform_trips(${TRIP_COLS})`).order('added_at', { ascending: false }).order('trip_id')),
      fetchAll<BusinessInvoice>(() => supabase.from('business_invoices').select('id, number, client_id, period_from, period_to, issue_date, due_date, trip_count, distance_km, subtotal, vat_rate, vat_amount, total, amount_paid, status, notes, pdf_path, sent_at, sent_to, void_reason, voided_at, created_at, created_by').order('issue_date', { ascending: false }).order('number', { ascending: false })),
      fetchAll<InvoicePayment>(() => supabase.from('business_invoice_payments').select('*').order('paid_on', { ascending: false }).order('id')),
      supabase.from('invoice_settings').select('*').maybeSingle(),
      fetchAll<TripLogEntry>(() => supabase.from('business_client_trip_log').select('*').order('at', { ascending: false }).order('id', { ascending: false })),
      supabase.from('profiles').select('id, full_name'),
    ]);
    setClients((c.data as BusinessClient[]) ?? []);
    setRiders((r.data as ClientRider[]) ?? []);
    setClientTrips(ct.data ?? []);
    setInvoices(inv.data ?? []);
    setPayments(pay.data ?? []);
    setSettings((set.data as InvoiceSettings | null) ?? null);
    setLog(lg.data ?? []);
    setNames(Object.fromEntries(((ppl.data as { id: string; full_name: string }[]) ?? []).map((p) => [p.id, p.full_name.trim()])));
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const soon = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(load, 600); };
    const ch = supabase.channel(`business-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_client_trips' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_trips' }, soon)
      .subscribe();
    return () => { supabase.removeChannel(ch); if (timer.current) clearTimeout(timer.current); };
  }, [load]);
  const nameOf = useCallback((id: string | null | undefined) => (id ? names[id] ?? 'Someone' : '—'), [names]);
  return { clients, riders, clientTrips, invoices, payments, settings, log, nameOf, loading, reload: load };
}

export async function loadInvoiceSnapshot(id: string): Promise<InvoiceSnapshot | null> {
  const { data } = await supabase.from('business_invoices').select('snapshot').eq('id', id).maybeSingle();
  return (data?.snapshot as InvoiceSnapshot | undefined) ?? null;
}

// ------------------------------------------------------------ analytics
export interface ClientStats {
  trips: number; amount: number; km: number; avgFare: number; waitingFees: number; extras: number; minutes: number;
  byDay: { day: string; trips: number; amount: number }[];
  byDriver: { name: string; trips: number; amount: number }[];
  routes: { route: string; trips: number; amount: number }[];
  riders: { name: string; trips: number; amount: number }[];
}
export function clientStats(list: ClientTrip[], from: string, to: string): ClientStats {
  const done = list.filter((x) => x.trip && x.trip.status === 'completed' && tripDay(x.trip) >= from && tripDay(x.trip) <= to).map((x) => x.trip!);
  const sum = (f: (t: PlatformTrip) => number | null | undefined) => done.reduce((s, t) => s + Number(f(t) ?? 0), 0);
  const group = (key: (t: PlatformTrip) => string) => {
    const m = new Map<string, { trips: number; amount: number }>();
    for (const t of done) { const k = key(t); const g = m.get(k) ?? { trips: 0, amount: 0 }; g.trips += 1; g.amount += Number(t.total_fare ?? 0); m.set(k, g); }
    return [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.trips - a.trips || b.amount - a.amount);
  };
  const days: { day: string; trips: number; amount: number }[] = [];
  const span = Math.min(62, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  for (let i = 0; i < span; i++) {
    const d = addDaysK(from, i);
    const of = done.filter((t) => tripDay(t) === d);
    days.push({ day: d, trips: of.length, amount: of.reduce((s, t) => s + Number(t.total_fare ?? 0), 0) });
  }
  const amount = sum((t) => t.total_fare);
  return {
    trips: done.length, amount, km: sum((t) => t.actual_distance_km ?? t.estimated_distance_km), avgFare: done.length ? amount / done.length : 0,
    waitingFees: sum((t) => t.waiting_fee), extras: sum((t) => t.extras_total), minutes: sum((t) => t.actual_duration_minutes ?? t.estimated_duration_minutes),
    byDay: days,
    byDriver: group((t) => t.driver_name ?? '—').map((g) => ({ name: g.k, trips: g.trips, amount: g.amount })),
    routes: group((t) => `${shortAddress(t.pickup_address)} → ${shortAddress(t.destination_address)}`).slice(0, 8).map((g) => ({ route: g.k, trips: g.trips, amount: g.amount })),
    riders: group((t) => t.rider_name ?? 'Unknown rider').map((g) => ({ name: g.k, trips: g.trips, amount: g.amount })),
  };
}

// Running statement: invoices (debit) and payments (credit), oldest first.
export interface StatementRow { date: string; kind: 'invoice' | 'payment' | 'void'; ref: string; detail: string; debit: number; credit: number; balance: number }
export function statementOf(invoices: BusinessInvoice[], payments: InvoicePayment[]): StatementRow[] {
  const rows: Omit<StatementRow, 'balance'>[] = [];
  for (const i of invoices) {
    rows.push({ date: i.issue_date, kind: 'invoice', ref: i.number, detail: `${i.trip_count} trips · ${dayLabel(i.period_from)} – ${dayLabel(i.period_to, true)}`, debit: Number(i.total), credit: 0 });
    if (i.status === 'void') rows.push({ date: (i.voided_at ?? i.created_at).slice(0, 10), kind: 'void', ref: i.number, detail: `Cancelled${i.void_reason ? `: ${i.void_reason}` : ''}`, debit: 0, credit: Number(i.total) });
  }
  for (const p of payments) {
    const inv = invoices.find((i) => i.id === p.invoice_id);
    if (!inv) continue;
    rows.push({ date: p.paid_on, kind: 'payment', ref: inv.number, detail: `Payment · ${PAYMENT_METHODS.find((m) => m.key === p.method)?.label ?? p.method}${p.reference ? ` · ${p.reference}` : ''}`, debit: 0, credit: Number(p.amount) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'invoice' ? -1 : 1));
  let bal = 0;
  return rows.map((r) => { bal += r.debit - r.credit; return { ...r, balance: bal }; });
}
