import { supabase, ChargingStation } from './supabase';
import { getLogoDataUrl, getPdfMake } from './newsletterPdf';
import { GUN_TYPE_LABEL } from './chargingStations';
import { KWH_SCENARIOS, sensitivity, StationAnalysis, StationMetrics } from './stationAnalysis';

// Two downloadable PDFs for the charging-station survey:
// - Data collected: everything the field team recorded, station by station.
// - Analysis report: the numbers, charts, findings, economics, data quality,
//   implications for Kivu Ride and the method behind it.
// Charts are drawn as SVG so they stay sharp in print.

export const NAVY = '#17263A';
export const TEAL = '#2F8C86';
export const INK = '#1f2937';
export const MUTED = '#6b7280';
const LINE = '#e5e7eb';
export const SOFT = '#f8fafc';
export const BLUE = '#2a78d6';
export const ORANGE = '#eb6834';
export const AQUA = '#1baf7a';
export const GREY = '#a3a3a3';
export const RED = '#b91c1c';

const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (x: number) => `${Math.round(x * 100)}%`;
const mrwf = (n: number) => `${(n / 1_000_000).toFixed(1)}M`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dateLabel = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// ------------------------------------------------------------------ SVG charts
const FONT = 'Roboto';

function svgText(x: number, y: number, t: string, o: { size?: number; fill?: string; anchor?: string; weight?: string } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${o.size ?? 8}" fill="${o.fill ?? MUTED}" text-anchor="${o.anchor ?? 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(t)}</text>`;
}

// Horizontal bars; each row has one or more stacked parts, or grouped bars.
export function hBars(rows: { label: string; parts: { v: number; color: string }[]; end?: string }[], o: { width?: number; labelW?: number; right?: number; max?: number; grouped?: boolean; refX?: { v: number; color: string }; band?: [number, number]; unit?: (v: number) => string } = {}) {
  const W = o.width ?? 515, LW = o.labelW ?? 150, R = o.right ?? 46, rowH = o.grouped ? 22 : 16, gap = 6, top = 6, axisH = 16;
  const plotW = W - LW - R;
  const rawMax = o.max ?? Math.max(1, ...rows.map((r) => (o.grouped ? Math.max(...r.parts.map((p) => p.v)) : r.parts.reduce((s, p) => s + p.v, 0))));
  // Round the axis up to a tidy step so ticks read 0, 30, 60... not 0, 29.5, 59.
  const rawStep = rawMax / 4, pow = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const max = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * pow >= rawStep - 1e-9) ?? 10) * pow * 4;
  const X = (v: number) => LW + (v / max) * plotW;
  const H = top + rows.length * (rowH + gap) + axisH;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  if (o.band) out += `<rect x="${X(o.band[0])}" y="${top - 2}" width="${X(o.band[1]) - X(o.band[0])}" height="${rows.length * (rowH + gap)}" fill="${AQUA}" fill-opacity="0.12"/>`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, x = X(v);
    out += `<line x1="${x}" y1="${top - 2}" x2="${x}" y2="${H - axisH}" stroke="${LINE}" stroke-width="0.5"/>`;
    out += svgText(x, H - 4, o.unit ? o.unit(v) : num(v), { anchor: 'middle', size: 7 });
  }
  rows.forEach((r, i) => {
    const y = top + i * (rowH + gap);
    out += svgText(LW - 6, y + rowH / 2 + 3, r.label, { anchor: 'end', size: 7.5, fill: INK });
    if (o.grouped) {
      const bh = (rowH - 2) / r.parts.length;
      r.parts.forEach((p, j) => { out += `<rect x="${LW}" y="${y + j * (bh + 2)}" width="${Math.max(0.5, X(p.v) - LW)}" height="${bh}" rx="2" fill="${p.color}"/>`; });
      out += svgText(X(Math.max(...r.parts.map((p) => p.v))) + 4, y + rowH / 2 + 3, r.end ?? '', { size: 7 });
    } else {
      let acc = 0;
      r.parts.forEach((p, j) => {
        const x0 = X(acc), x1 = X(acc + p.v);
        out += `<rect x="${x0}" y="${y}" width="${Math.max(0.5, x1 - x0 - (j < r.parts.length - 1 ? 1 : 0))}" height="${rowH}" rx="${j === r.parts.length - 1 ? 2 : 0}" fill="${p.color}"/>`;
        acc += p.v;
      });
      out += svgText(X(acc) + 4, y + rowH / 2 + 3, r.end ?? '', { size: 7 });
    }
  });
  if (o.refX) out += `<line x1="${X(o.refX.v)}" y1="${top - 4}" x2="${X(o.refX.v)}" y2="${H - axisH}" stroke="${o.refX.color}" stroke-width="1" stroke-dasharray="3,2"/>`;
  return out + '</svg>';
}

function lineChart(xs: number[], series: { name: string; color: string; values: number[] }[], o: { width?: number; height?: number; band?: [number, number]; yFmt?: (v: number) => string; xLabel?: string } = {}) {
  const W = o.width ?? 515, H = o.height ?? 190, L = 48, R = 12, T = 8, B = 26;
  const all = series.flatMap((s) => s.values);
  const ymin = Math.min(0, ...all), ymax = Math.max(...all) * 1.05;
  const X = (x: number) => L + ((x - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  if (o.band) out += `<rect x="${X(o.band[0])}" y="${T}" width="${X(o.band[1]) - X(o.band[0])}" height="${H - T - B}" fill="${AQUA}" fill-opacity="0.12"/>`;
  for (let i = 0; i <= 4; i++) {
    const v = ymin + ((ymax - ymin) / 4) * i, y = Y(v);
    out += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${LINE}" stroke-width="0.5"/>` + svgText(L - 4, y + 3, o.yFmt ? o.yFmt(v) : num(v), { anchor: 'end', size: 7 });
  }
  xs.forEach((x) => { out += svgText(X(x), H - B + 11, String(x), { anchor: 'middle', size: 7 }); });
  if (o.xLabel) out += svgText(W - R, H - 3, o.xLabel, { anchor: 'end', size: 7 });
  for (const s of series) {
    out += `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${s.values.map((v, i) => `${X(xs[i])},${Y(v)}`).join(' ')}"/>`;
  }
  return out + '</svg>';
}

