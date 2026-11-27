import { supabase, Driver, DriverDeposit } from './supabase';
import { computeDepositStanding, DepositStanding, driverShiftShort } from './fleet';
import { kigaliToday } from './kigali';
import { addDays } from './performance';
import { PaymentCall, callLine, carTaken, latestCall } from './paymentCalls';
import { moneyStatus, MoneyStatusKey } from '../components/fleet/driverUi';
import { NAVY, TEAL, MUTED, INK, RED, SOFT, baseDoc, h1, h2, kpiRow, note, para, render, smallLogo, table } from './stationReportPdf';

// The Deposits report (MD, 27 Nov 2026): one PDF with the payments made
// today and yesterday and where every driver stands, in plain words. It
// reads the database itself at the moment the button is pressed, so it is
// never older than that moment.

const ORANGE_TXT = '#b45309';
const GREEN_TXT = '#15803d';
const VIOLET_TXT = '#6d28d9';
const STATUS_COLOR: Record<MoneyStatusKey, string> = {
  taken: RED, late: RED, pay_today: ORANGE_TXT, due_soon: TEAL, paid: GREEN_TXT, paused: VIOLET_TXT, ended: MUTED, not_started: MUTED,
};

const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const dayLong = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayShort = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The groups, most urgent first, each with what it means and what to do.
const GROUPS: { key: MoneyStatusKey; title: string; meaning: string }[] = [
  { key: 'taken', title: 'Car taken back', meaning: 'These cars were taken back for not paying. Give the car back once the driver has paid what they owe.' },
  { key: 'late', title: 'Not paid — action needed', meaning: 'A working day ended without being paid. These drivers are not cleared to drive: call them today and take the car back if they do not pay.' },
  { key: 'pay_today', title: 'Must pay today', meaning: "Today isn't paid yet. Paying today is still accepted; if it isn't paid by tonight, the day is lost and the car is taken back." },
  { key: 'due_soon', title: 'Pay today or tomorrow for the next day', meaning: 'Paid up for now, but their money runs out today or tomorrow. Remind them to pay for the next day, the day before.' },
  { key: 'paid', title: 'Paid up', meaning: 'Paid ahead. Nothing to do until their next pay day.' },
  { key: 'paused', title: 'On days off', meaning: 'Sick, car in the garage, or another approved reason. These days cost nothing.' },
  { key: 'not_started', title: 'Not started yet', meaning: 'On contract but their first day has not come yet.' },
];

// One sentence a reader understands without knowing the system.
function plainWords(s: DepositStanding, key: MoneyStatusKey, taken: PaymentCall | null): string {
  const next = s.nextDueAmount > 0 && s.nextDueDate ? `Next: ${rwf(s.nextDueAmount)} by ${dayShort(s.nextDueDate)}${s.nextUnpaidDay ? ` (for ${dayShort(s.nextUnpaidDay)})` : ''}.` : '';
  switch (key) {
    case 'taken': return `Car taken back on ${dayShort(taken?.happened_at.slice(0, 10))}${taken?.car_location ? ` (${taken.car_location})` : ''}. Owes ${rwf(s.owes)}.`;
    case 'late': return `Owes ${rwf(s.owes)} for days already driven${s.nextUnpaidDay ? ` (unpaid since ${dayShort(s.nextUnpaidDay)})` : ''}. Not cleared to drive until paid.`;
    case 'pay_today': return `Has not paid for today yet: ${rwf(s.owes)} must come in today, or the car is taken back tonight.`;
    case 'due_soon': return `Paid until ${dayShort(s.paidThrough)}. ${next}`;
    case 'paid': return `Paid until ${dayShort(s.paidThrough)}. ${next}`;
    case 'paused': return `On days off (${s.pausedToday?.reason ?? 'approved'}). Paid until ${dayShort(s.paidThrough)}.`;
    case 'not_started': return `Starts on a later date. First payment ${rwf(s.nextDueAmount)}.`;
    default: return '';
  }
}

