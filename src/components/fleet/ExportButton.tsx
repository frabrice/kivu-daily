import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import Modal from '../Modal';
import { REPORTS, ReportKind, buildReport, download, fileName, loadExportData, toExcel, toPdf } from '../../lib/fleetExports';

// "Export" on the Fleet pages and Under Management: pick a report, a period
// and Excel or PDF; the file is made in the browser and downloaded.
const todayK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d: string) => shift(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const lastOfMonth = (d: string) => { const x = new Date(`${d.slice(0, 7)}-01T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); };

export default function ExportButton({ initial = 'drivers', label = 'Export' }: { initial?: ReportKind; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary"><Download size={14} /> {label}</button>
      {open && <ExportModal initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExportModal({ initial, onClose }: { initial: ReportKind; onClose: () => void }) {
  const t = todayK();
  const prevMonth = shift(`${t.slice(0, 7)}-01`, -1);
  const periods: [string, string, string][] = [
    ['This week', mondayOf(t), t], ['Last week', shift(mondayOf(t), -7), shift(mondayOf(t), -1)],
    ['This month', `${t.slice(0, 7)}-01`, t], ['Last month', `${prevMonth.slice(0, 7)}-01`, lastOfMonth(prevMonth)],
  ];
  const [kind, setKind] = useState<ReportKind>(initial);
  const [from, setFrom] = useState(periods[2][1]);
  const [to, setTo] = useState(t);
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [err, setErr] = useState('');
  const make = async (ext: 'xlsx' | 'pdf') => {
    setBusy(ext); setErr('');
    try {
      const data = await loadExportData(from, to);
      const r = buildReport(kind, data, from, to);
      download(ext === 'xlsx' ? await toExcel(r) : await toPdf(r), fileName(r, ext));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open onClose={onClose} title="Export a report" subtitle="Made from the same numbers as the pages, for the period you choose" maxWidth="max-w-lg">
      <div className="space-y-4 text-small">
        <div className="space-y-1.5">
          {REPORTS.map((r) => (
            <label key={r.key} className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer ${kind === r.key ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/40'}`}>
              <input type="radio" name="report" checked={kind === r.key} onChange={() => setKind(r.key)} className="mt-1" />
              <span><span className="font-semibold block">{r.label}</span><span className="text-caption text-fg-muted">{r.hint}</span></span>
            </label>
          ))}
        </div>
        <div>
          <p className="text-caption font-semibold text-fg-muted mb-1">Period</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {periods.map(([l, f, e]) => (
              <button key={l} onClick={() => { setFrom(f); setTo(e); }} className={`px-2.5 py-1 rounded-md border ${from === f && to === e ? 'border-brand text-brand bg-brand/5 font-medium' : 'border-line text-fg-muted'}`}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="date" className="input !w-auto py-1" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" />
            <span className="text-fg-subtle">to</span>
            <input type="date" className="input !w-auto py-1" value={to} min={from} max={t} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To" />
          </div>
        </div>
        {err && <p className="text-danger">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={() => make('pdf')} disabled={!!busy} className="btn-secondary">{busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF</button>
          <button onClick={() => make('xlsx')} disabled={!!busy} className="btn-primary">{busy === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel</button>
        </div>
      </div>
    </Modal>
  );
}