function mapChart(points: { x: number; y: number; r: number; label: string }[], o: { width?: number; height?: number } = {}) {
  const W = o.width ?? 515, H = o.height ?? 260, P = 26;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 0.008, Math.max(...xs) + 0.008, Math.min(...ys) - 0.008, Math.max(...ys) + 0.008];
  // Keep the map's proportions (1° lon ≈ 1° lat this close to the equator).
  const scale = Math.min((W - 2 * P) / (x1 - x0), (H - 2 * P) / (y1 - y0));
  const ox = (W - (x1 - x0) * scale) / 2, oy = (H - (y1 - y0) * scale) / 2;
  const X = (x: number) => ox + (x - x0) * scale, Y = (y: number) => oy + (y1 - y) * scale;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="6" fill="${SOFT}"/>`;
  out += `<polygon points="${W - 16},10 ${W - 20},20 ${W - 12},20" fill="${INK}"/>` + svgText(W - 16, 30, 'N', { anchor: 'middle', size: 8, fill: INK, weight: 'bold' });
  const km = 0.018 * scale; // ~2 km at Kigali's latitude
  out += `<line x1="12" y1="${H - 12}" x2="${12 + km}" y2="${H - 12}" stroke="${INK}" stroke-width="1"/>` + svgText(12 + km + 4, H - 9, '≈ 2 km', { size: 7 });
  for (const p of points) {
    out += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r}" fill="${BLUE}" fill-opacity="0.75" stroke="#ffffff" stroke-width="1.5"/>`;
    out += svgText(X(p.x), Y(p.y) - p.r - 3, p.label, { anchor: 'middle', size: 7, fill: INK });
  }
  return out + '</svg>';
}

export function legend(items: { label: string; color: string }[]) {
  return { columns: items.map((i) => ({ width: 'auto', columns: [{ canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, r: 1, color: i.color }], width: 12 }, { text: i.label, fontSize: 8, color: MUTED, margin: [0, 1, 12, 0] }] })), margin: [0, 2, 0, 6] };
}

// ------------------------------------------------------------------ layout pieces
export function kpiRow(items: { label: string; value: string; sub?: string; color?: string }[]) {
  return {
    table: {
      widths: items.map(() => '*'),
      body: [items.map((i) => ({
        stack: [
          { text: i.label.toUpperCase(), fontSize: 6.5, bold: true, color: MUTED, characterSpacing: 0.4 },
          { text: i.value, fontSize: 14, bold: true, color: i.color ?? NAVY, margin: [0, 3, 0, 0] },
          ...(i.sub ? [{ text: i.sub, fontSize: 7, color: MUTED, margin: [0, 1, 0, 0] }] : []),
        ],
        fillColor: SOFT, margin: [6, 6, 6, 6],
      }))],
    },
    layout: { hLineWidth: () => 0, vLineWidth: (i: number, node: { table: { widths: unknown[] } }) => (i === 0 || i === node.table.widths.length ? 0 : 4), vLineColor: () => '#ffffff' },
    margin: [0, 4, 0, 8],
  };
}

export function h1(text: string, n?: string) {
  return { stack: [{ text: n ? `${n}  ${text}` : text, fontSize: 15, bold: true, color: NAVY }, { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 60, y2: 4, lineWidth: 2.5, lineColor: TEAL }] }], margin: [0, 6, 0, 10] };
}
export const h2 = (text: string) => ({ text, fontSize: 11, bold: true, color: NAVY, margin: [0, 10, 0, 3] });
export const para = (text: string | object[]) => ({ text, fontSize: 9.5, color: INK, lineHeight: 1.35, margin: [0, 0, 0, 6] });
export const note = (text: string) => ({ text, fontSize: 7.5, color: MUTED, italics: true, margin: [0, 2, 0, 8] });

