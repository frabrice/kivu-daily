import { Vehicle, VehicleOwner } from './supabase';

// pdfmake bundles its embedded fonts as ~1MB+ of base64 data - loaded
// dynamically (not at module top-level) so nobody pays for it until
// they actually open Newsletters and generate a PDF, instead of it
// bloating every page's initial bundle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfMakeInstance: any = null;
async function getPdfMake() {
  if (pdfMakeInstance) return pdfMakeInstance;
  const [pdfMakeModule, pdfFontsModule] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  // A dynamically-imported CJS module's ES namespace object is frozen -
  // assigning .vfs onto it silently doesn't reach the real module.exports
  // object createPdf() reads from internally. The actual CJS export (with
  // working, mutable .vfs/.createPdf) is on .default under Vite/Rollup's
  // interop, so that's what has to be mutated and returned.
  const pdfMake = (pdfMakeModule as unknown as { default: unknown }).default ?? pdfMakeModule;
  const pdfFonts = (pdfFontsModule as unknown as { default: unknown }).default ?? pdfFontsModule;
  (pdfMake as { vfs: unknown }).vfs = pdfFonts;
  pdfMakeInstance = pdfMake;
  return pdfMake;
}

const NAVY = '#17263A';
const TEAL = '#2F8C86';
const GREEN = '#4F7B3E';
const LOGO_URL = 'https://res.cloudinary.com/dyqitacqz/image/upload/v1783862214/ChatGPT_Image_Jul_12_2026_03_15_30_PM_biax4t.png';

let cachedLogoDataUrl: string | null = null;

async function getLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  try {
    const res = await fetch(LOGO_URL);
    const blob = await res.blob();
    cachedLogoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return cachedLogoDataUrl;
  } catch {
    return null;
  }
}

export interface VehicleReportInput {
  vehicle: Vehicle;
  currentMileage: number | null;
  remainingMileageToService: number | null;
  distanceThisWeek: number | null;
  totalEarningsSoFar: number | null;
  thisWeeksPayout: number | null;
  personalNote: string | null;
}

function fmtNum(n: number | null, unit: string): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n).toLocaleString()} ${unit}`;
}

function weekRangeLabel(): string {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}, ${sunday.getFullYear()}`;
}

