import { getLogoDataUrl, getPdfMake } from './newsletterPdf';
import { BusinessClient, BusinessInvoice, InvoiceSettings, InvoiceSnapshot, StatementRow, dayLabel } from './business';
import { kigaliDayOf, shortAddress } from './trips';

// Branded A4 invoice and statement PDFs (pdfmake, generated in the browser).
// Navy / teal / green from the Kivu Ride logo; quiet hairlines, one strong
// "amount due" figure, every trip on its own line.

const NAVY = '#17263A';
const TEAL = '#2F8C86';
const GREEN = '#4F7B3E';
const INK = '#1F2937';
const MUTED = '#6B7280';
const LINE = '#E3E7EC';
const ZEBRA = '#F6F8FA';

const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const timeK = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' });
const dayK = (iso: string) => dayLabel(kigaliDayOf(iso));
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Content = any;

const accentBar = (width: number): Content => ({
  canvas: [
    { type: 'rect', x: 0, y: 0, w: width * 0.18, h: 3, color: GREEN },
    { type: 'rect', x: width * 0.18, y: 0, w: width * 0.32, h: 3, color: TEAL },
    { type: 'rect', x: width * 0.5, y: 0, w: width * 0.5, h: 3, color: NAVY },
  ],
  margin: [0, 10, 0, 16],
});

const label = (t: string): Content => ({ text: t.toUpperCase(), fontSize: 7, bold: true, color: TEAL, characterSpacing: 1.2, margin: [0, 0, 0, 4] });
const party = (title: string, lines: (string | null | undefined)[], strong: string): Content => ({
  stack: [label(title), { text: strong, bold: true, fontSize: 10.5, color: NAVY, margin: [0, 0, 0, 2] }, ...lines.filter(Boolean).map((l) => ({ text: l, fontSize: 8.5, color: INK, lineHeight: 1.25 }))],
});
const kv = (k: string, v: string, strong = false): Content => [{ text: k, fontSize: 8.5, color: MUTED }, { text: v, fontSize: 8.5, color: strong ? NAVY : INK, bold: strong, alignment: 'right' }];
const hairline = { hLineWidth: () => 0.6, vLineWidth: () => 0, hLineColor: () => LINE, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 3, paddingBottom: () => 3 };

function footer(issuer: InvoiceSettings) {
  return (page: number, pages: number): Content => ({
    margin: [40, 10, 40, 0],
    stack: [
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: LINE }] },
      {
        columns: [
          { text: [issuer.legal_name, issuer.tin ? `  ·  TIN ${issuer.tin}` : '', issuer.address ? `  ·  ${issuer.address}` : ''].join(''), fontSize: 7, color: MUTED },
          { text: `Page ${page} of ${pages}`, fontSize: 7, color: MUTED, alignment: 'right', width: 70 },
        ],
        margin: [0, 6, 0, 0],
      },
    ],
  });
}

async function header(title: string, rightLines: Content[]): Promise<Content> {
  const logo = await getLogoDataUrl();
  return {
    columns: [
      { width: '*', stack: [logo ? { image: logo, width: 64 } : { text: 'KIVU RIDE', bold: true, fontSize: 18, color: NAVY }, { text: 'Beyond Transport. Into the Future.', fontSize: 7.5, color: MUTED, italics: true, margin: [0, 4, 0, 0] }] },
      { width: 'auto', stack: [{ text: title, fontSize: 24, bold: true, color: NAVY, characterSpacing: 3, alignment: 'right' }, ...rightLines] },
    ],
  };
}