export function table(head: string[], rows: (string | object)[][], o: { widths?: (string | number)[]; align?: ('left' | 'right' | 'center')[]; fontSize?: number; redRows?: number[] } = {}) {
  const fs = o.fontSize ?? 8;
  return {
    table: {
      headerRows: 1,
      widths: o.widths ?? head.map(() => '*'),
      body: [
        head.map((h, i) => ({ text: h.toUpperCase(), fontSize: 6.5, bold: true, color: MUTED, characterSpacing: 0.3, alignment: o.align?.[i] ?? 'left', fillColor: SOFT })),
        ...rows.map((r, ri) => r.map((c, i) => (typeof c === 'string' ? { text: c, fontSize: fs, color: o.redRows?.includes(ri) && i > 0 ? RED : INK, alignment: o.align?.[i] ?? 'left' } : c))),
      ],
    },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0.8 : 0.4),
      vLineWidth: () => 0,
      hLineColor: (i: number) => (i <= 1 ? '#d1d5db' : '#eef0f3'),
      paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 4, paddingRight: () => 4,
    },
    margin: [0, 2, 0, 8],
  };
}

function header(logo: string | null, title: string) {
  return (page: number) => (page === 1 ? null : {
    columns: [
      logo ? { image: 'logo', width: 26, margin: [40, 14, 0, 0] } : { text: 'KIVU RIDE', bold: true, color: NAVY, fontSize: 9, margin: [40, 18, 0, 0] },
      { text: title, fontSize: 7.5, color: MUTED, alignment: 'right', margin: [0, 22, 40, 0] },
    ],
  });
}
function footer(label: string) {
  return (page: number, pages: number) => ({
    columns: [
      { text: `Kivu Ride Ltd · ${label} · Confidential`, fontSize: 7, color: MUTED, margin: [40, 12, 0, 0] },
      { text: `${page} / ${pages}`, fontSize: 7, color: MUTED, alignment: 'right', margin: [0, 12, 40, 0] },
    ],
  });
}

export function cover(logo: string | null, kicker: string, title: string, subtitle: string, facts: [string, string][], contents: string[] = []) {
  return [
    { canvas: [{ type: 'rect', x: -40, y: -40, w: 595, h: 300, color: NAVY }] },
    ...(logo ? [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 62, h: 62, r: 10, color: '#ffffff' }], absolutePosition: { x: 40, y: 48 } },
      { image: 'logo', width: 48, absolutePosition: { x: 47, y: 55 } },
    ] : []),
    {
      absolutePosition: { x: 40, y: 48 },
      stack: [
        logo ? { text: '', margin: [0, 0, 0, 84] } : { text: 'KIVU RIDE', color: '#ffffff', bold: true, fontSize: 14, margin: [0, 0, 0, 22] },
        { text: kicker.toUpperCase(), color: '#7fd1c9', fontSize: 9, bold: true, characterSpacing: 1.2 },
        { text: title, color: '#ffffff', fontSize: 26, bold: true, lineHeight: 1.1, margin: [0, 6, 0, 8] },
        { text: subtitle, color: '#cbd5e1', fontSize: 11, lineHeight: 1.3 },
      ],
    },
    {
      margin: [0, 40, 0, 0],
      table: { widths: ['*', '*'], body: chunk(facts, 2).map((pair) => pair.map(([k, v]) => ({ stack: [{ text: k.toUpperCase(), fontSize: 7, bold: true, color: MUTED, characterSpacing: 0.5 }, { text: v, fontSize: 11, bold: true, color: NAVY, margin: [0, 2, 0, 0] }], margin: [0, 6, 0, 6] })).concat(pair.length < 2 ? [{ text: '' }] as never[] : [])) },
      layout: 'noBorders',
    },
    ...(contents.length ? [
      { text: 'INSIDE', fontSize: 7, bold: true, color: MUTED, characterSpacing: 0.5, margin: [0, 26, 0, 6] },
      ...contents.map((c, i) => ({ columns: [{ text: String(i + 1).padStart(2, '0'), width: 24, fontSize: 9, bold: true, color: TEAL }, { text: c, fontSize: 10, color: NAVY }], margin: [0, 0, 0, 5] })),
    ] : []),
  ];
}
function chunk<T>(a: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

const gunsText = (s: ChargingStation) => (s.guns ?? []).map((g) => `${GUN_TYPE_LABEL[g.gun_type]} × ${g.gun_count}${g.power_kw ? ` @ ${g.power_kw} kW` : ''}`).join(', ') || '—';

async function photoDataUrl(path: string): Promise<string | null> {
  try {
    const { data } = supabase.storage.from('survey-uploads').getPublicUrl(path);
    const res = await fetch(data.publicUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    // Downscale so a 13-station report stays a few MB.
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch { return null; }
}

// The brand logo is large; shrink it once and register it in pdfmake's
// images dictionary so every page references one embedded copy.
export async function smallLogo(): Promise<string | null> {
  const src = await getLogoDataUrl();
  if (!src) return null;
  try {
    const shrink = (async () => {
      const bmp = await createImageBitmap(await (await fetch(src)).blob());
      const scale = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    })();
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(src), 4000));
    return await Promise.race([shrink, timeout]);
  } catch { return src; }
}

export async function render(doc: object): Promise<Blob> {
  const pdfMake = await getPdfMake();
  return new Promise((resolve, reject) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pdfMake as any).createPdf(doc).getBlob((b: Blob) => resolve(b));
    } catch (e) { reject(e); }
  });
}