// One branded, professionally laid-out PDF per owner - a single car gets
// a clean key/value card, multiple cars get one table with each car's
// plate number as its own column (per the operator's explicit design),
// so an owner with a fleet can compare cars side by side at a glance.
export async function generateOwnerReportPdf(owner: VehicleOwner, reports: VehicleReportInput[]): Promise<Blob> {
  const logo = await getLogoDataUrl();
  const multiCar = reports.length > 1;

  const metricRows: { label: string; get: (r: VehicleReportInput) => string }[] = [
    { label: 'Current Mileage', get: (r) => fmtNum(r.currentMileage, 'km') },
    { label: 'Remaining to Next Service', get: (r) => fmtNum(r.remainingMileageToService, 'km') },
    { label: 'Distance This Week', get: (r) => fmtNum(r.distanceThisWeek, 'km') },
    { label: "This Week's Payout", get: (r) => fmtNum(r.thisWeeksPayout, 'RWF') },
    { label: 'Total Earnings So Far', get: (r) => fmtNum(r.totalEarningsSoFar, 'RWF') },
  ];

  const reportTable = multiCar
    ? {
        table: {
          headerRows: 1,
          widths: ['*', ...reports.map(() => '*')],
          body: [
            [
              { text: '', style: 'tableHeaderBlank' },
              ...reports.map((r) => ({ text: r.vehicle.plate_number, style: 'tableHeaderCell' })),
            ],
            ...metricRows.map((m) => [
              { text: m.label, style: 'tableLabelCell' },
              ...reports.map((r) => ({ text: m.get(r), style: 'tableValueCell' })),
            ]),
          ],
        },
        layout: {
          hLineWidth: (i: number) => (i === 0 || i === 1 ? 1.5 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => '#e5e7eb',
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
      }
    : {
        table: {
          widths: ['*', 'auto'],
          body: metricRows.map((m) => [
            { text: m.label, style: 'tableLabelCell' },
            { text: m.get(reports[0]), style: 'tableValueCellSingle' },
          ]),
        },
        layout: {
          hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => '#e5e7eb',
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
      };

  const notes = reports.filter((r) => r.personalNote && r.personalNote.trim());

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content: [
      {
        columns: [
          logo ? { image: logo, width: 90 } : { text: 'KIVU RIDE', style: 'logoFallback' },
          {
            stack: [
              { text: 'WEEKLY VEHICLE REPORT', style: 'reportTitle', alignment: 'right' },
              { text: weekRangeLabel(), style: 'reportSubtitle', alignment: 'right' },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: TEAL }], margin: [0, 12, 0, 20] },
      { text: `Dear ${owner.full_name},`, style: 'greeting' },
      {
        text: `Here's how ${multiCar ? 'your cars' : 'your car'} performed with Kivu Ride this week. Thank you for partnering with us as we keep Kigali moving — beyond transport, into the future.`,
        style: 'intro',
      },
      { text: multiCar ? 'Your Fleet' : `Vehicle: ${reports[0].vehicle.plate_number}`, style: 'sectionLabel', margin: [0, 20, 0, 8] },
      reportTable,
      ...(notes.length > 0
        ? [
            { text: 'Notes', style: 'sectionLabel', margin: [0, 20, 0, 8] },
            ...notes.map((r) => ({ text: `${r.vehicle.plate_number}: ${r.personalNote}`, style: 'noteText', margin: [0, 0, 0, 4] })),
          ]
        : []),
    ],
    styles: {
      logoFallback: { fontSize: 16, bold: true, color: NAVY },
      reportTitle: { fontSize: 16, bold: true, color: NAVY },
      reportSubtitle: { fontSize: 10, color: '#888888', margin: [0, 2, 0, 0] },
      greeting: { fontSize: 13, bold: true, color: NAVY, margin: [0, 0, 0, 8] },
      intro: { fontSize: 10, color: '#555555', lineHeight: 1.3 },
      sectionLabel: { fontSize: 10, bold: true, color: TEAL, characterSpacing: 0.5 },
      tableHeaderBlank: { fontSize: 9 },
      tableHeaderCell: { fontSize: 11, bold: true, color: '#ffffff', fillColor: NAVY, alignment: 'center', margin: [0, 4, 0, 4] },
      tableLabelCell: { fontSize: 9, color: '#555555', margin: [0, 2, 0, 2] },
      tableValueCell: { fontSize: 10, bold: true, color: NAVY, alignment: 'center' },
      tableValueCellSingle: { fontSize: 11, bold: true, color: NAVY, alignment: 'right' },
      noteText: { fontSize: 9, italics: true, color: '#555555' },
    },
    footer: (currentPage: number, pageCount: number) => ({
      stack: [
        { canvas: [{ type: 'line', x1: 40, y1: 0, x2: 555, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }] },
        {
          columns: [
            { text: 'Kivu Ride — Beyond Transport. Into the Future.', fontSize: 8, color: GREEN, margin: [40, 8, 0, 0] },
            { text: 'Book: 6900 · 0799 526 171', fontSize: 8, color: '#888888', alignment: 'right', margin: [0, 8, 40, 0] },
          ],
        },
        currentPage === pageCount ? undefined : { text: `${currentPage}/${pageCount}`, alignment: 'center', fontSize: 8, color: '#888888' },
      ].filter(Boolean),
    }),
  };

  const pdfMake = await getPdfMake();
  return new Promise((resolve, reject) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pdfMake as any).createPdf(docDefinition).getBlob((blob: Blob) => resolve(blob));
    } catch (e) {
      reject(e);
    }
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
