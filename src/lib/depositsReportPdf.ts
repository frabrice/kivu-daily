import { supabase, Driver, DriverDeposit } from './supabase';
import { computeDepositStanding, DepositStanding, driverShiftShort } from './fleet';
import { kigaliToday } from './kigali';
import { addDays } from './performance';
import { PaymentCall, callLine, carTaken, lastPayment, latestCall } from './paymentCalls';
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

// Ended contracts are listed for this many days after they end.
const ENDED_DAYS = 30;
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
    // An open-ended day off counts as covered, so "paid until" would read far in the future: say since when instead.
    case 'paused': return `On days off (${s.pausedToday?.reason ?? 'approved'}) since ${dayShort(s.pausedToday?.start_date)}${s.pausedToday?.end_date ? ` until ${dayShort(s.pausedToday.end_date)}` : ''}. Nothing is owed while off.`;
    case 'not_started': return `Starts on a later date. First payment ${rwf(s.nextDueAmount)}.`;
    default: return '';
  }
}

// Money received from someone not (yet) in Kivu Daily as a driver on a car -
// not registered, not on a car, not started - typed in when the report is
// made (MD, 27 Nov 2026) so the report's totals cover all money received.
// Report only: nothing is saved in Kivu Daily.
export interface ReportAddition { name: string; amount: number; date: string; reason: string }

