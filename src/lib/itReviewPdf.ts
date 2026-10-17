import { getLogoDataUrl, getPdfMake } from './newsletterPdf';
import { FORECAST, ItData, TYPE_LABEL, dayLabel, keyOf } from './it';
import { ItWeeklyReview, PLATFORM_LABEL, RELEASE_STATUS, WeekReview, releaseLabel, weekLabel } from './itReview';

// The weekly IT review as an A4 PDF (pdfmake, in the browser): the numbers,
// milestones, what shipped, who did what, releases, decisions, what needs
// attention, next week, and the meeting notes.

const NAVY = '#17263A';
const TEAL = '#2F8C86';
const GREEN = '#4F7B3E';
const RED = '#B42318';
const AMBER = '#B7791F';
const INK = '#1F2937';
const MUTED = '#6B7280';
const LINE = '#E3E7EC';
const ZEBRA = '#F6F8FA';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Content = any;

const section = (t: string, sub?: string): Content => ({
  stack: [{ text: t.toUpperCase(), fontSize: 8, bold: true, color: TEAL, characterSpacing: 1.2 }, ...(sub ? [{ text: sub, fontSize: 7.5, color: MUTED, margin: [0, 1, 0, 0] }] : [])],
  margin: [0, 14, 0, 5],
});
const hairline = { hLineWidth: (i: number) => (i === 0 ? 0 : 0.6), vLineWidth: () => 0, hLineColor: () => LINE, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 3, paddingBottom: () => 3 };
function table(head: string[], rows: Content[][], widths: (string | number)[], right: number[] = []): Content {
  if (!rows.length) return { text: 'Nothing this week.', fontSize: 8, color: MUTED, italics: true };
  return {
    table: {
      headerRows: 1, widths,
      body: [head.map((h, i) => ({ text: h, bold: true, fontSize: 7.5, color: '#FFFFFF', fillColor: NAVY, alignment: right.includes(i) ? 'right' : 'left' })),
        ...rows.map((r, n) => r.map((c, i) => ({ ...(typeof c === 'object' ? c : { text: String(c) }), fontSize: 8, fillColor: n % 2 ? ZEBRA : null, alignment: right.includes(i) ? 'right' : 'left' })))],
    },
    layout: hairline,
  };
}
const tile = (label: string, value: string, sub: string, color = NAVY): Content => ({
  stack: [{ text: label.toUpperCase(), fontSize: 6.5, color: MUTED, bold: true, characterSpacing: 0.8 }, { text: value, fontSize: 17, bold: true, color, margin: [0, 2, 0, 1] }, { text: sub, fontSize: 7, color: MUTED }],
  margin: [0, 0, 0, 0],
});
const notesBlock = (title: string, text: string | null | undefined): Content[] => (text?.trim() ? [{ text: title, bold: true, fontSize: 8.5, color: NAVY, margin: [0, 6, 0, 2] }, { text: text.trim(), fontSize: 8.5, lineHeight: 1.3 }] : []);