// ------------------------------------------------------------ shared by the invoice and the report
type Line = InvoiceSnapshot['lines'][number];
function daysOf(lines: Line[]) {
  // Trips per day (a weekly invoice reads best day by day).
  const days = new Map<string, { trips: number; km: number; amount: number }>();
  for (const l of lines) {
    const d = kigaliDayOf(l.date);
    const g = days.get(d) ?? { trips: 0, km: 0, amount: 0 };
    g.trips += 1; g.km += Number(l.km ?? 0); g.amount += Number(l.fare ?? 0);
    days.set(d, g);
  }
  return { days, dayRows: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
}
function daysBlock(dayRows: [string, { trips: number; km: number; amount: number }][]): Content[] {
  return [
    ...(dayRows.length > 1 ? [
        { ...label('Trips per day'), margin: [0, 12, 0, 4] },
        {
          table: {
            widths: ['*', 50, 60, 90],
            body: [
              ['Day', 'Trips', 'Km', 'Amount'].map((h, i) => ({ text: h, fontSize: 7.5, bold: true, color: MUTED, alignment: i ? 'right' : 'left' })),
              ...dayRows.map(([d, g]) => [{ text: weekday(d), fontSize: 8 }, { text: String(g.trips), fontSize: 8, alignment: 'right' }, { text: g.km.toFixed(1), fontSize: 8, alignment: 'right' }, { text: num(g.amount), fontSize: 8, alignment: 'right' }]),
            ],
          },
          layout: hairline,
        },
      ] : []),
  ];
}
// notes: a short mark under a trip's number (e.g. "to verify").
function tripsBlock(lines: Line[], notes?: Map<number, string>): Content[] {
  const tripBody: Content[] = [[
    ...['#', 'Date & time', 'Rider', 'Route', 'Driver · car', 'Km', 'Wait', 'Fare'].map((h, i) => ({ text: h, bold: true, fontSize: 7.5, color: '#FFFFFF', fillColor: NAVY, alignment: i >= 5 ? 'right' : 'left', margin: [2, 3, 2, 3] })),
  ]];
  lines.forEach((l, i) => {
    const note = notes?.get(l.trip_id);
    const fill = i % 2 ? ZEBRA : null;
    const extras = Number(l.extras ?? 0), wait = Number(l.waiting_fee ?? 0);
    tripBody.push([
      { text: String(i + 1), fontSize: 7.5, color: MUTED, fillColor: fill },
      { stack: [{ text: dayK(l.date), fontSize: 7.5, bold: true, color: INK }, { text: `${timeK(l.date)}${l.completed_at ? `–${timeK(l.completed_at)}` : ''}`, fontSize: 7, color: MUTED }], fillColor: fill },
      { stack: [{ text: l.rider ?? '—', fontSize: 7.5, color: INK }, { text: `Trip #${l.trip_id}${note ? ` · ${note}` : ''}`, fontSize: 6.5, color: note ? '#B7791F' : MUTED }], fillColor: fill },
      { stack: [{ text: [{ text: 'From  ', color: GREEN, bold: true }, shortAddress(l.from)], fontSize: 7.5, color: INK }, { text: [{ text: 'To  ', color: '#B42318', bold: true }, shortAddress(l.to)], fontSize: 7.5, color: INK, margin: [0, 1, 0, 0] }], fillColor: fill },
      { stack: [{ text: l.driver ?? '—', fontSize: 7.5, color: INK }, { text: [l.plate, l.vehicle_type].filter(Boolean).join(' · '), fontSize: 6.5, color: MUTED }], fillColor: fill },
      { text: l.km !== null ? Number(l.km).toFixed(1) : '—', fontSize: 7.5, alignment: 'right', fillColor: fill },
      { text: Number(l.waiting_minutes) >= 0.5 ? `${Math.round(Number(l.waiting_minutes))} min` : '—', fontSize: 7.5, alignment: 'right', color: Number(l.waiting_minutes) >= 0.5 ? INK : MUTED, fillColor: fill },
      { stack: [{ text: num(Number(l.fare ?? 0)), fontSize: 7.5, bold: true, color: INK, alignment: 'right' }, ...(extras || wait ? [{ text: `incl. ${[wait ? `${num(wait)} wait` : '', extras ? `${num(extras)} extras` : ''].filter(Boolean).join(', ')}`, fontSize: 6, color: MUTED, alignment: 'right' }] : [])], fillColor: fill },
    ]);
  });

  return [
      { ...label('Trip details'), margin: [0, 16, 0, 4] },
      {
        table: { headerRows: 1, dontBreakRows: true, widths: [12, 50, 66, '*', 80, 26, 30, 50], body: tripBody },
        layout: { hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0 : 0.4), vLineWidth: () => 0, hLineColor: () => LINE, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 3.5, paddingBottom: () => 3.5 },
      },
  ];
}
function payLinesOf(issuer: InvoiceSettings): Content[] {
  const payLines: Content[] = [];
  if (issuer.bank_name || issuer.bank_account_number) payLines.push(kv('Bank', issuer.bank_name ?? '—'), kv('Account name', issuer.bank_account_name ?? issuer.legal_name), kv('Account number', issuer.bank_account_number ?? '—', true));
  if (issuer.momo_number) payLines.push(kv('Mobile Money', `${issuer.momo_number}${issuer.momo_name ? ` (${issuer.momo_name})` : ''}`, true));
  return payLines;
}

