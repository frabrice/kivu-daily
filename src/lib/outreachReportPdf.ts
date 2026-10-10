import { OutreachCall, OutreachRound, ANSWER_LABEL, APP_STATUS_SHORT, APP_USAGE_LABEL, CATEGORY_LABEL, RESULT_LABEL } from './outreach';
import type { ReportRow } from '../pages/callCenter/OutreachReport';
import {
  AQUA, BLUE, GREY, baseDoc, cover, h1, h2, hBars, kpiRow, legend, note, para, render, smallLogo, table,
} from './stationReportPdf';

// PDF of the Non-Insider outreach campaign for the MD: headline numbers,
// funnel, answers, agents, the drivers who said yes (for the Fleet
// Manager to follow up), and the full list of every driver.

const VIOLET = '#4a3aa7';
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const d = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export async function buildOutreachReport(input: {
  rows: ReportRow[]; calls: OutreachCall[]; round: OutreachRound | null; names: Record<string, string>;
  agents: { name: string; calls: number; reached: number; yes: number; drivers: number }[];
}): Promise<Blob> {
  const { rows, calls, round, names, agents } = input;
  const logo = await smallLogo();
  const title = 'Non-Insider Outreach Report';
  const total = rows.length;
  const called = rows.filter((r) => r.s?.last_called_at).length;
  const reached = rows.filter((r) => r.s?.ever_reached).length;
  const yes = (r: ReportRow) => r.s?.device_answer === 'yes' || r.s?.branding_answer === 'yes';
  const interested = rows.filter(yes).sort((a, b) => (b.s?.last_called_at ?? '').localeCompare(a.s?.last_called_at ?? ''));
  const dev = rows.filter((r) => r.s?.device_answer === 'yes').length;
  const brand = rows.filter((r) => r.s?.branding_answer === 'yes').length;
  const came = rows.filter((r) => r.s?.came_to_office_on).length;
  const coming = rows.filter((r) => r.s?.app_status === 'will_come').length;
  const first = calls.length ? calls[calls.length - 1].created_at : null;

  const count = (f: (r: ReportRow) => boolean) => rows.filter(f).length;
  const answerRows = [
    { label: 'Device (120,000 RWF)', y: dev, t: count((r) => r.s?.device_answer === 'thinking'), n: count((r) => r.s?.device_answer === 'no'), na: count((r) => !r.s?.device_answer) },
    { label: 'Branding (20,000 RWF)', y: brand, t: count((r) => r.s?.branding_answer === 'thinking'), n: count((r) => r.s?.branding_answer === 'no'), na: count((r) => !r.s?.branding_answer) },
    { label: 'Updated app', y: count((r) => r.s?.app_status === 'will_come' || r.s?.app_status === 'has_latest'), t: 0, n: count((r) => r.s?.app_status === 'not_interested'), na: count((r) => !r.s?.app_status) },
  ];
  const ans = (v?: 'yes' | 'thinking' | 'no' | null) => (v ? ANSWER_LABEL[v] : '—');

  const content: object[] = [
    ...cover(logo, 'Non-Insider driver outreach', 'Outreach Report', 'Every Non-Insider driver the Call Center has called about the updated app, our device and branding — with the answers.', [
      ['Drivers', `${total} Non-Insider drivers`], ['Campaign', `Round ${round?.number ?? 1} · since ${d(first)}`],
      ['Outreach calls', String(calls.length)], ['Prepared', `${today()} · for the Managing Director`],
    ], ['Summary', 'Answers to the three questions', 'Agents', 'Drivers who said yes', 'Every driver']),
    { text: '', pageBreak: 'after' },

    h1('Summary', '1'),
    kpiRow([
      { label: 'Called', value: `${called} / ${total}`, sub: `${reached} reached` },
      { label: 'Want the device', value: String(dev), sub: `${pct(dev, reached)} of reached`, color: '#15803d' },
      { label: 'Want branding', value: String(brand), sub: `${pct(brand, reached)} of reached`, color: '#15803d' },
      { label: 'Came to the office', value: String(came), sub: `${coming} more said they will come` },
    ]),
    para(`The Call Center has called ${called} of the ${total} Non-Insider drivers and reached ${reached}. ${interested.length} said yes to our device or branding (${pct(interested.length, reached)} of those reached): ${dev} want the device (120,000 RWF, one-time) and ${brand} want branding (20,000 RWF, one-time, priority driver). ${came} have come to the office for the updated app so far.`),
    h2('From call to office'),
    { svg: hBars([
      { label: 'Non-Insider drivers', parts: [{ v: total, color: BLUE }], end: String(total) },
      { label: 'Called', parts: [{ v: called, color: BLUE }], end: String(called) },
      { label: 'Reached', parts: [{ v: reached, color: BLUE }], end: String(reached) },
      { label: 'Said yes (device or branding)', parts: [{ v: interested.length, color: AQUA }], end: String(interested.length) },
      { label: 'Came to the office', parts: [{ v: came, color: AQUA }], end: String(came) },
    ], { labelW: 150, max: total }), width: 515 },

    h1('Answers to the three questions', '2'),
    legend([{ label: 'Yes', color: AQUA }, { label: 'Thinking about it', color: '#eda100' }, { label: 'No', color: VIOLET }, { label: 'Not asked yet', color: GREY }]),
    { svg: hBars(answerRows.map((a) => ({ label: a.label, parts: [{ v: a.y, color: AQUA }, { v: a.t, color: '#eda100' }, { v: a.n, color: VIOLET }, { v: a.na, color: GREY }], end: `${a.y} yes` })), { labelW: 130, max: total }), width: 515 },
    table(['Question', 'Yes', 'Thinking', 'No', 'Not asked'], answerRows.map((a) => [a.label, String(a.y), String(a.t), String(a.n), String(a.na)]), { widths: ['*', 60, 60, 60, 60], align: ['left', 'right', 'right', 'right', 'right'] }),
    note('Updated app: "yes" = will come to the office for it, or already has it. Latest answer per driver.'),
    h2('How much reached drivers use our app'),
    table(['Use of the Kivu Ride app', 'Drivers'], Object.entries(APP_USAGE_LABEL).map(([k, l]) => [l, String(count((r) => r.s?.app_usage === k))]), { widths: ['*', 60], align: ['left', 'right'] }),

    { unbreakable: true, stack: [
      h1('Agents', '3'),
      table(['Agent', 'Calls', 'Drivers', 'Reached', 'Said yes'], agents.map((a) => [a.name, String(a.calls), String(a.drivers), `${a.reached} (${pct(a.reached, a.calls)})`, String(a.yes)]), { widths: ['*', 50, 50, 80, 50], align: ['left', 'right', 'right', 'right', 'right'] }),
    ] },
    { text: '', pageBreak: 'after' },

    h1('Drivers who said yes', '4'),
    para(`${interested.length} driver${interested.length === 1 ? '' : 's'} said yes to the device or branding. The Fleet Manager follows each one up for payment and the work.`),
    interested.length ? table(['Driver', 'Phone', 'Car', 'Device', 'Branding', 'Updated app', 'Came', 'Last call'],
      interested.map((r) => [r.d.full_name, r.d.phone, `${r.d.car?.plate_number ?? '—'}${r.d.car?.make ? ` ${r.d.car.make}` : ''}`, ans(r.s?.device_answer), ans(r.s?.branding_answer), r.s?.app_status ? APP_STATUS_SHORT[r.s.app_status] : '—', d(r.s?.came_to_office_on), `${d(r.s?.last_called_at)}${r.s?.last_agent_id && names[r.s.last_agent_id] ? ` · ${names[r.s.last_agent_id].split(/\s+/)[0]}` : ''}`]),
      { widths: ['*', 62, 66, 40, 44, 56, 34, 60], fontSize: 7.5 }) : note('Nobody has said yes yet.'),
    { text: '', pageBreak: 'after' },

    h1('Every driver', '5'),
    table(['Driver', 'Phone', 'Plate', 'Category', 'App', 'Device', 'Brand', 'Calls', 'Last call'],
      [...rows].sort((a, b) => Number(yes(b)) - Number(yes(a)) || a.d.full_name.localeCompare(b.d.full_name)).map((r) => [
        r.d.full_name, r.d.phone, r.d.car?.plate_number ?? '—', CATEGORY_LABEL[r.category], r.s?.app_status ? APP_STATUS_SHORT[r.s.app_status] : '—',
        ans(r.s?.device_answer), ans(r.s?.branding_answer), String(r.calls), r.s?.last_called_at ? `${d(r.s.last_called_at)} ${r.s.last_result ? RESULT_LABEL[r.s.last_result] : ''}` : '—',
      ]),
      { widths: ['*', 58, 46, 70, 46, 34, 34, 26, 70], align: ['left', 'left', 'left', 'left', 'left', 'left', 'left', 'right', 'left'], fontSize: 7 }),
    note(`Drivers who said yes are listed first. Wrong numbers: ${count((r) => r.s?.last_result === 'wrong_number')}.`),
  ];
  return render({ ...baseDoc(logo, title, 'Non-Insider outreach'), content });
}
