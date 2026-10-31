import { supabase, Driver, DriverDeposit, Vehicle } from './supabase';
import { computeDepositStanding, formatDateLabelSafe, shiftLabel, REST_DAYS } from './fleet';
import { addDays, carDay, driverDay, endDateOf, onContract, PerfData, PerfEvent, today, within } from './performance';
import { NAVY, MUTED, baseDoc, h1, h2, kpiRow, note, render, smallLogo, table } from './stationReportPdf';

// Fleet exports (Fleet pages and Under Management): the drivers' full
// state, payments, fines, cars and adjustments for a period, as an Excel
// workbook (one sheet per section) or an A4 PDF in the house style. Every
// number comes from the same rules as the pages (depositRules.ts,
// performance.ts); commission is 10% of completed trips (MD, 31 Oct 2026).

export type ReportKind = 'drivers' | 'payments' | 'fines' | 'cars' | 'adjustments';
export const REPORTS: { key: ReportKind; label: string; hint: string }[] = [
  { key: 'drivers', label: 'Full drivers report', hint: 'Every driver on contract: cleared or behind, how much they owe, what they paid, days worked and paid, fines, app trips and commission, plus the payments, fines and adjustments of the period.' },
  { key: 'payments', label: 'Payments', hint: 'Every payment in the period, by driver and car.' },
  { key: 'fines', label: 'Fines', hint: 'Every fine in the period: amount, paid, still unpaid.' },
  { key: 'cars', label: 'Cars report', hint: 'Car by car: days working, unpaid, off and without a driver, and what its drivers paid.' },
  { key: 'adjustments', label: 'Adjustments', hint: 'Every Adjust made to a driver\'s numbers: who, when, why, before and after.' },
];
export const COMMISSION_RATE = 0.1;

type Cell = string | number | null;
export interface Column { header: string; key: string; kind?: 'text' | 'money' | 'int' | 'date' | 'pct'; width?: number }
export interface Section { title: string; columns: Column[]; rows: Record<string, Cell>[]; note?: string; red?: (r: Record<string, Cell>) => boolean }
export interface Report { title: string; subtitle: string; from: string; to: string; kpis: { label: string; value: string; sub?: string }[]; sections: Section[]; notes: string[] }