export async function invoicePdfBlob(inv: BusinessInvoice, snap: InvoiceSnapshot): Promise<Blob> {
  const pdfMake = await getPdfMake();
  const { issuer, client, lines } = snap;
  const W = 515;
  const due = Math.max(0, Number(inv.total) - Number(inv.amount_paid));
  const statusText = inv.status === 'void' ? 'CANCELLED' : inv.status === 'paid' ? 'PAID' : inv.status === 'part_paid' ? 'PART PAID' : 'DUE';
  const statusColor = inv.status === 'void' ? MUTED : inv.status === 'paid' ? GREEN : inv.status === 'part_paid' ? '#B7791F' : TEAL;

  const { days, dayRows } = daysOf(lines);

  const totalsRows: Content[] = [
    kv('Subtotal (trip fares)', rwf(Number(inv.subtotal))),
    kv(`VAT ${Math.round(Number(inv.vat_rate) * 100)}%`, rwf(Number(inv.vat_amount))),
  ];
  if (Number(inv.amount_paid) > 0) totalsRows.push(kv('Total', rwf(Number(inv.total))), kv('Paid', `− ${rwf(Number(inv.amount_paid))}`));

  const payLines = payLinesOf(issuer);
  payLines.push(kv('Payment reference', inv.number, true), kv('Due by', dayLabel(inv.due_date, true), true));

  const doc = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    info: { title: `${inv.number} — ${client.legal_name || client.name}`, author: issuer.legal_name, subject: 'Invoice' },
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: INK },
    footer: footer(issuer),
    content: [
      await header('INVOICE', [
        { text: inv.number, fontSize: 10, bold: true, color: TEAL, alignment: 'right', margin: [0, 2, 0, 0] },
        { text: statusText, fontSize: 7.5, bold: true, color: statusColor, alignment: 'right', characterSpacing: 1.5, margin: [0, 3, 0, 0] },
      ]),
      accentBar(W),
      {
        columns: [
          party('Billed to', [client.legal_name && client.legal_name !== client.name ? client.name : null, client.tin ? `TIN ${client.tin}` : null, client.address, client.contact_name ? `Attn: ${client.contact_name}` : null, client.billing_emails?.join(', '), client.contact_phone], client.legal_name || client.name),
          party('From', [issuer.tin ? `TIN ${issuer.tin}` : null, issuer.address, issuer.phone, issuer.email, issuer.website], issuer.legal_name),
          {
            width: 150,
            stack: [label('Invoice'), { table: { widths: ['*', 'auto'], body: [kv('Issued', dayLabel(inv.issue_date, true)), kv('Due', dayLabel(inv.due_date, true), true), kv('Period', `${dayLabel(inv.period_from)} – ${dayLabel(inv.period_to, true)}`)] }, layout: hairline }],
          },
        ],
        columnGap: 18,
      },
      {
        margin: [0, 18, 0, 6],
        table: {
          widths: ['*', '*', '*', 150],
          body: [[
            { stack: [label('Trips'), { text: String(inv.trip_count), fontSize: 16, bold: true, color: NAVY }] },
            { stack: [label('Distance'), { text: `${Number(inv.distance_km).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`, fontSize: 16, bold: true, color: NAVY }] },
            { stack: [label('Days'), { text: String(days.size), fontSize: 16, bold: true, color: NAVY }] },
            { stack: [label(inv.status === 'paid' ? 'Paid in full' : 'Amount due'), { text: rwf(inv.status === 'void' ? 0 : due), fontSize: 16, bold: true, color: inv.status === 'paid' ? GREEN : TEAL }, { text: 'VAT included', fontSize: 7, color: MUTED }], fillColor: '#F0F7F6' },
          ]],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 9, paddingBottom: () => 9, fillColor: () => ZEBRA },
      },
      ...daysBlock(dayRows),
      ...tripsBlock(lines),
      {
        margin: [0, 14, 0, 0],
        columns: [
          {
            width: '*',
            stack: [
              label('How to pay'),
              { table: { widths: [95, '*'], body: payLines }, layout: hairline },
              ...(issuer.bank_account_number || issuer.momo_number ? [] : [{ text: `Payment details: ${issuer.email ?? 'administration@kivuride.com'}`, fontSize: 8, color: MUTED, margin: [0, 4, 0, 0] }]),
            ],
          },
          {
            width: 200,
            stack: [
              { table: { widths: ['*', 'auto'], body: totalsRows }, layout: hairline },
              {
                margin: [0, 6, 0, 0],
                table: { widths: ['*', 'auto'], body: [[{ text: inv.status === 'paid' ? 'Paid in full' : 'Amount due', bold: true, color: '#FFFFFF', fontSize: 10 }, { text: rwf(inv.status === 'void' ? 0 : due), bold: true, color: '#FFFFFF', fontSize: 12, alignment: 'right' }]] },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => (inv.status === 'paid' ? GREEN : NAVY), paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8 },
              },
            ],
          },
        ],
        columnGap: 24,
      },
      ...(inv.notes ? [{ ...label('Notes'), margin: [0, 16, 0, 4] }, { text: inv.notes, fontSize: 8.5 }] : []),
      ...(inv.status === 'void' ? [{ text: `This invoice was cancelled${inv.void_reason ? `: ${inv.void_reason}` : ''}.`, color: '#B42318', bold: true, margin: [0, 16, 0, 0] }] : []),
      { text: `${issuer.footer_note ?? 'Thank you for riding with Kivu Ride.'}  Fares are the amounts calculated by the Kivu Ride app for each trip (distance, time, waiting and extras).`, fontSize: 7.5, color: MUTED, margin: [0, 20, 0, 0] },
    ],
  };
  return new Promise((resolve) => pdfMake.createPdf(doc).getBlob((b: Blob) => resolve(b)));
}