export async function buildDepositsReport(preparedBy: string, additions: ReportAddition[] = []): Promise<Blob> {
  // ---- Read everything now
  const now = new Date();
  const today = kigaliToday();
  const yesterday = addDays(today, -1);
  const endedSince = addDays(today, -ENDED_DAYS);
  const [dr, dep, pr, pc, logo, ev, cars, rv] = await Promise.all([
    supabase.from('drivers').select('*, vehicle:vehicles(plate_number), pauses:driver_pauses(*)'),
    supabase.from('driver_deposits').select('*'),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('driver_payment_calls').select('*, author:profiles!driver_payment_calls_created_by_fkey(full_name)').order('happened_at', { ascending: false }).limit(2000),
    smallLogo(),
    // Contracts that ended recently (MD, 27 Nov 2026), and the car each was on last.
    supabase.from('driver_contract_events').select('*').eq('event_type', 'ended').gte('event_date', endedSince).order('event_date', { ascending: false }),
    supabase.from('driver_car_assignments').select('driver_id, from_date, vehicle:vehicles(plate_number)').order('from_date', { ascending: false }),
    supabase.from('driver_money_reviews').select('driver_id, outcome, created_at').order('created_at', { ascending: false }),
  ]);
  // Confirmed terminated in Driver Adjust: their money is closed (nothing chased or changed any more).
  const latestReview = new Map<string, string>();
  for (const r of (rv.data ?? []) as { driver_id: string; outcome: string }[]) if (!latestReview.has(r.driver_id)) latestReview.set(r.driver_id, r.outcome);
  const moneyClosed = (driverId: string) => latestReview.get(driverId) === 'terminated';
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
  // Additions typed in for this report, counted with the day they were received.
  const adds = additions.filter((a) => a.name.trim() && a.amount > 0).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const addsOn = (day: string) => adds.filter((a) => a.date === day);
  const addSum = (list: ReportAddition[]) => list.reduce((s, a) => s + a.amount, 0);
  const paidOn = (day: string, sys: DriverDeposit[]) => sum(sys) + addSum(addsOn(day));
  const countText = (sys: DriverDeposit[], day: string) => `${plural(sys.length, 'payment')}${addsOn(day).length ? ` + ${addsOn(day).length} added by hand` : ''}`;
  const addsTable = adds.length ? table(['Name', 'Received on', 'Amount', 'Why not in the system yet'], [
    ...adds.map((a) => [{ text: a.name.trim(), bold: true, fontSize: 8.5 }, dayShort(a.date), rwf(a.amount), a.reason.trim() || '—']),
    [{ text: 'Total', bold: true, fontSize: 8.5 }, { text: plural(adds.length, 'payment'), fontSize: 8, color: MUTED }, { text: rwf(addSum(adds)), bold: true, fontSize: 8.5 }, ''],
  ], { widths: [120, 70, 80, '*'], align: ['left', 'left', 'right', 'left'] }) : null;

  // ---- Every driver on a car and on contract, where they stand right now
  const rows = drivers.filter((d) => d.vehicle_id && d.contract_status === 'active').map((d) => {
    const mine = deposits.filter((x) => x.driver_id === d.id);
    const s = computeDepositStanding(d, mine, today);
    const taken = carTaken(calls, d.id);
    const status = moneyStatus(s, { ended: false, taken: !!taken, today });
    // The start deposit counts as a payment too.
    const last = lastPayment(d, mine);
    const call = latestCall(calls, d.id);
    return { d, s, status, taken, last, call };
  }).sort((a, b) => a.status.rank - b.status.rank || b.s.owes - a.s.owes || a.d.full_name.localeCompare(b.d.full_name));

  const started = rows.filter((r) => r.s.hasStarted);
  const paidUp = started.filter((r) => r.s.isCleared).length;
  const owing = started.filter((r) => r.s.owes > 0);
  const owedTotal = owing.reduce((s, r) => s + r.s.owes, 0);
  const count = (k: MoneyStatusKey) => rows.filter((r) => r.status.key === k).length;
  const owedIn = (...ks: MoneyStatusKey[]) => rows.filter((r) => ks.includes(r.status.key)).reduce((s, r) => s + r.s.owes, 0);
  const lateCount = count('late') + count('taken');
  const lateOwed = owedIn('late', 'taken');
  const todayOwed = owedIn('pay_today');

  const generatedAt = `${dayLong(today)} at ${timeOf(now.toISOString())} (Kigali time)`;

  // ---- Contracts ended in the last ENDED_DAYS days: when, why, and what they still owe
  type EndEvent = { id: string; driver_id: string; event_date: string; reason: string; details: string | null; meta: Record<string, unknown> | null };
  const lastCarOf = new Map<string, string>();
  for (const a of (cars.data ?? []) as unknown as { driver_id: string; vehicle: { plate_number: string } | null }[]) {
    if (!lastCarOf.has(a.driver_id) && a.vehicle?.plate_number) lastCarOf.set(a.driver_id, a.vehicle.plate_number);
  }
  const seenEnded = new Set<string>();
  const ended = ((ev.data ?? []) as EndEvent[]).filter((e) => {
    const d = driverOf.get(e.driver_id);
    if (!d || d.contract_status !== 'ended' || seenEnded.has(e.driver_id)) return false; // still ended, latest end only
    seenEnded.add(e.driver_id);
    return true;
  }).map((e) => {
    const d = driverOf.get(e.driver_id)!;
    const owedAtEnd = Number(e.meta?.owed ?? 0);
    const paidAfter = deposits.filter((x) => x.driver_id === d.id && x.paid_date > e.event_date).reduce((s, x) => s + Number(x.amount), 0);
    const finesUnpaid = Number(e.meta?.fines_unpaid ?? 0);
    const decided = String(e.meta?.decided_by ?? '');
    const closed = moneyClosed(d.id);
    return {
      d, e, plate: d.vehicle?.plate_number ?? lastCarOf.get(d.id) ?? '—', closed,
      stillOwes: closed ? 0 : Math.max(owedAtEnd - paidAfter, 0), owedAtEnd, paidAfter, finesUnpaid,
      decided: decided === 'driver' ? 'The driver left' : decided === 'mutual' ? 'Agreed together' : 'Kivu Ride ended it',
      paidThrough: (e.meta?.paid_through as string | null) ?? null,
    };
  });
  const endedOwed = ended.reduce((s, x) => s + x.stillOwes, 0);
  const endedOpen = ended.filter((x) => !x.closed);
  const endedClosed = ended.filter((x) => x.closed);
  const endedTable = (list: typeof ended) => list.length ? table(['Driver and car', 'Ended', 'Why', 'Money at the end'], list.map((x) => [
    { stack: [{ text: x.d.full_name, bold: true, fontSize: 8.5 }, { text: x.plate, fontSize: 7.5, color: MUTED }] },
    { stack: [{ text: dayShort(x.e.event_date), fontSize: 8.5 }, { text: x.decided, fontSize: 7.5, color: MUTED }] },
    { stack: [{ text: x.e.reason, fontSize: 8 }, ...(x.e.details ? [{ text: x.e.details, fontSize: 7.5, color: MUTED }] : [])] },
    x.closed ? { stack: [
      { text: 'Money closed', bold: true, fontSize: 8.5, color: MUTED },
      { text: `${x.owedAtEnd > 0 ? `${rwf(x.owedAtEnd)} on record when it ended — not chased. ` : ''}Confirmed terminated in Driver Adjust.`, fontSize: 7.5, color: MUTED },
    ] } : { stack: [
      x.stillOwes > 0
        ? { text: `Still owes ${rwf(x.stillOwes)}`, bold: true, fontSize: 8.5, color: RED }
        : { text: x.owedAtEnd > 0 ? 'Paid what was owed' : 'Owed nothing', bold: true, fontSize: 8.5, color: GREEN_TXT },
      { text: [x.owedAtEnd > 0 ? `Owed ${rwf(x.owedAtEnd)} when it ended` : null, x.paidAfter > 0 ? `paid ${rwf(x.paidAfter)} since` : null, x.paidThrough ? `paid until ${dayShort(x.paidThrough)}` : null, x.finesUnpaid > 0 ? `fines unpaid ${rwf(x.finesUnpaid)}` : null].filter(Boolean).join(' · ') || '—', fontSize: 7.5, color: MUTED },
    ] },
  ]), { widths: [110, 78, '*', 150] }) : null;

  // ---- The status table of one group
  const groupTable = (rs: typeof rows) => table(['Driver and car', 'Where they stand, in simple words', 'Last payment', 'Latest call'], rs.map((r) => [
    { stack: [{ text: r.d.full_name, bold: true, fontSize: 8.5, color: INK }, { text: `${r.d.vehicle?.plate_number ?? '—'} · ${driverShiftShort(r.d) || 'One shift'}`, fontSize: 7.5, color: MUTED }] },
    { stack: [{ text: r.status.label.toUpperCase(), bold: true, fontSize: 7, color: STATUS_COLOR[r.status.key], characterSpacing: 0.3 }, { text: plainWords(r.s, r.status.key, r.taken), fontSize: 8, color: INK, margin: [0, 1, 0, 0] }] },
    r.last ? { stack: [{ text: dayShort(r.last.date), fontSize: 8 }, { text: `${rwf(r.last.amount)}${r.last.pending ? ' · unconfirmed' : ''}`, fontSize: 7.5, color: MUTED }] } : { text: 'Never', fontSize: 8, color: MUTED },
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
      { label: 'Paid today', value: rwf(paidOn(today, todayPays)), sub: countText(todayPays, today), color: GREEN_TXT },
      { label: 'Paid yesterday', value: rwf(paidOn(yesterday, yesterdayPays)), sub: countText(yesterdayPays, yesterday) },
      { label: 'Drivers paid up now', value: `${paidUp} / ${started.length}`, sub: started.length - paidUp ? `${started.length - paidUp} not paid up` : 'Everyone is paid up', color: paidUp < started.length ? RED : GREEN_TXT },
      { label: 'Owed now', value: rwf(owedTotal), sub: `${plural(owing.length, 'driver')}, today included`, color: owedTotal ? RED : NAVY },
    ]),
    para([
      { text: `Today (${dayShort(today)}) ` }, { text: `${countText(todayPays, today)} came in for ${rwf(paidOn(today, todayPays))}`, bold: true },
      { text: `; yesterday (${dayShort(yesterday)}) ` }, { text: `${countText(yesterdayPays, yesterday)} for ${rwf(paidOn(yesterday, yesterdayPays))}`, bold: true }, { text: '. ' },
      ...(adds.length ? [{ text: `This includes ${plural(adds.length, 'payment')} (${rwf(addSum(adds))}) from people not yet in Kivu Daily as drivers on a car — see "Money received, not yet in the system". ` }] : []),
      { text: `Of the ${started.length} drivers on the road, ${paidUp} are paid up right now. ` },
      ...(lateCount ? [{ text: `${plural(lateCount, 'driver')} owe ${rwf(lateOwed)} for days already driven`, bold: true, color: RED }, { text: count('taken') ? `, ${count('taken')} of them with the car taken back. ` : '. ' }] : [{ text: 'Nobody owes money for days already driven. ' }]),
      ...(count('pay_today') ? [{ text: `${plural(count('pay_today'), 'more driver')} must still pay ${rwf(todayOwed)} for today. `, color: ORANGE_TXT }] : []),
      ...(count('due_soon') ? [{ text: `${plural(count('due_soon'), 'driver')} must pay today or tomorrow for the next day. ` }] : []),
      ...(ended.length ? [{ text: `${plural(ended.length, 'contract')} ended in the last ${ENDED_DAYS} days${endedClosed.length ? ` (${endedClosed.length} closed in Driver Adjust)` : ''}` }, { text: endedOwed ? `; the others still owe ${rwf(endedOwed)}.` : '.', color: endedOwed ? RED : INK }] : []),
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

    // Heading, explanation and table stay on one page.
    ...(addsTable ? [{ unbreakable: adds.length <= 15, stack: [
      h2('Money received, not yet in the system'),
      para('Payments from people who are not yet in Kivu Daily as a driver on a car (not registered, no car yet, or not started). They were added by hand for this report so the totals above cover all money received. They are not saved in Kivu Daily: register the driver and log the payment there.'),
      addsTable,
    ] }] : []),

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

    { stack: [
      h1(`Contracts ended (last ${ENDED_DAYS} days)`, '5'),
      para(ended.length
        ? `${plural(ended.length, 'driver')} stopped in the last ${ENDED_DAYS} days. They no longer drive for us, but what they still owe is shown so it can be collected.${endedOwed ? ` Together they still owe ${rwf(endedOwed)}.` : ''}`
        : `No driver stopped in the last ${ENDED_DAYS} days.`),
      ...(endedOpen.length ? [endedTable(endedOpen)] : ended.length ? [] : [note(`No contract ended in the last ${ENDED_DAYS} days.`)]),
      ...(endedClosed.length ? [
        h2(`Confirmed terminated in Driver Adjust (${endedClosed.length})`),
        note('Their money was closed when the termination was confirmed: nothing is chased, added or corrected any more. The amount shown is only what the system had on record when the contract ended.'),
        endedTable(endedClosed),
      ] : []),
    ] },

    { unbreakable: true, stack: [
      h2('How to read this report'),
      table(['Word', 'What it means'], [
        ['The rule', 'Each driver pays for the next day the day before. Paying on the morning of that day is tolerated. Any amount counts.'],
        ['Paid until', 'The last day the driver\'s payments cover.'],
        ['Next', 'The amount to pay, the day to pay it by, and the day it is for.'],
        ['Owes', 'Working days already driven (or today) that are not paid.'],
        ['Not paid', 'A working day ended unpaid: the day is lost and the car is taken back until they pay.'],
        ['Latest call', 'The last conversation recorded about money: a promise (with its time), no answer, refused, or the car taken back.'],
        ['Contract ended', 'The driver stopped. "Still owes" = what they owed for days driven when it ended, minus anything paid since.'],
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