interface Fine { id: string; driver_id: string; vehicle_id: string | null; amount: number; fine_date: string; reason: string | null; payments: { amount: number; paid_date: string }[] }
interface Trip { kivu_driver_id: string | null; status: string; total_fare: number | null; requested_at: string | null }
export interface ExportData {
  drivers: Driver[]; vehicles: Vehicle[]; deposits: DriverDeposit[]; fines: Fine[]; events: PerfEvent[]; trips: Trip[];
  owners: Map<string, string>; people: Map<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all<T>(make: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let lo = 0; ; lo += 1000) {
    const { data, error } = await make().range(lo, lo + 999);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export async function loadExportData(from: string, to: string): Promise<ExportData> {
  const [drivers, vehicles, deposits, fines, events, trips, owners, people] = await Promise.all([
    all<Driver>(() => supabase.from('drivers').select('*, vehicle:vehicles(*), pauses:driver_pauses(*)').order('full_name')),
    all<Vehicle>(() => supabase.from('vehicles').select('*').order('plate_number')),
    all<DriverDeposit>(() => supabase.from('driver_deposits').select('*').order('paid_date').order('id')),
    all<Fine>(() => supabase.from('driver_fines').select('id, driver_id, vehicle_id, amount, fine_date, reason, payments:driver_fine_payments(amount, paid_date)').order('fine_date').order('id')),
    all<PerfEvent>(() => supabase.from('driver_contract_events').select('driver_id, event_type, event_date')),
    all<Trip>(() => supabase.from('platform_trips').select('kivu_driver_id, status, total_fare, requested_at').not('kivu_driver_id', 'is', null)
      .gte('requested_at', `${from}T00:00:00+02:00`).lt('requested_at', `${addDays(to, 1)}T00:00:00+02:00`).order('id')),
    // Owner names are Finance's: the MD and Finance get them, Fleet does not.
    all<{ id: string; full_name: string }>(() => supabase.from('vehicle_owners').select('id, full_name').order('id')),
    all<{ id: string; full_name: string }>(() => supabase.from('profiles').select('id, full_name').order('id')),
  ]);
  return { drivers, vehicles, deposits, fines, events, trips, owners: new Map(owners.map((o) => [o.id, o.full_name])), people: new Map(people.map((x) => [x.id, x.full_name.trim()])) };
}

const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const restLabel = (k: string | null) => REST_DAYS.find((r) => r.key === k)?.label ?? '';
const initialDate = (x: Driver) => x.initial_deposit_date ?? x.start_date ?? '';
const finePaid = (f: Fine) => f.payments.reduce((s, p) => s + Number(p.amount), 0);
const perf = (d: ExportData) => ({ drivers: d.drivers, vehicles: d.vehicles, deposits: d.deposits, events: d.events, fines: [] } as unknown as PerfData);

// ------------------------------------------------------------------ the reports
export function buildReport(kind: ReportKind, d: ExportData, from: string, to: string): Report {
  const t = today();
  const plateOf = (id: string | null) => (id ? d.vehicles.find((v) => v.id === id)?.plate_number ?? '' : '');
  const nameOf = (id: string) => d.drivers.find((x) => x.id === id)?.full_name ?? '';
  const period = from === to ? formatDateLabelSafe(from) : `${formatDateLabelSafe(from)} – ${formatDateLabelSafe(to)}`;
  const base = { from, to, notes: [] as string[] };

  const payments: Section = {
    title: 'Payments', columns: [
      { header: 'Date', key: 'date', kind: 'date' }, { header: 'Driver', key: 'driver', width: 26 }, { header: 'Car', key: 'car' }, { header: 'Amount', key: 'amount', kind: 'money' },
      { header: 'How', key: 'method' }, { header: 'Status', key: 'status' }, { header: 'Logged by', key: 'by', width: 20 },
    ],
    rows: [
      ...d.deposits.filter((x) => within(x.paid_date, from, to)).map((x) => {
        const drv = d.drivers.find((y) => y.id === x.driver_id);
        return { date: x.paid_date, driver: drv?.full_name ?? '', car: plateOf(drv?.vehicle_id ?? null), amount: Number(x.amount), method: String(x.payment_method ?? '').replace(/_/g, ' '), status: x.status === 'pending' ? 'Waiting for Finance' : 'Confirmed', by: x.created_by ? d.people.get(x.created_by) ?? '' : '' };
      }),
      // The first payment is kept on the driver, not with the weekly payments.
      ...d.drivers.filter((x) => x.initial_deposit_paid && Number(x.initial_deposit_amount) > 0 && within(initialDate(x), from, to))
        .map((x) => ({ date: initialDate(x), driver: x.full_name, car: plateOf(x.vehicle_id), amount: Number(x.initial_deposit_amount), method: 'initial deposit', status: 'Confirmed', by: '' })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
  const fines: Section = {
    title: 'Fines', columns: [
      { header: 'Date', key: 'date', kind: 'date' }, { header: 'Driver', key: 'driver', width: 26 }, { header: 'Car', key: 'car' }, { header: 'Reason', key: 'reason', width: 34 },
      { header: 'Amount', key: 'amount', kind: 'money' }, { header: 'Paid', key: 'paid', kind: 'money' }, { header: 'Unpaid', key: 'unpaid', kind: 'money' },
    ],
    rows: d.fines.filter((f) => within(f.fine_date, from, to)).map((f) => ({ date: f.fine_date, driver: nameOf(f.driver_id), car: plateOf(f.vehicle_id), reason: f.reason ?? '', amount: Number(f.amount), paid: finePaid(f), unpaid: Math.max(0, Number(f.amount) - finePaid(f)) })),
    red: (r) => Number(r.unpaid) > 0,
  };
  const adjustments: Section = {
    title: 'Adjustments', columns: [
      { header: 'Date', key: 'date', kind: 'date' }, { header: 'Driver', key: 'driver', width: 24 }, { header: 'What', key: 'what', width: 26 }, { header: 'Reason', key: 'reason', width: 40 },
      { header: 'Before → after', key: 'change', width: 34 }, { header: 'By', key: 'by', width: 18 },
    ],
    rows: d.drivers.flatMap((x) => (x.balance_adjustments ?? []).filter((a) => within(a.date, from, to)).map((a) => ({
      date: a.date, driver: x.full_name,
      what: a.kind === 'amount' ? `${Number(a.amount) > 0 ? 'Credit' : 'Charge'} of ${money(Math.abs(Number(a.amount)))}` : `May drive until ${formatDateLabelSafe(a.until!)}`,
      reason: a.reason, change: a.before && a.after ? `owes ${money(a.before.owes ?? 0)} → ${money(a.after.owes ?? 0)}; behind ${money(a.before.behind ?? 0)} → ${money(a.after.behind ?? 0)}` : '',
      by: a.by_name ?? '',
    }))).sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };

  if (kind === 'payments') {
    const total = payments.rows.reduce((s, r) => s + Number(r.amount), 0);
    return { ...base, title: 'Driver payments', subtitle: period, sections: [payments],
      kpis: [{ label: 'Payments', value: String(payments.rows.length) }, { label: 'Total', value: money(total) }, { label: 'Waiting for Finance', value: String(payments.rows.filter((r) => r.status !== 'Confirmed').length) }] };
  }
  if (kind === 'fines') {
    const sum = (k: string) => fines.rows.reduce((s, r) => s + Number(r[k]), 0);
    return { ...base, title: 'Driver fines', subtitle: period, sections: [fines],
      kpis: [{ label: 'Fines', value: String(fines.rows.length) }, { label: 'Amount', value: money(sum('amount')) }, { label: 'Paid', value: money(sum('paid')) }, { label: 'Still unpaid', value: money(sum('unpaid')) }] };
  }
  if (kind === 'adjustments') {
    return { ...base, title: 'Adjustments to drivers\' numbers', subtitle: period, sections: [adjustments],
      kpis: [{ label: 'Adjustments', value: String(adjustments.rows.length) }], notes: ['An adjustment is not money received: Finance\'s cash never includes it.'] };
  }

  if (kind === 'cars') {
    const P = perf(d);
    const rows = d.vehicles.map((v) => {
      const c = { working: 0, unpaid: 0, paused: 0, rest: 0, no_driver: 0 };
      for (let day = from; day <= to; day = addDays(day, 1)) { const s = carDay(v, P, day); if (s) c[s] += 1; }
      const drv = d.drivers.filter((x) => x.vehicle_id === v.id && x.contract_status === 'active');
      const paid = d.deposits.filter((x) => within(x.paid_date, from, to) && drv.some((y) => y.id === x.driver_id)).reduce((s, x) => s + Number(x.amount), 0)
        + drv.filter((y) => y.initial_deposit_paid && within(initialDate(y), from, to)).reduce((s, y) => s + Number(y.initial_deposit_amount ?? 0), 0);
      return { car: v.plate_number, model: [v.make, v.model, v.color].filter(Boolean).join(' '), owner: v.owner_id ? d.owners.get(v.owner_id) ?? '' : '', drivers: drv.map((x) => `${x.full_name} (${shiftLabel(x.shift)})`).join(', '), ...c, paid };
    });
    return { ...base, title: 'Cars report', subtitle: period, sections: [{
      title: 'Cars', rows, red: (r) => Number(r.unpaid) > 0 || Number(r.no_driver) > 0, columns: [
        { header: 'Car', key: 'car' }, { header: 'Model', key: 'model', width: 20 }, ...(d.owners.size ? [{ header: 'Owner', key: 'owner', width: 22 }] : []), { header: 'Drivers now', key: 'drivers', width: 34 },
        { header: 'Days working', key: 'working', kind: 'int' }, { header: 'Driver not paid up', key: 'unpaid', kind: 'int' }, { header: 'Days off', key: 'paused', kind: 'int' }, { header: 'Rest days', key: 'rest', kind: 'int' },
        { header: 'No driver', key: 'no_driver', kind: 'int' }, { header: 'Paid by its drivers', key: 'paid', kind: 'money' },
      ] as Column[] }],
      kpis: [{ label: 'Cars', value: String(rows.length) }, { label: 'Days working', value: String(rows.reduce((s, r) => s + r.working, 0)) }, { label: 'Days unpaid', value: String(rows.reduce((s, r) => s + r.unpaid, 0)) }, { label: 'Days with no driver', value: String(rows.reduce((s, r) => s + r.no_driver, 0)) }],
      notes: ['A car counts one day as working when one of its drivers is paid up that day; days are judged with only the payments made by then.'] };
  }

  // Full drivers report: everyone on a contract with a car and a start date.
  const active = d.drivers.filter((x) => x.contract_status === 'active' && x.start_date && x.vehicle_id);
  const rows = active.map((x) => {
    const deps = d.deposits.filter((y) => y.driver_id === x.id);
    const s = computeDepositStanding(x, deps, t);
    const end = endDateOf(x, d.events);
    let worked = 0, fullyPaid = 0, pPaid = 0, pUnpaid = 0, pOff = 0;
    for (let day = x.start_date!; day <= t; day = addDays(day, 1)) {
      if (!onContract(x, end, day)) continue;
      const st = driverDay(x, deps, day);
      if (st === 'paid' || st === 'unpaid') { worked++; if (st === 'paid') fullyPaid++; }
      if (within(day, from, to)) { if (st === 'paid') pPaid++; else if (st === 'unpaid') pUnpaid++; else if (st === 'paused') pOff++; }
    }
    const last = [...deps].sort((a, b) => b.paid_date.localeCompare(a.paid_date))[0];
    const myFines = d.fines.filter((f) => f.driver_id === x.id);
    const trips = d.trips.filter((tr) => tr.kivu_driver_id === x.id);
    const done = trips.filter((tr) => tr.status === 'completed');
    const earned = done.reduce((sum, tr) => sum + Number(tr.total_fare ?? 0), 0);
    const paused = !!s.pausedToday;
    return {
      driver: x.full_name, phone: x.phone, car: plateOf(x.vehicle_id), owner: x.vehicle?.owner_id ? d.owners.get(x.vehicle.owner_id) ?? '' : '',
      shift: shiftLabel(x.shift), start: x.start_date, rest: restLabel(x.rest_day),
      status: paused ? 'Day off (paused)' : s.isCleared ? (s.graceUntil ? `Cleared until ${formatDateLabelSafe(s.graceUntil)} (adjusted)` : 'Cleared to drive') : 'Not paid up',
      owes: s.owes, behind: s.weekBehind, next_date: s.nextDueDate, next_amount: s.nextDueAmount, total_paid: s.totalPaid, adjusted: s.adjusted,
      worked, fully_paid: fullyPaid, not_paid: worked - fullyPaid, days_lost: s.daysLost, on_time: s.onTimeWeeks, late: s.lateWeeks,
      p_paid: pPaid, p_unpaid: pUnpaid, p_off: pOff,
      p_collected: deps.filter((y) => within(y.paid_date, from, to)).reduce((sum, y) => sum + Number(y.amount), 0) + (x.initial_deposit_paid && within(initialDate(x), from, to) ? Number(x.initial_deposit_amount ?? 0) : 0),
      last_date: last?.paid_date ?? null, last_amount: last ? Number(last.amount) : null,
      fines_period: myFines.filter((f) => within(f.fine_date, from, to)).reduce((sum, f) => sum + Number(f.amount), 0),
      fines_unpaid: myFines.reduce((sum, f) => sum + Math.max(0, Number(f.amount) - finePaid(f)), 0),
      trips: trips.length, completed: done.length, cancelled: trips.filter((tr) => tr.status === 'cancelled').length, earned, commission: Math.round(earned * COMMISSION_RATE),
    };
  }).sort((a, b) => b.owes - a.owes || a.driver.localeCompare(b.driver));
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const behind = rows.filter((r) => r.status === 'Not paid up');
  const columns: Column[] = [
    { header: 'Driver', key: 'driver', width: 26 }, { header: 'Phone', key: 'phone', width: 14 }, { header: 'Car', key: 'car' }, ...(d.owners.size ? [{ header: 'Owner', key: 'owner', width: 22 } as Column] : []),
    { header: 'Shift', key: 'shift' }, { header: 'Started', key: 'start', kind: 'date' }, { header: 'Rest day', key: 'rest' }, { header: 'Status today', key: 'status', width: 22 },
    { header: 'Owes now', key: 'owes', kind: 'money' }, { header: 'Behind this week', key: 'behind', kind: 'money' }, { header: 'Next payment', key: 'next_date', kind: 'date' }, { header: 'Next amount', key: 'next_amount', kind: 'money' },
    { header: 'Paid in total', key: 'total_paid', kind: 'money' }, { header: 'Adjusted', key: 'adjusted', kind: 'money' },
    { header: 'Days worked', key: 'worked', kind: 'int' }, { header: 'Days fully paid', key: 'fully_paid', kind: 'int' }, { header: 'Days not paid', key: 'not_paid', kind: 'int' },
    { header: 'Days lost (late weeks)', key: 'days_lost', kind: 'int' }, { header: 'Weeks on time', key: 'on_time', kind: 'int' }, { header: 'Weeks late', key: 'late', kind: 'int' },
    { header: 'Period: days paid', key: 'p_paid', kind: 'int' }, { header: 'Period: days unpaid', key: 'p_unpaid', kind: 'int' }, { header: 'Period: days off', key: 'p_off', kind: 'int' }, { header: 'Period: paid', key: 'p_collected', kind: 'money' },
    { header: 'Last payment', key: 'last_date', kind: 'date' }, { header: 'Last amount', key: 'last_amount', kind: 'money' },
    { header: 'Fines (period)', key: 'fines_period', kind: 'money' }, { header: 'Fines unpaid', key: 'fines_unpaid', kind: 'money' },
    { header: 'App trips', key: 'trips', kind: 'int' }, { header: 'Completed', key: 'completed', kind: 'int' }, { header: 'Cancelled', key: 'cancelled', kind: 'int' },
    { header: 'Fares earned', key: 'earned', kind: 'money' }, { header: 'Commission 10%', key: 'commission', kind: 'money' },
  ];
  return {
    ...base, title: 'Full drivers report', subtitle: `${period} · state as of ${formatDateLabelSafe(t)}`,
    kpis: [
      { label: 'Drivers on a car', value: String(rows.length), sub: `${rows.length - behind.length} cleared to drive` },
      { label: 'Not paid up', value: String(behind.length), sub: `${money(sum('behind'))} behind` },
      { label: 'Owed now', value: money(sum('owes')) },
      { label: 'Paid in the period', value: money(sum('p_collected')) },
      { label: 'Fines unpaid', value: money(sum('fines_unpaid')) },
      { label: 'App trips completed', value: String(sum('completed')), sub: `${money(sum('commission'))} commission (10%)` },
    ],
    sections: [{ title: 'Drivers', columns, rows: rows as unknown as Record<string, Cell>[], red: (r) => r.status === 'Not paid up' }, payments, fines, adjustments],
    notes: [
      'Owes now: working days already driven but not paid. Behind this week: what the week needed on its first day, minus what was paid. Days are judged with only the payments made by then.',
      'Adjusted: credits (+) and charges (−) made with Adjust; they are not money received.',
      'App trips, fares and commission are for the period, from the Kivu Ride app; commission is 10% of completed fares.',
    ],
  };
}

// ------------------------------------------------------------------ files
const fmtCell = (v: Cell, kind?: Column['kind']) => (v == null || v === '' ? '' : kind === 'money' ? money(Number(v)) : kind === 'date' ? formatDateLabelSafe(String(v)) : kind === 'pct' ? `${v}%` : String(v));

export async function toExcel(r: Report): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kivu Daily';
  wb.created = new Date();
  const sum = wb.addWorksheet('Summary');
  sum.addRow([`Kivu Ride · ${r.title}`]).font = { bold: true, size: 14, color: { argb: 'FF17263A' } };
  sum.addRow([r.subtitle]).font = { color: { argb: 'FF6B7280' } };
  sum.addRow([]);
  for (const k of r.kpis) sum.addRow([k.label, k.value, k.sub ?? '']);
  sum.addRow([]);
  for (const n of r.notes) sum.addRow([n]).font = { italic: true, color: { argb: 'FF6B7280' } };
  sum.getColumn(1).width = 28; sum.getColumn(2).width = 22; sum.getColumn(3).width = 36;
  for (const s of r.sections) {
    const ws = wb.addWorksheet(s.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? (c.kind === 'money' ? 14 : c.kind === 'date' ? 12 : 12) }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17263A' } };
    head.alignment = { vertical: 'middle', wrapText: true };
    head.height = 30;
    for (const row of s.rows) {
      const added = ws.addRow(Object.fromEntries(s.columns.map((c) => {
        const v = row[c.key];
        return [c.key, v == null || v === '' ? null : c.kind === 'date' ? new Date(`${String(v).slice(0, 10)}T12:00:00Z`) : c.kind === 'money' || c.kind === 'int' || c.kind === 'pct' ? Number(v) : v];
      })));
      if (s.red?.(row)) added.font = { color: { argb: 'FFB91C1C' } };
    }
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.kind === 'money') col.numFmt = '#,##0';
      if (c.kind === 'date') col.numFmt = 'dd mmm yyyy';
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    if (!s.rows.length) ws.addRow([`Nothing in ${r.subtitle}`]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function toPdf(r: Report): Promise<Blob> {
  const logo = await smallLogo();
  const content: object[] = [
    { columns: [
      ...(logo ? [{ image: 'logo', width: 34, margin: [0, 0, 10, 0] }] : []),
      { stack: [{ text: 'KIVU RIDE · FLEET', fontSize: 8, bold: true, color: MUTED, characterSpacing: 1 }, { text: r.title, fontSize: 18, bold: true, color: NAVY }, { text: r.subtitle, fontSize: 9, color: MUTED }] },
    ], margin: [0, 0, 0, 8] },
    kpiRow(r.kpis.slice(0, 6)),
  ];
  for (const s of r.sections) {
    content.push(h1(s.title));
    if (!s.rows.length) { content.push(note('Nothing in this period.')); continue; }
    // The drivers table is wide: the PDF keeps the columns that matter most; Excel has them all.
    const cols = s.title === 'Drivers' ? s.columns.filter((c) => ['driver', 'car', 'shift', 'status', 'owes', 'behind', 'next_date', 'total_paid', 'worked', 'fully_paid', 'days_lost', 'p_collected', 'fines_unpaid', 'completed', 'commission'].includes(c.key)) : s.columns;
    content.push(table(cols.map((c) => c.header), s.rows.map((row) => cols.map((c) => fmtCell(row[c.key], c.kind))), {
      fontSize: s.title === 'Drivers' ? 6.5 : 7.5,
      align: cols.map((c) => (c.kind === 'money' || c.kind === 'int' ? 'right' : 'left')),
      redRows: s.red ? s.rows.map((row, i) => (s.red!(row) ? i : -1)).filter((i) => i >= 0) : undefined,
    }));
    if (s.note) content.push(note(s.note));
  }
  if (r.notes.length) { content.push(h2('How to read it')); for (const n of r.notes) content.push(note(n)); }
  const doc = { ...baseDoc(logo, `${r.title} · ${r.subtitle}`, 'Fleet'), info: { title: r.title, author: 'Kivu Ride Ltd', subject: 'Fleet report' }, pageOrientation: 'landscape', pageMargins: [28, 46, 28, 40], content };
  return render(doc);
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export const fileName = (r: Report, ext: 'xlsx' | 'pdf') => `Kivu Ride - ${r.title} - ${r.from === r.to ? r.from : `${r.from} to ${r.to}`}.${ext}`.replace(/['/\\:*?"<>|]/g, '');