// ------------------------------------------------------------ the report (a pre-invoice)
// The invoice's twin for the trips so far in a period: same layout and
// trip lines, no VAT, no invoice number - "what we have so far".
export interface ReportInput {
  client: BusinessClient; issuer: InvoiceSettings; lines: Line[];
  from: string; to: string;               // ISO date-times of the period
  preparedBy: string | null; notes: string | null;
  marks?: Map<number, string>;             // e.g. trip waiting for verification
  leftOutPaid?: number;                    // trips in the period already paid, not listed
}
const dateTimeK = (iso: string) => `${dayLabel(kigaliDayOf(iso), true)}, ${timeK(iso)}`;

export async function reportPdfBlob(r: ReportInput): Promise<Blob> {
  const pdfMake = await getPdfMake();
  const { issuer, client, lines } = r;
  const W = 515;
  const { days, dayRows } = daysOf(lines);
  const subtotal = lines.reduce((s, l) => s + Number(l.fare ?? 0), 0);
  const km = lines.reduce((s, l) => s + Number(l.km ?? 0), 0);
  const now = new Date().toISOString();
  const doc = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    info: { title: `Report — ${client.legal_name || client.name} — ${kigaliDayOf(r.from)} to ${kigaliDayOf(r.to)}`, author: issuer.legal_name, subject: 'Trip report' },
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: INK },
    footer: footer(issuer),
    content: [
      await header('REPORT', [
        { text: 'Trips so far', fontSize: 10, bold: true, color: TEAL, alignment: 'right', margin: [0, 2, 0, 0] },
        { text: 'BEFORE VAT', fontSize: 7.5, bold: true, color: MUTED, alignment: 'right', characterSpacing: 1.5, margin: [0, 3, 0, 0] },
      ]),
      accentBar(W),
      {
        columns: [
          party('Prepared for', [client.legal_name && client.legal_name !== client.name ? client.name : null, client.tin ? `TIN ${client.tin}` : null, client.address, client.contact_name ? `Attn: ${client.contact_name}` : null, client.billing_emails?.join(', '), client.contact_phone], client.legal_name || client.name),
          party('From', [issuer.tin ? `TIN ${issuer.tin}` : null, issuer.address, issuer.phone, issuer.email, issuer.website], issuer.legal_name),
          {
            width: 150,
            stack: [label('Report'), { table: { widths: ['*', 'auto'], body: [
              kv('Prepared', dateTimeK(now)),
              kv('From', dateTimeK(r.from), true),
              kv('To', dateTimeK(r.to), true),
              ...(r.preparedBy ? [kv('By', r.preparedBy)] : []),
            ] }, layout: hairline }],
          },
        ],
        columnGap: 18,
      },
      {
        margin: [0, 18, 0, 6],
        table: {
          widths: ['*', '*', '*', 150],
          body: [[
            { stack: [label('Trips'), { text: String(lines.length), fontSize: 16, bold: true, color: NAVY }] },
            { stack: [label('Distance'), { text: `${km.toLocaleString('en-US', { maximumFractionDigits: 1 })} km`, fontSize: 16, bold: true, color: NAVY }] },
            { stack: [label('Days'), { text: String(days.size), fontSize: 16, bold: true, color: NAVY }] },
            { stack: [label('Total so far'), { text: rwf(subtotal), fontSize: 16, bold: true, color: TEAL }, { text: 'Before VAT', fontSize: 7, color: MUTED }], fillColor: '#F0F7F6' },
          ]],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 9, paddingBottom: () => 9, fillColor: () => ZEBRA },
      },
      ...daysBlock(dayRows),
      ...(lines.length ? tripsBlock(lines, r.marks) : [{ text: 'No trips in this period yet.', color: MUTED, margin: [0, 16, 0, 0] }]),
      {
        margin: [0, 14, 0, 0],
        columns: [
          {
            width: '*',
            stack: payLinesOf(issuer).length ? [label('How to pay'), { table: { widths: [95, '*'], body: payLinesOf(issuer) }, layout: hairline }] : [{ text: '' }],
          },
          {
            width: 200,
            stack: [
              { table: { widths: ['*', 'auto'], body: [kv('Subtotal (trip fares)', rwf(subtotal)), ...(r.leftOutPaid ? [kv(`Already paid (${r.leftOutPaid} trip${r.leftOutPaid === 1 ? '' : 's'})`, 'not listed')] : [])] }, layout: hairline },
              {
                margin: [0, 6, 0, 0],
                table: { widths: ['*', 'auto'], body: [[{ text: 'Total so far', bold: true, color: '#FFFFFF', fontSize: 10 }, { text: rwf(subtotal), bold: true, color: '#FFFFFF', fontSize: 12, alignment: 'right' }]] },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => NAVY, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8 },
              },
            ],
          },
        ],
        columnGap: 24,
      },
      ...(r.notes ? [{ ...label('Notes'), margin: [0, 16, 0, 4] }, { text: r.notes, fontSize: 8.5 }] : []),
      { text: `This report lists the trips so far for the period above. It is not an invoice: VAT is added on the invoice.${r.marks?.size ? ' Trips marked "to verify" are still being checked by Kivu Ride.' : ''}  Fares are the amounts calculated by the Kivu Ride app for each trip (distance, time, waiting and extras).`, fontSize: 7.5, color: MUTED, margin: [0, 20, 0, 0] },
    ],
  };
  return new Promise((resolve) => pdfMake.createPdf(doc).getBlob((b: Blob) => resolve(b)));
}

