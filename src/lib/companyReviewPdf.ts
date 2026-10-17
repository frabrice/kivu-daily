import { getLogoDataUrl, getPdfMake } from './newsletterPdf';
import { MonthFacts, MonthSnapshot, MonthlyReview, CompanyDecision, SPENT_LABEL, monthTitle } from './companyReview';

// The monthly partners' review as an A4 PDF (pdfmake, in the browser).

const NAVY = '#17263A';
const TEAL = '#2F8C86';
const GREEN = '#4F7B3E';
const RED = '#B42318';
const INK = '#1F2937';
const MUTED = '#6B7280';
const LINE = '#E3E7EC';
const ZEBRA = '#F6F8FA';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Content = any;

const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const section = (t: string, sub?: string): Content => ({ stack: [{ text: t.toUpperCase(), fontSize: 8, bold: true, color: TEAL, characterSpacing: 1.2 }, ...(sub ? [{ text: sub, fontSize: 7.5, color: MUTED, margin: [0, 1, 0, 0] }] : [])], margin: [0, 14, 0, 5] });
const hairline = { hLineWidth: (i: number) => (i === 0 ? 0 : 0.6), vLineWidth: () => 0, hLineColor: () => LINE, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 3, paddingBottom: () => 3 };
function table(head: string[], rows: Content[][], widths: (string | number)[], right: number[] = []): Content {
  if (!rows.length) return { text: 'Nothing this month.', fontSize: 8, color: MUTED, italics: true };
  return {
    table: { headerRows: 1, widths, body: [head.map((h, i) => ({ text: h, bold: true, fontSize: 7.5, color: '#FFFFFF', fillColor: NAVY, alignment: right.includes(i) ? 'right' : 'left' })),
      ...rows.map((r, n) => r.map((c, i) => ({ ...(typeof c === 'object' ? c : { text: String(c) }), fontSize: 8, fillColor: n % 2 ? ZEBRA : null, alignment: right.includes(i) ? 'right' : 'left' })))] },
    layout: hairline,
  };
}
const tile = (label: string, value: string, sub: string, color = NAVY): Content => ({ stack: [{ text: label.toUpperCase(), fontSize: 6.5, color: MUTED, bold: true, characterSpacing: 0.8 }, { text: value, fontSize: 16, bold: true, color, margin: [0, 2, 0, 1] }, { text: sub, fontSize: 7, color: MUTED }] });
const notes = (title: string, text: string | null | undefined): Content[] => (text?.trim() ? [{ text: title, bold: true, fontSize: 8.5, color: NAVY, margin: [0, 6, 0, 2] }, { text: text.trim(), fontSize: 8.5, lineHeight: 1.3 }] : []);
const delta = (now: number, before: number) => (before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}% vs last month` : '');

export interface ReviewPdfInput {
  month: string; s: MonthSnapshot; prev: MonthSnapshot | null; facts: MonthFacts; review: MonthlyReview | null; nameOf: (id: string | null) => string;
  objectives: { title: string; pct: number; status: string }[]; priorities: { label: string; score: number | null }[];
  stages: { name: string; status: string; gates: string; target: string }[]; budgets: { name: string; status: string; approved: number | null; spent: number }[];
  funding: { name: string; status: string; amount: number | null }[]; decisions: CompanyDecision[]; cash: { own: number; asOf: string | null } | null;
}

export async function companyReviewPdfBlob(x: ReviewPdfInput): Promise<Blob> {
  const pdfMake = await getPdfMake();
  const logo = await getLogoDataUrl();
  const { s, prev, facts, review } = x;
  const held = review?.held_at ? `Reviewed ${new Date(review.held_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${review.attendees.map((a) => x.nameOf(a).split(' ')[0]).join(', ') || '—'}` : 'Not reviewed yet';
  const content: Content[] = [
    { columns: [
      { width: '*', stack: [logo ? { image: logo, width: 60 } : { text: 'KIVU RIDE', bold: true, fontSize: 16, color: NAVY }] },
      { width: 'auto', stack: [{ text: 'MONTHLY REVIEW', fontSize: 20, bold: true, color: NAVY, characterSpacing: 2.5, alignment: 'right' }, { text: `${monthTitle(x.month)} · Confidential — partners`, fontSize: 9, color: INK, alignment: 'right', margin: [0, 2, 0, 0] }, { text: held, fontSize: 7.5, color: MUTED, alignment: 'right', margin: [0, 2, 0, 0] }] },
    ] },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 93, h: 3, color: GREEN }, { type: 'rect', x: 93, y: 0, w: 165, h: 3, color: TEAL }, { type: 'rect', x: 258, y: 0, w: 257, h: 3, color: NAVY }], margin: [0, 10, 0, 14] },
    { columns: [
      tile('Completed trips / day', String(s.perDay), prev ? delta(s.perDay, prev.perDay) : `${s.completed} trips`, GREEN),
      tile('Requests completed', s.completionPct === null ? '—' : `${s.completionPct}%`, `${s.noDriverPct ?? 0}% found no driver`, (s.completionPct ?? 0) < 70 ? RED : NAVY),
      tile('Own income', rwf(s.ownRecurring), prev ? delta(s.ownRecurring, prev.ownRecurring) : 'margins, fees, commission'),
      tile('Cash (own)', x.cash ? rwf(x.cash.own) : '—', x.cash?.asOf ? `as of ${x.cash.asOf}` : 'not recorded'),
    ], columnGap: 10 },
  ];
  if (review && (review.highlights || review.problems || review.next_focus || review.notes)) {
    content.push(section('Meeting notes'), ...notes('Highlights', review.highlights), ...notes('Problems & risks', review.problems), ...notes('Focus for next month', review.next_focus), ...notes('Other notes', review.notes));
  }
  const by = facts.own_income_by_type ?? {};
  content.push(section('Money', 'Kivu Ride\'s own income, and what went out in the ledger this month.'), { columns: [
    { width: '*', stack: [table(['Income', 'Amount'], [
      ['Managed cars — our margin', rwf(Number(by.management_margin ?? 0))], ['Management fees & other revenue', rwf(Number(by.revenue ?? 0))],
      ['App commission (estimate)', rwf(s.commission)], ['Onboarding fees (one-off)', rwf(Number(by.onboarding_fee ?? 0))], [{ text: 'Total', bold: true }, { text: rwf(s.ownIncome), bold: true }],
    ], ['*', 80], [1])] },
    { width: '*', stack: [table(['Out (ledger)', 'Amount'], [...Object.entries(facts.spent_by_type ?? {}).map(([k, v]) => [SPENT_LABEL[k] ?? k.replace(/_/g, ' '), rwf(Number(v))]), [{ text: 'From approved budgets', italics: true }, rwf(s.budgetSpent)]], ['*', 80], [1])] },
  ], columnGap: 12 });
  content.push(section('Objectives'), table(['Objective', 'Status', 'Progress'], x.objectives.map((o) => [o.title, o.status, `${o.pct}%`]), ['*', 70, 50], [2]));
  content.push(section('Now — the priorities'), table(['Priority', 'Score'], x.priorities.map((p) => [p.label, p.score === null ? '—' : String(p.score)]), ['*', 40], [1]));
  content.push(section('Expansion'), table(['Stage', 'Status', 'Gates met', 'By'], x.stages.map((st) => [st.name, st.status, st.gates, st.target]), ['*', 60, 55, 60]));
  content.push(section('Budgets'), table(['Budget', 'Status', 'Approved', 'Spent'], x.budgets.map((b) => [b.name, b.status, b.approved === null ? '—' : rwf(b.approved), rwf(b.spent)]), ['*', 80, 80, 70], [2, 3]));
  content.push(section('Funding'), table(['Source', 'Status', 'Amount'], x.funding.map((f) => [f.name, f.status, f.amount ? rwf(f.amount) : '—']), ['*', 70, 90], [2]));
  content.push(section('IT & product'), { ul: [
    `${facts.it.issues_done} issues done (${facts.it.bugs_fixed} bugs fixed)`,
    ...(facts.it.releases.length ? [`Released: ${facts.it.releases.map((r) => r.name).join(', ')}`] : ['No release this month']),
    ...facts.it.milestones_completed.map((m) => `Completed: ${m}`),
    ...facts.it.milestones_active.map((m) => `${m.name}: ${m.done}/${m.total} done, ends ${m.end}`),
  ], fontSize: 8.5, lineHeight: 1.3 });
  content.push(section(`Decisions (${x.decisions.length})`), x.decisions.length ? { stack: x.decisions.map((d) => ({ stack: [{ text: `D${d.number} · ${d.title}`, bold: true, fontSize: 8.5, color: NAVY }, ...(d.decision ? [{ text: d.decision, fontSize: 8, margin: [0, 1, 0, 0] }] : []), { text: `${x.nameOf(d.decided_by)} · ${d.decided_at ?? ''}`, fontSize: 7, color: MUTED }], margin: [0, 0, 0, 6] })) } : { text: 'None this month.', fontSize: 8, color: MUTED, italics: true });
  const doc = {
    pageSize: 'A4', pageMargins: [40, 40, 40, 50],
    info: { title: `Kivu Ride monthly review — ${monthTitle(x.month)}`, author: 'Kivu Ride', subject: 'Monthly partners review' },
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: INK },
    footer: (page: number, pages: number): Content => ({ margin: [40, 10, 40, 0], columns: [{ text: `Kivu Ride · Monthly review · ${monthTitle(x.month)} · Confidential`, fontSize: 7, color: MUTED }, { text: `Page ${page} of ${pages}`, fontSize: 7, color: MUTED, alignment: 'right', width: 70 }] }),
    content,
  };
  return new Promise((resolve) => pdfMake.createPdf(doc).getBlob((b: Blob) => resolve(b)));
}
