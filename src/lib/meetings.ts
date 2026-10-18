import { useCallback, useEffect, useState } from 'react';
import { supabase, Driver, DriverDeposit, DriverFine, DriverFinePayment, DriverContractEvent, Vehicle } from './supabase';
import { computeDepositStanding, isoWeekday, shiftDay } from './fleet';
import type { Tone } from '../ui/kit';

// Meetings (migration 20261026100000): regular meetings preset from a
// series, run with attendance, one note-taker, numbers, decisions and
// actions; onboarding one-to-ones booked from open slots.

export type MeetingKind = 'fleet_daily' | 'it' | 'one_on_one' | 'onboarding' | 'other';
export type AttendanceStatus = 'expected' | 'present' | 'late' | 'absent' | 'excused';
export interface Series {
  id: string; key: string | null; name: string; kind: MeetingKind; purpose: string | null; days: number[]; start_time: string; duration_min: number; expected: string[];
  host_id: string | null; note_taker_id: string | null; with_profile: string | null; agenda: string[]; metrics: 'fleet' | 'it' | 'call_center' | null; email_recap: boolean; active: boolean;
}
export interface Occurrence {
  id: string; series_id: string | null; kind: MeetingKind; title: string; day: string; scheduled_start: string | null; duration_min: number; started_at: string | null; ended_at: string | null;
  status: 'scheduled' | 'running' | 'done' | 'cancelled'; host_id: string | null; note_taker_id: string | null; with_profile: string | null; expected: string[]; agenda: string[];
  metrics_kind: string | null; notes: string | null; metrics: Metric[] | Record<string, never>; recap_sent_at: string | null;
}
export interface Attendance { occurrence_id: string; profile_id: string; status: AttendanceStatus; reason: string | null; guest: boolean; marked_at: string | null }
export interface Item { id: string; occurrence_id: string; kind: 'decision' | 'action' | 'check'; text: string; owner_id: string | null; due_date: string | null; done: boolean; task_id: string | null; sort: number }
export interface Slot { id: string; starts_at: string; duration_min: number; purpose: string; title: string; host_id: string | null; booked_by: string | null; booked_at: string | null; occurrence_id: string | null }
export interface Metric { key: string; label: string; value: number | string | null; unit?: string | null; auto?: boolean; note?: string | null; group?: string }

export const ATTENDANCE: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  expected: { label: 'Not marked', tone: 'neutral' }, present: { label: 'Present', tone: 'success' }, late: { label: 'Late', tone: 'attention' },
  absent: { label: 'Absent', tone: 'danger' }, excused: { label: 'Excused', tone: 'info' },
};
export const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const kigaliToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—');
export const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' }) : '—');
export const minutesLate = (o: Occurrence) => (o.scheduled_start && o.started_at ? Math.round((Date.parse(o.started_at) - Date.parse(`${o.day}T${o.scheduled_start}+02:00`)) / 60000) : null);
export const metricsList = (o: Occurrence): Metric[] => (Array.isArray(o.metrics) ? o.metrics : []);