export async function statementPdfBlob(client: BusinessClient, issuer: InvoiceSettings, rows: StatementRow[], unbilled: { trips: number; amount: number }): Promise<Blob> {
  const pdfMake = await getPdfMake();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
  const balance = rows.length ? rows[rows.length - 1].balance : 0;
  const doc = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    info: { title: `Statement — ${client.legal_name || client.name}`, author: issuer.legal_name },
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: INK },
    footer: footer(issuer),
    content: [
      await header('STATEMENT', [{ text: `As of ${dayLabel(today, true)}`, fontSize: 9, color: TEAL, bold: true, alignment: 'right', margin: [0, 2, 0, 0] }]),
      accentBar(515),
      {
        columns: [
          party('Account', [client.tin ? `TIN ${client.tin}` : null, client.address, client.contact_name ? `Attn: ${client.contact_name}` : null, client.billing_emails?.join(', ')], client.legal_name || client.name),
          party('From', [issuer.tin ? `TIN ${issuer.tin}` : null, issuer.address, issuer.email], issuer.legal_name),
          { width: 160, stack: [label('Balance'), { text: rwf(balance), fontSize: 18, bold: true, color: balance > 0 ? TEAL : GREEN }, { text: unbilled.trips ? `+ ${unbilled.trips} trips not yet invoiced (${rwf(unbilled.amount)} before VAT)` : 'No trips waiting to be invoiced', fontSize: 7.5, color: MUTED, margin: [0, 3, 0, 0] }] },
        ],
        columnGap: 18,
      },
      { ...label('Invoices and payments'), margin: [0, 18, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: [58, 78, '*', 70, 70, 74],
          body: [
            ['Date', 'Reference', 'Details', 'Charges', 'Payments', 'Balance'].map((h, i) => ({ text: h, bold: true, fontSize: 7.5, color: '#FFFFFF', fillColor: NAVY, alignment: i >= 3 ? 'right' : 'left' })),
            ...rows.map((r, i) => {
              const fill = i % 2 ? ZEBRA : null;
              return [
                { text: dayLabel(r.date, true), fillColor: fill }, { text: r.ref, fillColor: fill, bold: r.kind === 'invoice' }, { text: r.detail, fillColor: fill, color: r.kind === 'void' ? MUTED : INK },
                { text: r.debit ? num(r.debit) : '', alignment: 'right', fillColor: fill }, { text: r.credit ? num(r.credit) : '', alignment: 'right', fillColor: fill, color: GREEN },
                { text: num(r.balance), alignment: 'right', bold: true, fillColor: fill },
              ];
            }),
            ...(rows.length ? [] : [[{ text: 'No invoices yet.', colSpan: 6, color: MUTED }, {}, {}, {}, {}, {}]]),
          ],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4 },
      },
      {
        margin: [0, 10, 0, 0],
        columns: [{ text: '' }, {
          width: 220,
          table: { widths: ['*', 'auto'], body: [[{ text: 'Balance due', bold: true, color: '#FFFFFF' }, { text: rwf(balance), bold: true, color: '#FFFFFF', alignment: 'right' }]] },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => NAVY, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 7, paddingBottom: () => 7 },
        }],
      },
    ],
  };
  return new Promise((resolve) => pdfMake.createPdf(doc).getBlob((b: Blob) => resolve(b)));
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