export async function buildDepositsReport(preparedBy: string): Promise<Blob> {
  // ---- Read everything now
  const now = new Date();
  const today = kigaliToday();
  const yesterday = addDays(today, -1);
  const [dr, dep, pr, pc, logo] = await Promise.all([
    supabase.from('drivers').select('*, vehicle:vehicles(plate_number), pauses:driver_pauses(*)'),
    supabase.from('driver_deposits').select('*'),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('driver_payment_calls').select('*, author:profiles!driver_payment_calls_created_by_fkey(full_name)').order('happened_at', { ascending: false }).limit(2000),
    smallLogo(),
  ]);
  if (dr.error) throw new Error(dr.error.message);
  if (dep.error) throw new Error(dep.error.message);
  const drivers = (dr.data as Driver[]) ?? [];
  const deposits = (dep.data as DriverDeposit[]) ?? [];
  const calls = (pc.data as PaymentCall[] | null) ?? [];
  const nameOf = new Map(((pr.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name.trim()]));
  const driverOf = new Map(drivers.map((d) => [d.id, d]));

  // ---- Payments of a day
  const paymentsOn = (day: string) => deposits.filter((x) => x.paid_date === day).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const payTable = (rows: DriverDeposit[]) => {
    if (!rows.length) return note('No payment recorded for this day.');
    const total = rows.reduce((s, x) => s + Number(x.amount), 0);
    return table(['Logged at', 'Driver', 'Car', 'Amount', 'Paid by', 'Logged by', 'Finance'], [
      ...rows.map((x) => {
        const d = driverOf.get(x.driver_id);
        return [timeOf(x.created_at), d?.full_name ?? 'Unknown driver', d?.vehicle?.plate_number ?? '—', rwf(Number(x.amount)),
          x.payment_method === 'bank' ? `Bank${x.bank_name ? ` (${x.bank_name})` : ''}` : 'MoMo', x.created_by ? (nameOf.get(x.created_by) ?? '—').split(' ')[0] : '—',
          x.status === 'confirmed' ? { text: 'Confirmed', color: GREEN_TXT, fontSize: 8 } : { text: 'Waiting', color: ORANGE_TXT, fontSize: 8 }];
      }),
      [{ text: 'Total', bold: true, fontSize: 8.5 }, { text: plural(rows.length, 'payment'), fontSize: 8, color: MUTED }, '', { text: rwf(total), bold: true, fontSize: 8.5 }, '', '', ''],
    ], { widths: [42, '*', 56, 72, 70, 56, 52], align: ['left', 'left', 'left', 'right', 'left', 'left', 'left'] });
  };
  const todayPays = paymentsOn(today);
  const yesterdayPays = paymentsOn(yesterday);
  const sum = (rows: DriverDeposit[]) => rows.reduce((s, x) => s + Number(x.amount), 0);

  // ---- Every driver on a car and on contract, where they stand right now
  const rows = drivers.filter((d) => d.vehicle_id && d.contract_status === 'active').map((d) => {
    const mine = deposits.filter((x) => x.driver_id === d.id);
    const s = computeDepositStanding(d, mine, today);
    const taken = carTaken(calls, d.id);
    const status = moneyStatus(s, { ended: false, taken: !!taken, today });
    const last = [...mine].sort((a, b) => b.paid_date.localeCompare(a.paid_date) || b.created_at.localeCompare(a.created_at))[0] ?? null;
    const call = latestCall(calls, d.id);
    return { d, s, status, taken, last, call };
  }).sort((a, b) => a.status.rank - b.status.rank || b.s.owes - a.s.owes || a.d.full_name.localeCompare(b.d.full_name));

  const started = rows.filter((r) => r.s.hasStarted);
  const paidUp = started.filter((r) => r.s.isCleared).length;
  const owing = started.filter((r) => r.s.owes > 0);
  const owedTotal = owing.reduce((s, r) => s + r.s.owes, 0);
  const count = (k: MoneyStatusKey) => rows.filter((r) => r.status.key === k).length;

  const generatedAt = `${dayLong(today)} at ${timeOf(now.toISOString())} (Kigali time)`;

  // ---- The status table of one group
  const groupTable = (rs: typeof rows) => table(['Driver and car', 'Where they stand, in simple words', 'Last payment', 'Latest call'], rs.map((r) => [
    { stack: [{ text: r.d.full_name, bold: true, fontSize: 8.5, color: INK }, { text: `${r.d.vehicle?.plate_number ?? '—'} · ${driverShiftShort(r.d) || 'One shift'}`, fontSize: 7.5, color: MUTED }] },
    { stack: [{ text: r.status.label.toUpperCase(), bold: true, fontSize: 7, color: STATUS_COLOR[r.status.key], characterSpacing: 0.3 }, { text: plainWords(r.s, r.status.key, r.taken), fontSize: 8, color: INK, margin: [0, 1, 0, 0] }] },
    r.last ? { stack: [{ text: dayShort(r.last.paid_date), fontSize: 8 }, { text: rwf(Number(r.last.amount)), fontSize: 7.5, color: MUTED }] } : { text: 'Never', fontSize: 8, color: MUTED },
    r.call ? { text: callLine(r.call, deposits, today).text, fontSize: 7.5, color: INK } : { text: 'No call recorded', fontSize: 7.5, color: MUTED },
  ]), { widths: [108, '*', 62, 118] });

  const content: object[] = [
    // Title block
    {
      table: { widths: ['*'], body: [[{
        stack: [
          { text: 'DRIVER PAYMENTS', color: '#7fd1c9', fontSize: 8, bold: true, characterSpacing: 1.2 },
          { text: 'Deposits report', color: '#ffffff', fontSize: 22, bold: true, margin: [0, 3, 0, 4] },
          { text: `Generated on ${generatedAt} · by ${preparedBy}`, color: '#cbd5e1', fontSize: 9 },
          { text: 'Figures are exactly as they were in Kivu Daily at that moment.', color: '#94a3b8', fontSize: 8, margin: [0, 2, 0, 0] },
        ],
        fillColor: NAVY, margin: [14, 14, 14, 14],
      }]] },
      layout: 'noBorders', margin: [0, 0, 0, 12],
    },

    h1('At a glance', '1'),
    kpiRow([
      { label: 'Paid today', value: rwf(sum(todayPays)), sub: plural(todayPays.length, 'payment'), color: GREEN_TXT },
      { label: 'Paid yesterday', value: rwf(sum(yesterdayPays)), sub: plural(yesterdayPays.length, 'payment') },
      { label: 'Drivers paid up now', value: `${paidUp} / ${started.length}`, sub: started.length - paidUp ? `${started.length - paidUp} not paid up` : 'Everyone is paid up', color: paidUp < started.length ? RED : GREEN_TXT },
      { label: 'Owed for days driven', value: rwf(owedTotal), sub: plural(owing.length, 'driver'), color: owedTotal ? RED : NAVY },
    ]),
    para([
      { text: `Today (${dayShort(today)}) ` }, { text: `${plural(todayPays.length, 'payment')} came in for ${rwf(sum(todayPays))}`, bold: true },
      { text: `; yesterday (${dayShort(yesterday)}) ` }, { text: `${plural(yesterdayPays.length, 'payment')} for ${rwf(sum(yesterdayPays))}`, bold: true }, { text: '. ' },
      { text: `Of the ${started.length} drivers on the road, ${paidUp} are paid up right now. ` },
      ...(count('late') + count('taken') ? [{ text: `${plural(count('late') + count('taken'), 'driver')} owe money for days already driven (${rwf(owedTotal)} in total)`, bold: true, color: RED }, { text: count('taken') ? `, ${count('taken')} of them with the car taken back. ` : '. ' }] : [{ text: 'Nobody owes money for days already driven. ' }]),
      ...(count('pay_today') ? [{ text: `${plural(count('pay_today'), 'driver')} must still pay for today. `, color: ORANGE_TXT }] : []),
      ...(count('due_soon') ? [{ text: `${plural(count('due_soon'), 'driver')} must pay today or tomorrow for the next day.` }] : []),
    ]),
    table(['Group', 'Drivers', 'Owed'], GROUPS.filter((g) => count(g.key)).map((g) => [
      { text: g.title, color: STATUS_COLOR[g.key], bold: true, fontSize: 8.5 }, String(count(g.key)),
      (() => { const o = rows.filter((r) => r.status.key === g.key).reduce((s, r) => s + r.s.owes, 0); return o ? rwf(o) : '—'; })(),
    ]), { widths: ['*', 60, 100], align: ['left', 'right', 'right'] }),

    h1('Payments made today', '2'),
    { text: dayLong(today), fontSize: 9, color: MUTED, margin: [0, -6, 0, 6] },
    payTable(todayPays),

    h1('Payments made yesterday', '3'),
    { text: dayLong(yesterday), fontSize: 9, color: MUTED, margin: [0, -6, 0, 6] },
    payTable(yesterdayPays),
    note('"Finance: Waiting" = logged by Fleet but not yet confirmed by Finance; it already counts for the driver.'),

    { text: '', pageBreak: 'before' },
    h1('Where every driver stands', '4'),
    para('Every driver on a car, grouped by what they need — the most urgent first. Each line says, in plain words, where the driver stands right now and what happens next.'),
    ...GROUPS.flatMap((g) => {
      const rs = rows.filter((r) => r.status.key === g.key);
      if (!rs.length) return [];
      const owed = rs.reduce((s, r) => s + r.s.owes, 0);
      return [
        { stack: [
          { columns: [
            { text: `${g.title} (${rs.length})`, fontSize: 11, bold: true, color: STATUS_COLOR[g.key], width: '*' },
            { text: owed ? `${rwf(owed)} owed` : '', fontSize: 9, bold: true, color: STATUS_COLOR[g.key], alignment: 'right', width: 'auto' },
          ], margin: [0, 8, 0, 1] },
          { text: g.meaning, fontSize: 8, color: MUTED, margin: [0, 0, 0, 3] },
        ], unbreakable: true },
        groupTable(rs),
      ];
    }),

    { unbreakable: true, stack: [
      h2('How to read this report'),
      table(['Word', 'What it means'], [
        ['The rule', 'Each driver pays for the next day the day before. Paying on the morning of that day is tolerated. Any amount counts.'],
        ['Paid until', 'The last day the driver\'s payments cover.'],
        ['Next', 'The amount to pay, the day to pay it by, and the day it is for.'],
        ['Owes', 'Working days already driven (or today) that are not paid.'],
        ['Not paid', 'A working day ended unpaid: the day is lost and the car is taken back until they pay.'],
        ['Latest call', 'The last conversation recorded about money: a promise (with its time), no answer, refused, or the car taken back.'],
      ], { widths: [70, '*'] }),
    ] },
  ];

  return render({
    ...baseDoc(logo, 'Deposits report', 'Driver payments'),
    info: { title: `Deposits report ${today}`, author: 'Kivu Ride Ltd', subject: 'Driver payments' },
    content,
    styles: { soft: { fillColor: SOFT } },
  });
}