// ------------------------------------------------------------ numbers for each kind of meeting
export interface FleetInput { drivers: Driver[]; vehicles: Vehicle[]; deposits: DriverDeposit[]; fines: DriverFine[]; finePayments: DriverFinePayment[]; contractEvents: DriverContractEvent[] }
export function fleetMetrics(day: string, f: FleetInput): Metric[] {
  const active = f.drivers.filter((d) => d.contract_status === 'active' && d.start_date && d.start_date <= day);
  const byDriver = new Map<string, DriverDeposit[]>();
  for (const d of f.deposits) byDriver.set(d.driver_id, [...(byDriver.get(d.driver_id) ?? []), d]);
  const standings = active.map((d) => ({ d, s: computeDepositStanding(d, byDriver.get(d.id) ?? [], day) }));
  const sunday = isoWeekday(day) === 7;
  const notCleared = standings.filter((x) => x.s.ruleInForce && !x.s.isCleared);
  const dueToday = sunday ? standings.filter((x) => x.s.nextDueAmount > 0) : [];
  const paidToday = f.deposits.filter((d) => d.paid_date === day);
  const left = f.contractEvents.filter((e) => e.event_type === 'ended' && e.event_date === day);
  const started = f.drivers.filter((d) => d.start_date === day);
  const replacements = started.filter((d) => d.replaced_driver_id);
  const pausedOn = (reason: string) => active.filter((d) => (d.pauses ?? []).some((p) => p.reason === reason && p.approval_status !== 'rejected' && p.start_date <= day && (!p.end_date || day <= p.end_date)));
  const garage = new Set(pausedOn('garage').map((d) => d.vehicle_id).filter(Boolean));
  const accidentsToday = active.filter((d) => (d.pauses ?? []).some((p) => p.reason === 'accident' && p.start_date === day)).length;
  const finesToday = f.fines.filter((x) => x.fine_date === day);
  const paidOf = (id: string) => f.finePayments.filter((p) => p.fine_id === id).reduce((s, p) => s + Number(p.amount), 0);
  const openFines = f.fines.map((x) => ({ x, left: Number(x.amount) - paidOf(x.id) })).filter((x) => x.left > 0);
  // Seats: every managed car has a day and a night seat; a driver on both shifts fills both.
  const cars = f.vehicles.filter((v) => v.operation_start_date && v.operation_start_date <= day);
  const tomorrow = shiftDay(day, 1);
  const seats = cars.reduce((n, v) => {
    const ds = f.drivers.filter((d) => d.vehicle_id === v.id && d.contract_status === 'active' && d.start_date && d.start_date <= tomorrow);
    const filled = ds.some((d) => d.shift === 'full') ? 2 : Math.min(2, ds.length);
    return n + (2 - filled);
  }, 0);
  const collected = paidToday.reduce((s, d) => s + Number(d.amount), 0);
  return [
    { key: 'active_drivers', label: 'Drivers on contract', value: active.length, auto: true, group: 'Money' },
    ...(sunday ? [{ key: 'due_today', label: 'Due today (Sunday, last day)', value: dueToday.length, unit: 'drivers', auto: true, group: 'Money' }] : []),
    { key: 'paid_today', label: 'Payments received today', value: paidToday.length, auto: true, group: 'Money' },
    { key: 'collected_today', label: 'Money collected today', value: collected, unit: 'RWF', auto: true, group: 'Money' },
    { key: 'not_cleared', label: 'Not cleared — car must be taken back', value: notCleared.length, unit: 'drivers', auto: true, note: notCleared.slice(0, 8).map((x) => x.d.full_name.trim().split(' ')[0]).join(', ') || null, group: 'Money' },
    { key: 'cars_taken_back', label: 'Cars actually taken back today', value: null, group: 'Money' },
    { key: 'left_today', label: 'Drivers who left today', value: left.length, auto: true, group: 'Drivers' },
    { key: 'started_today', label: 'New drivers started today', value: started.length, auto: true, group: 'Drivers' },
    { key: 'replaced_same_day', label: 'Replacements found the same day', value: replacements.length, auto: true, group: 'Drivers' },
    { key: 'empty_seats', label: 'Empty seats for tomorrow', value: seats, auto: true, group: 'Drivers' },
    { key: 'in_garage', label: 'Cars in maintenance', value: garage.size, auto: true, group: 'Cars' },
    { key: 'accidents', label: 'Accidents today', value: accidentsToday, auto: true, group: 'Cars' },
    { key: 'fines_today', label: 'New fines today', value: finesToday.length, auto: true, note: finesToday.length ? `${finesToday.reduce((s, x) => s + Number(x.amount), 0).toLocaleString('en-US')} RWF` : null, group: 'Fines' },
    { key: 'fines_open', label: 'Fines still unpaid', value: openFines.length, auto: true, note: openFines.length ? `${openFines.reduce((s, x) => s + x.left, 0).toLocaleString('en-US')} RWF` : null, group: 'Fines' },
  ];
}
export const MANUAL_METRICS: Record<string, Metric[]> = {
  it: [
    { key: 'done', label: 'Issues done since last meeting', value: null, group: 'Delivery' },
    { key: 'blocked', label: 'Blocked', value: null, group: 'Delivery' },
    { key: 'nothing_in_progress', label: 'People with nothing in progress', value: null, group: 'Team' },
    { key: 'next_release', label: 'Next release', value: null, group: 'Delivery' },
  ],
  call_center: [
    { key: 'calls', label: 'Calls handled this week', value: null, group: 'Week' },
    { key: 'cases', label: 'Cases opened / closed', value: null, group: 'Week' },
    { key: 'commission_followups', label: 'Commission follow-ups done', value: null, group: 'Week' },
    { key: 'commission_collected', label: 'Commission collected after a call', value: null, unit: 'RWF', group: 'Week' },
  ],
};