export async function weeklyReviewPdfBlob(r: WeekReview, review: ItWeeklyReview | null, data: ItData): Promise<Blob> {
  const pdfMake = await getPdfMake();
  const logo = await getLogoDataUrl();
  const area = (k: string) => (k ? data.areaLabel(k) : 'No area');
  const held = review?.held_at ? `Reviewed ${dayLabel(review.held_at, true)} · ${review.attendees.map((a) => data.nameOf(a).split(' ')[0]).join(', ') || '—'}` : r.current ? 'Week in progress' : 'Not reviewed yet';

  const tiles: Content = {
    columns: [
      tile('Shipped', String(r.done), `${r.points} points · ${r.unplannedDone} unplanned`, GREEN),
      tile('Bugs', `${r.bugsClosed} fixed`, `${r.bugsOpened} new reported`, r.bugsOpened > r.bugsClosed ? RED : NAVY),
      tile('Releases', String(r.releases), `${r.decisions} decision${r.decisions === 1 ? '' : 's'} made`),
      tile('Requests', String(r.requestsIn), `${r.requestsTriaged} triaged`),
      tile('Check-ins', r.checkinRate === null ? '—' : `${r.checkinRate}%`, 'answered', r.checkinRate !== null && r.checkinRate < 80 ? AMBER : NAVY),
    ],
    columnGap: 10,
  };

  const content: Content[] = [
    {
      columns: [
        { width: '*', stack: [logo ? { image: logo, width: 60 } : { text: 'KIVU RIDE', bold: true, fontSize: 16, color: NAVY }] },
        { width: 'auto', stack: [{ text: 'WEEKLY REVIEW', fontSize: 20, bold: true, color: NAVY, characterSpacing: 2.5, alignment: 'right' }, { text: `IT & Product · ${weekLabel(r.week)}`, fontSize: 9, color: INK, alignment: 'right', margin: [0, 2, 0, 0] }, { text: held, fontSize: 7.5, color: MUTED, alignment: 'right', margin: [0, 2, 0, 0] }] },
      ],
    },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 93, h: 3, color: GREEN }, { type: 'rect', x: 93, y: 0, w: 165, h: 3, color: TEAL }, { type: 'rect', x: 258, y: 0, w: 257, h: 3, color: NAVY }], margin: [0, 10, 0, 14] },
    tiles,
  ];

  if (review && (review.highlights || review.risks || review.next_focus || review.notes)) {
    content.push(section('Meeting notes'), ...notesBlock('Highlights', review.highlights), ...notesBlock('Risks & problems', review.risks), ...notesBlock('Focus for next week', review.next_focus), ...notesBlock('Other notes', review.notes));
  }

  content.push(section('Milestones', 'Progress counts issue sizes (points) done.'),
    table(['Milestone', 'Dates', 'Done', 'Progress', 'This week', 'Forecast'], r.milestones.map(({ m, s, doneThisWeek }) => [
      { text: `M${m.number} · ${m.name}`, bold: true }, `${dayLabel(m.start_date)} – ${dayLabel(m.end_date)}`, `${s.done}/${s.total}`, `${s.pct}% (time ${s.timePct}%)`, String(doneThisWeek),
      { text: FORECAST[s.forecast].label, color: s.forecast === 'late' ? RED : s.forecast === 'at_risk' ? AMBER : GREEN, bold: true },
    ]), ['*', 70, 35, 70, 45, 55], [2, 4]));

  content.push(section(`Shipped (${r.done})`, r.byArea.map((a) => `${area(a.key)} ${a.n}`).join(' · ')),
    table(['Issue', 'Type', 'Area', 'Who', 'Done'], r.doneIssues.map((i) => [
      { text: [{ text: `${keyOf(i.id)}  `, color: MUTED }, i.title, i.planned ? '' : { text: '  unplanned', color: AMBER, fontSize: 7 }] }, TYPE_LABEL[i.type], i.areas.map(area).join(', ') || '—', data.nameOf(i.assignee_id).split(' ')[0], dayLabel(i.completed_at),
    ]), ['*', 55, 80, 55, 40]));

  content.push(section('Team', 'Done this week, what each person has in progress now, and check-ins answered.'),
    table(['Person', 'Done', 'Points', 'Bugs fixed', 'Own ideas', 'In progress', 'Check-ins'], r.people.map((p) => [
      { text: p.name, bold: true }, String(p.done), String(p.points), String(p.bugsFixed), String(p.ownWork), { text: String(p.activeNow), color: p.activeNow ? INK : RED, bold: !p.activeNow },
      p.asked ? `${p.answered}/${p.asked}` : '—',
    ]), ['*', 35, 40, 50, 50, 55, 50], [1, 2, 3, 4, 5, 6]));

  content.push(section(`Releases (${r.releases})`),
    table(['Release', 'Status', 'Out', 'Ships'], r.releasesList.map((x) => [
      { text: `${releaseLabel(x)}${x.name ? ` — ${x.name}` : ''}`, bold: true }, RELEASE_STATUS[x.status].label, dayLabel(x.released_at), String(data.issues.filter((i) => i.release_id === x.id).length) + ' issues',
    ]), ['*', 60, 50, 60]));

  content.push(section(`Decisions (${r.decisions})`),
    r.decisionsList.length ? { stack: r.decisionsList.map((d) => ({ stack: [{ text: `D${d.number} · ${d.title}`, bold: true, fontSize: 8.5, color: NAVY }, ...(d.decision ? [{ text: d.decision, fontSize: 8, margin: [0, 1, 0, 0] }] : []), { text: `${data.nameOf(d.decided_by)} · ${dayLabel(d.decided_at)}`, fontSize: 7, color: MUTED }], margin: [0, 0, 0, 6] })) } : { text: 'None this week.', fontSize: 8, color: MUTED, italics: true });

  const att = r.attention;
  content.push(section('Needs attention', 'Open now.'),
    table(['Issue', 'Why', 'Who'], [
      ...att.urgent.map((i) => [{ text: [{ text: `${keyOf(i.id)}  `, color: MUTED }, i.title] }, { text: i.priority.toUpperCase(), color: i.priority === 'p0' ? RED : AMBER, bold: true }, data.nameOf(i.assignee_id)]),
      ...att.blocked.filter((i) => !att.urgent.includes(i)).map((i) => [{ text: [{ text: `${keyOf(i.id)}  `, color: MUTED }, i.title] }, { text: `Blocked${i.blocked_reason ? `: ${i.blocked_reason}` : ''}`, color: RED }, data.nameOf(i.assignee_id)]),
      ...att.stale.filter((i) => !att.urgent.includes(i) && !att.blocked.includes(i)).map((i) => [{ text: [{ text: `${keyOf(i.id)}  `, color: MUTED }, i.title] }, 'No update for 3+ days', data.nameOf(i.assignee_id)]),
    ], ['*', 120, 80]));

  const nw = r.nextWeek;
  content.push(section('Next week'), {
    ul: [
      ...nw.milestones.map((m) => `M${m.number} · ${m.name} ends ${dayLabel(m.end_date)}`),
      ...nw.releases.map((x) => `${releaseLabel(x)} planned for ${dayLabel(x.planned_date)} (${PLATFORM_LABEL[x.platform]})`),
      `${nw.ready} issue${nw.ready === 1 ? '' : 's'} ready to pick up`,
      ...r.projects.waiting.map((i) => `I${i.number} · ${i.name} waiting for the MD's approval`),
    ],
    fontSize: 8.5, lineHeight: 1.3,
  });

  const doc = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    info: { title: `IT weekly review — ${weekLabel(r.week)}`, author: 'Kivu Ride', subject: 'IT & Product weekly review' },
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: INK },
    footer: (page: number, pages: number): Content => ({
      margin: [40, 10, 40, 0],
      columns: [{ text: `Kivu Ride · IT & Product weekly review · ${weekLabel(r.week)}`, fontSize: 7, color: MUTED }, { text: `Page ${page} of ${pages}`, fontSize: 7, color: MUTED, alignment: 'right', width: 70 }],
    }),
    content,
  };
  return new Promise((resolve) => pdfMake.createPdf(doc).getBlob((b: Blob) => resolve(b)));
}