export const baseDoc = (logo: string | null, title: string, label: string) => ({
  pageSize: 'A4', pageMargins: [40, 52, 40, 44],
  images: logo ? { logo } : {},
  info: { title, author: 'Kivu Ride Ltd', subject: 'Charging stations survey' },
  header: header(logo, title), footer: footer(label),
  defaultStyle: { font: 'Roboto', fontSize: 9, color: INK },
});

// ================================================================== DATA COLLECTED
export async function buildDataReport(stations: ChargingStation[], an: StationAnalysis): Promise<Blob> {
  const logo = await smallLogo();
  const photos = await Promise.all(stations.map(async (s) => (s.photos?.[0] ? photoDataUrl(s.photos[0].file_url) : null)));
  const title = 'Charging Stations Survey — Data Collected';

  const content: object[] = [
    ...cover(logo, 'Field survey · data collected', 'Charging Stations in Kigali', 'Everything the field team recorded on each public EV charging station, as collected — plus the field follow-up.', [
      ['Stations surveyed', String(an.n)], ['Collected', `${dateLabel(an.firstDate)} – ${dateLabel(an.lastDate)}`],
      ['Collected by', 'Henry Rugaba Mark'], ['Prepared', today()],
    ], ['About this data', 'All stations at a glance', 'Field follow-up (Henry Rugaba Mark)', 'Station by station, with photos', 'Notes on this data']),
    { text: '', pageBreak: 'after' },

    h1('About this data', '1'),
    para('Collectors visited each station and entered it in the Kivu Daily survey form: who owns and runs it, where it is (GPS), its chargers and connector guns, the price paid for electricity and the price charged to drivers, how many cars it serves, opening hours, session length, and a photo. Values are shown exactly as entered — nothing in this document has been corrected.'),
    para(`After the survey, Henry Rugaba Mark reported additional figures that apply to every station (section 3). They are kept separate from what was typed into the form.`),
    kpiRow([
      { label: 'Stations', value: String(an.n) }, { label: 'Chargers', value: String(an.totalChargers) },
      { label: 'Guns', value: String(an.totalGuns) }, { label: 'Open 24 hours', value: `${an.stations247} / ${an.n}` },
    ]),

    h1('All stations at a glance', '2'),
    table(['#', 'Owner / brand', 'Location', 'Chargers', 'Guns', 'Buy', 'Sell', 'Cars/day', 'Session', 'Operator'],
      stations.map((s) => [String(s.station_number), s.owner_brand, s.location_name, String(s.num_chargers), gunsText(s), String(s.buying_price_per_kwh), String(s.selling_price_per_kwh), String(s.cars_per_day), s.avg_session_minutes ? `${s.avg_session_minutes} min` : '—', s.operator_name ?? '—']),
      { widths: [14, 60, 60, 40, '*', 24, 24, 32, 34, 46], align: ['left', 'left', 'left', 'right', 'left', 'right', 'right', 'right', 'right', 'left'], fontSize: 7 }),
    note('Buy / Sell = price per kWh in RWF. Cars/day and Session as reported in the survey form.'),

    h1('Field follow-up (Henry Rugaba Mark)', '3'),
    para(an.followupSource ?? 'Reported to the MD on 10 October 2026; applies to all stations.'),
    table(['Item', 'Minimum', 'Average', 'Maximum'], [
      ['Cars per day, per station', String(an.fieldCarsMin), String(an.fieldCarsAvg), String(an.fieldCarsMax)],
      ['Charging time per car', `${an.fieldMinutesMin} min`, `${an.fieldMinutesAvg} min`, `${an.fieldMinutesMax / 60} hours`],
      ['Operator salary (per month)', rwf(an.salaryMin), rwf(an.salaryAvg), rwf(an.salaryMax)],
    ], { widths: ['*', 90, 90, 90], align: ['left', 'right', 'right', 'right'] }),
    table(['Item', 'Value'], [
      ['Shifts', `${an.shifts} shifts a day, ${an.shiftHours} hours each person`],
      ['Hours', 'All stations work 24 hours'],
      ['Technical issues', stations[0]?.fu_technical_issues ?? '—'],
      ['Heat', stations[0]?.fu_heat_note ?? '—'],
    ], { widths: [140, '*'] }),

    { text: '', pageBreak: 'after' },
    h1('Station by station', '4'),
  ];

  stations.forEach((s, i) => {
    const facts: [string, string][] = [
      ['Owner / brand', s.owner_brand], ['Location', s.location_name],
      ['Address', s.reverse_geocoded_address ?? '—'], ['GPS', s.latitude && s.longitude ? `${Number(s.latitude).toFixed(5)}, ${Number(s.longitude).toFixed(5)}` : '—'],
      ['Operator on duty', s.operator_name ?? '—'], ['Charger brand', s.charger_brand ?? '—'],
      ['Chargers', String(s.num_chargers)], ['Guns', gunsText(s)],
      ['Buying price', `${s.buying_price_per_kwh} RWF/kWh`], ['Selling price', `${s.selling_price_per_kwh} RWF/kWh`],
      ['Cars per day (reported)', String(s.cars_per_day)], ['Weekend', s.weekday_weekend_variation ? `${s.weekend_cars_per_day ?? '—'} cars/day` : 'Same as weekdays'],
      ['Session length (reported)', s.avg_session_minutes ? `${s.avg_session_minutes} min` : '—'], ['Hours', s.operates_24_7 ? '24 hours' : s.operating_hours_note ?? '—'],
      ['Downtime', s.downtime_frequency ? `${s.downtime_frequency}${s.fu_recorded_at ? ' (field follow-up: no technical issues)' : ''}` : '—'], ['Collected', `${dateLabel(s.created_at.slice(0, 10))} · ${s.submitted_by_email}`],
    ];
    content.push({
      unbreakable: true, margin: [0, 0, 0, 14],
      stack: [
        { text: `Station ${s.station_number} — ${s.owner_brand}`, fontSize: 12, bold: true, color: NAVY, margin: [0, 0, 0, 2] },
        { text: s.location_name, fontSize: 9, color: MUTED, margin: [0, 0, 0, 6] },
        {
          columns: [
            { width: '*', table: { widths: [92, '*'], body: facts.map(([k, v]) => [{ text: k, fontSize: 7.5, color: MUTED }, { text: v, fontSize: 8, color: INK }]) }, layout: { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => '#eef0f3', paddingTop: () => 2.5, paddingBottom: () => 2.5 } },
            photos[i] ? { width: 170, image: `photo${i}`, fit: [170, 200], margin: [10, 0, 0, 0] } : { width: 170, text: 'No photo', fontSize: 8, color: MUTED, alignment: 'center', margin: [10, 40, 0, 0] },
          ],
        },
      ],
    });
    if (i % 2 === 1 && i < stations.length - 1) content.push({ text: '', pageBreak: 'after' });
  });

  content.push(h1('Notes on this data', '5'));
  content.push(para('The analysis report explains these in full. In short:'));
  for (const iss of an.issues) content.push({ text: [{ text: `${iss.title}. `, bold: true }, iss.detail], fontSize: 8.5, margin: [0, 0, 0, 5] });

  const doc = baseDoc(logo, title, 'Charging stations — data collected');
  photos.forEach((p, i) => { if (p) (doc.images as Record<string, string>)[`photo${i}`] = p; });
  return render({ ...doc, content });
}