// ------------------------------------------------------------ loading
let seq = 0;
export function useMeetings(days: string[]) {
  const [series, setSeries] = useState<Series[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; dept: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const key = days.join(',');
  const load = useCallback(async () => {
    await Promise.all(key.split(',').filter(Boolean).map((d) => supabase.rpc('ensure_meeting_occurrences', { p_day: d })));
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const [s, o, sl, p] = await Promise.all([
      supabase.from('meeting_series').select('*').order('start_time'),
      supabase.from('meeting_occurrences').select('*').gte('day', since).order('day', { ascending: false }).order('scheduled_start'),
      supabase.from('meeting_slots').select('*').gte('starts_at', new Date(Date.now() - 14 * 86400000).toISOString()).order('starts_at'),
      supabase.from('profiles').select('id, full_name, is_active, department:departments(slug)'),
    ]);
    const occ = (o.data as Occurrence[]) ?? [];
    const att = occ.length ? await supabase.from('meeting_attendance').select('*').in('occurrence_id', occ.map((x) => x.id)) : { data: [] };
    setSeries((s.data as Series[]) ?? []);
    setOccurrences(occ);
    setAttendance((att.data as Attendance[]) ?? []);
    setSlots((sl.data as Slot[]) ?? []);
    setPeople((((p.data ?? []) as unknown) as { id: string; full_name: string; is_active: boolean; department: { slug: string } | null }[]).filter((x) => x.is_active).map((x) => ({ id: x.id, name: x.full_name.trim(), dept: x.department?.slug ?? null })).sort((a, b) => a.name.localeCompare(b.name)));
    setLoading(false);
  }, [key]);
  useEffect(() => {
    load();
    const ch = supabase.channel(`meetings-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_occurrences' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_slots' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  const nameOf = useCallback((id: string | null | undefined) => (id ? people.find((x) => x.id === id)?.name ?? 'Someone' : '—'), [people]);
  return { series, occurrences, attendance, slots, people, loading, reload: load, nameOf };
}
export type MeetingsData = ReturnType<typeof useMeetings>;

export function useMeetingRoom(id: string | null) {
  const [occ, setOcc] = useState<Occurrence | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!id) return;
    const [o, a, i] = await Promise.all([
      supabase.from('meeting_occurrences').select('*').eq('id', id).maybeSingle(),
      supabase.from('meeting_attendance').select('*').eq('occurrence_id', id),
      supabase.from('meeting_items').select('*').eq('occurrence_id', id).order('sort').order('created_at'),
    ]);
    setOcc((o.data as Occurrence | null) ?? null); setAttendance((a.data as Attendance[]) ?? []); setItems((i.data as Item[]) ?? []); setLoading(false);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    setLoading(true); load();
    const ch = supabase.channel(`meeting-room-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_occurrences', filter: `id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_attendance', filter: `occurrence_id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_items', filter: `occurrence_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);
  return { occ, attendance, items, loading, reload: load };
}