// ================================================================== ANALYSIS REPORT
export async function buildAnalysisReport(_stations: ChargingStation[], an: StationAnalysis): Promise<Blob> {
  const logo = await smallLogo();
  const title = 'Public EV Charging in Kigali — Analysis Report';
  const S = an.stations;
  const n = an.n || 1;
  const typRevenue = an.networkRevenueMonth / n;
  const typEnergy = (an.networkRevenueMonth - an.networkGrossMarginMonth) / n;
  const typStaff = an.networkStaffMonth / n;
  const typNet = typRevenue - typEnergy - typStaff;
  const busiest = [...S].sort((a, b) => b.utilisation - a.utilisation);
  const roomiest = [...S].sort((a, b) => b.guns - a.guns).slice(0, 4);
  const cheapest = [...S].sort((a, b) => a.sell - b.sell);
  const evp = an.owners.find((o) => o.owner === 'EVP');
  const breakEven = S.length ? Math.ceil(S.reduce((t, m) => t + (m.margin > 0 ? m.staffMonth / (an.a.daysPerMonth * an.a.kwhPerSession * m.margin) : 0), 0) / S.length) : 0;
  const sens = sensitivity(an);
  const label = (m: StationMetrics) => `#${m.s.station_number} ${m.s.owner_brand}`;

  const priceRows = [...S].sort((a, b) => b.sell - a.sell).map((m) => ({ label: label(m), parts: [{ v: m.buy, color: GREY }, { v: m.margin, color: BLUE }], end: `${m.sell}` }));
  const capRows = S.filter((m) => m.capacityAtReported).map((m) => ({ label: label(m), parts: [{ v: m.reportedCars, color: ORANGE }, { v: Math.floor(m.capacityAtReported!), color: BLUE }], end: m.reportedOverCapacity ? 'not possible' : '' }));
  const utilRows = busiest.map((m) => ({ label: label(m), parts: [{ v: Math.round(m.utilisation * 100), color: BLUE }], end: `${Math.round(m.utilisation * 100)}%` }));
  const ownerRows = an.owners.map((o) => ({ label: o.owner, parts: [{ v: o.stations, color: BLUE }], end: `${o.stations} station${o.stations > 1 ? 's' : ''} · ${o.guns} guns` }));
  const moneyRows = [
    { label: 'Charging revenue', parts: [{ v: typRevenue, color: BLUE }], end: mrwf(typRevenue) },
    { label: 'Electricity bought', parts: [{ v: typEnergy, color: GREY }], end: mrwf(typEnergy) },
    { label: 'Operator salaries', parts: [{ v: typStaff, color: GREY }], end: mrwf(typStaff) },
    { label: 'Left after salaries', parts: [{ v: Math.max(0, typNet), color: AQUA }], end: mrwf(typNet) },
  ];

  const content: object[] = [
    ...cover(logo, 'Market & economics analysis', 'Public EV Charging in Kigali', `What ${an.n} stations charge, how busy they are, what one earns — and what it means for Kivu Ride.`, [
      ['Stations analysed', `${an.n} (${an.totalGuns} guns)`], ['Survey period', `${dateLabel(an.firstDate)} – ${dateLabel(an.lastDate)}`],
      ['Field data', 'Henry Rugaba Mark'], ['Prepared', `${today()} · for the Managing Director`],
    ], ['Executive summary', 'The market', 'Prices and margins', 'Demand and capacity', 'What a station earns', 'What this means for Kivu Ride', 'Data quality', 'Method, assumptions and station-by-station figures']),
    { text: '', pageBreak: 'after' },

    h1('Executive summary'),
    kpiRow([
      { label: 'Average price', value: `${Math.round(an.avgSell)} RWF`, sub: `per kWh · ${an.minSell}–${an.maxSell}` },
      { label: 'Average margin', value: `${Math.round(an.avgMargin)} RWF`, sub: `per kWh · ${pct(an.avgMarkupPct)} mark-up` },
      { label: 'Cars a day', value: `${an.fieldCarsAvg}`, sub: `per station · ${an.fieldCarsMin}–${an.fieldCarsMax}` },
      { label: 'Guns busy', value: pct(an.avgUtilisation), sub: 'of the day, on average' },
    ]),
    kpiRow([
      { label: 'Charges a day (all 13)', value: num(an.networkCarsDay), sub: `${num(an.networkCarsDayMin)}–${num(an.networkCarsDayMax)}` },
      { label: 'Margin a month', value: rwf(an.networkGrossMarginMonth / n), sub: `typical station · ${an.a.kwhPerSession} kWh/charge` },
      { label: 'Salaries a month', value: rwf(typStaff), sub: `${an.shifts} × ${an.shiftHours}h shifts · ${pct(typStaff / (an.networkGrossMarginMonth / n || 1))} of margin` },
      { label: 'Reported counts impossible', value: `${an.overCapacityCount} / ${an.n}`, sub: 'stations', color: an.overCapacityCount ? RED : NAVY },
    ]),
    h2('Key findings'),
    { ol: an.findings.map((f) => ({ text: f, fontSize: 9, lineHeight: 1.3, margin: [0, 0, 0, 4] })), margin: [0, 0, 0, 6] },
    {
      table: { widths: ['*'], body: [[{ stack: [
        { text: 'READ THIS FIRST', fontSize: 7, bold: true, color: '#b45309', characterSpacing: 0.6 },
        { text: `Energy per charge was not measured; this report assumes ${an.a.kwhPerSession} kWh and shows 10–30 kWh scenarios. Station profits are before rent, maintenance, equipment and financing, which were not collected. Connector types need re-checking (section 6).`, fontSize: 8.5, margin: [0, 2, 0, 0] },
      ], fillColor: '#fffbeb', margin: [8, 6, 8, 6] }]] },
      layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => '#f59e0b' },
    },
    { text: '', pageBreak: 'after' },

    h1('The market', '1'),
    para(`${an.n} public stations were surveyed across Kigali, with ${an.totalChargers} chargers and ${an.totalGuns} guns. ${evp ? `EVP is the largest operator with ${evp.stations} stations;` : ''} every station is open 24 hours with ${an.shifts} shifts a day.`),
    h2('Who runs the stations'),
    { svg: hBars(ownerRows, { labelW: 130, right: 120 }), width: 515 },
    h2('Where they are'),
    { svg: mapChart(S.filter((m) => m.s.latitude && m.s.longitude).map((m) => ({ x: Number(m.s.longitude), y: Number(m.s.latitude), r: 3 + m.guns, label: `#${m.s.station_number}` }))), width: 515 },
    note('Positions from the collector\'s GPS; north is up; dot size = number of guns. Station numbers match the tables.'),
    { text: '', pageBreak: 'after' },

    h1('Prices and margins', '2'),
    para(`Every station buys electricity at ${Math.round(an.avgBuy)} RWF/kWh and sells it for ${an.minSell}–${an.maxSell} RWF/kWh — ${Math.round(an.avgSell)} on average. The gap, ${Math.round(an.avgMargin)} RWF per kWh, is a ${pct(an.avgMarkupPct)} mark-up. Prices vary by ${an.maxSell - an.minSell} RWF across the city, so where a driver charges matters.`),
    legend([{ label: 'Electricity cost', color: GREY }, { label: 'Station margin', color: BLUE }]),
    { svg: hBars(priceRows, { refX: { v: an.avgSell, color: MUTED }, unit: (v) => `${Math.round(v)}` }), width: 515 },
    note('RWF per kWh; the number at the end of each bar is the selling price; dashed line = average.'),
    table(['', 'Lowest', 'Average', 'Highest'], [
      ['Selling price (RWF/kWh)', String(an.minSell), num(an.avgSell), String(an.maxSell)],
      ['Margin (RWF/kWh)', String(an.minMargin), num(an.avgMargin), String(an.maxMargin)],
    ], { widths: ['*', 80, 80, 80], align: ['left', 'right', 'right', 'right'] }),
    h2('Cheapest places to charge'),
    table(['Station', 'Location', 'Price', 'Guns'], cheapest.slice(0, 5).map((m) => [label(m), m.s.location_name, `${m.sell} RWF`, String(m.guns)]), { widths: ['*', '*', 70, 40], align: ['left', 'left', 'right', 'right'] }),
    { text: '', pageBreak: 'after' },

    h1('Demand and capacity', '3'),
    para(`A gun can only charge one car at a time, so a station's maximum is guns × 24 hours ÷ charging time. Measured that way, ${an.overCapacityCount} of the ${an.n} stations reported more cars a day than their guns can physically serve — those survey counts cannot be real daily figures. Mark's follow-up (${an.fieldCarsMin}–${an.fieldCarsMax} cars, average ${an.fieldCarsAvg}) fits within every station's capacity and is used for the rest of this report.`),
    legend([{ label: 'Reported in the survey', color: ORANGE }, { label: 'Most the guns can serve', color: BLUE }, { label: `Mark's range (${an.fieldCarsMin}–${an.fieldCarsMax})`, color: '#cdeee2' }]),
    { svg: hBars(capRows, { grouped: true, right: 70, band: [an.fieldCarsMin, an.fieldCarsMax] }), width: 515 },
    note('Cars per day. "Not possible" = reported count above the station\'s physical maximum at its reported charging time.'),
    { unbreakable: true, stack: [
    h2('How busy the guns are'),
    para(`At ${an.fieldCarsAvg} cars × ${an.fieldMinutesAvg} minutes, guns are charging ${pct(an.avgUtilisation)} of the day on average. Two-gun stations run at about ${pct(busiest[0]?.utilisation ?? 0)} — busy enough for queues at peak hours — while the ${roomiest.map((m) => label(m)).join(', ')} sites have spare capacity.`),
    { svg: hBars(utilRows, { max: 100, refX: { v: 70, color: ORANGE }, unit: (v) => `${Math.round(v)}%` }), width: 515 },
    note('Share of the day the guns are in use. Dashed line = 70%, where queues usually start.'),
    ] },
    { text: '', pageBreak: 'after' },

    h1('What a station earns', '4'),
    para(`A typical station sells ${num(an.fieldCarsAvg * an.a.kwhPerSession)} kWh a day (${an.fieldCarsAvg} cars × ${an.a.kwhPerSession} kWh). In a ${an.a.daysPerMonth}-day month that is about ${rwf(typRevenue)} of charging revenue, of which ${rwf(typEnergy)} pays for electricity. Three operators on ${an.shiftHours}-hour shifts at ${rwf(an.salaryAvg)} each cost ${rwf(typStaff)}, leaving about ${rwf(typNet)} a month before rent, maintenance, equipment and financing.`),
    legend([{ label: 'Money in / left', color: BLUE }, { label: 'Costs', color: GREY }, { label: 'Left after salaries', color: AQUA }]),
    { svg: hBars(moneyRows, { labelW: 120, unit: mrwf }), width: 515 },
    note(`Typical (average) station, RWF a month, at ${an.a.kwhPerSession} kWh per charge.`),
    h2('How sensitive this is'),
    para(`The biggest unknown is the energy a car takes per charge. The chart shows a station's monthly result across 20–60 cars a day for 10, 20 and 30 kWh per charge. Salaries are covered from about ${breakEven} cars a day — staffing is a small cost; electricity volume drives everything.`),
    legend(KWH_SCENARIOS.map((k, i) => ({ label: `${k} kWh per charge`, color: [ORANGE, BLUE, AQUA][i] }))),
    { svg: lineChart(sens.map((r) => r.cars), KWH_SCENARIOS.map((k, i) => ({ name: `${k} kWh`, color: [ORANGE, BLUE, AQUA][i], values: sens.map((r) => r[`k${k}`]) })), { band: [an.fieldCarsMin, an.fieldCarsMax], yFmt: mrwf, xLabel: 'cars a day' }), width: 515 },
    note('RWF a month after operator salaries. Shaded = Mark\'s field range.'),
    { text: '', pageBreak: 'after' },

    h1('What this means for Kivu Ride', '5'),
    { ol: [
      `Charging costs our cars ${rwf(an.publicPremiumPerKwh)} per kWh above the grid price at public stations — about ${rwf(an.publicPremiumPerKwh * an.a.kwhPerSession)} on every ${an.a.kwhPerSession} kWh charge. Any fleet discount or own charging cuts straight into that.`,
      `Negotiate a fleet rate where we can bring volume: ${evp ? `EVP runs ${evp.stations} of the ${an.n} stations,` : ''} and ${label(cheapest[0])} already sells at ${cheapest[0].sell} RWF/kWh.`,
      `Send our drivers to stations with spare guns (${roomiest.map((m) => label(m)).join(', ')}) — the two-gun sites are already about ${pct(busiest[0]?.utilisation ?? 0)} busy and queues cost driving time.`,
      `An own station looks attractive on energy margin alone (${rwf(an.avgMargin)}/kWh, salaries only about ${pct(typStaff / (an.networkGrossMarginMonth / n || 1))} of it), but the decision depends on costs not yet collected: equipment, installation, grid connection, rent and maintenance.`,
      `Fix the data before investing: confirm connector types (photo of each plug), count cars at 2–3 stations for a full week, and record kWh per session from operator receipts.`,
    ].map((t) => ({ text: t, fontSize: 9.5, lineHeight: 1.35, margin: [0, 0, 0, 6] })) },

    h1('Data quality', '6'),
    ...an.issues.flatMap((iss) => [
      { text: [{ text: `${iss.severity.toUpperCase()}  `, bold: true, color: iss.severity === 'high' ? RED : iss.severity === 'medium' ? '#b45309' : MUTED, fontSize: 7.5 }, { text: iss.title, bold: true, fontSize: 9.5, color: NAVY }], margin: [0, 4, 0, 2] },
      { text: iss.detail, fontSize: 8.5, color: INK, margin: [0, 0, 0, 2] },
      ...(iss.stations.length ? [{ ul: iss.stations.map((s) => ({ text: s, fontSize: 8, color: MUTED })), margin: [8, 0, 0, 4] }] : []),
    ]),
    { text: '', pageBreak: 'after' },

    h1('Method and assumptions', 'A'),
    table(['Measure', 'How it is calculated'], [
      ['Margin per kWh', 'Selling price − buying price (both as reported).'],
      ['Maximum cars a day', 'Guns × 1,440 minutes ÷ charging time. Assumes each gun charges one car at a time.'],
      ['Guns busy', 'Cars a day × charging time ÷ (guns × 1,440 minutes), at Mark\'s field averages.'],
      ['Energy sold', `Cars a day × ${an.a.kwhPerSession} kWh per charge (assumption — not measured).`],
      ['Charging revenue', 'Energy sold × the station\'s own selling price.'],
      ['Operator salaries', `${an.shifts} shifts × ${an.a.operatorsPerShift} operator × ${rwf(an.salaryAvg)} a month (range ${rwf(an.salaryMin)}–${rwf(an.salaryMax)}).`],
      ['Left after salaries', 'Energy margin × days − salaries. Excludes rent, maintenance, equipment, financing and taxes.'],
      ['Month', `${an.a.daysPerMonth} days.`],
    ], { widths: [120, '*'] }),
    para(`Why ${an.a.kwhPerSession} kWh: drivers accept a ${an.fieldMinutesAvg}-minute charge, which points to DC chargers; at 20–30 kW average that delivers roughly 17–25 kWh. Charger power was not recorded for most stations, so the report also shows 10 and 30 kWh.`),
    h1('Station by station', 'B'),
    table(['Station', 'Guns', 'Price', 'Margin', 'Reported', 'Max', 'Busy', 'Margin/month', 'Left/month'],
      S.map((m) => [label(m), String(m.guns), String(m.sell), String(m.margin), m.reportedOverCapacity ? { text: `${m.reportedCars} !`, fontSize: 7.5, bold: true, color: RED, alignment: 'right' } : String(m.reportedCars), m.capacityAtReported ? String(Math.floor(m.capacityAtReported)) : '—', pct(m.utilisation), num(m.grossMarginDay * an.a.daysPerMonth), num(m.netMonth)]),
      { widths: ['*', 26, 30, 32, 40, 30, 30, 62, 62], align: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'], fontSize: 7.5 }),
    note('Price and margin in RWF/kWh; money in RWF a month at field averages. "!" = reported cars a day above the physical maximum.'),
  ];

  return render({ ...baseDoc(logo, title, 'Charging stations — analysis'), content });
}
