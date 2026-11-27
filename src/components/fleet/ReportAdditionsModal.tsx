import { useState } from 'react';
import { FileText, Loader2, Plus, Trash2, UserPlus } from 'lucide-react';
import Modal from '../Modal';
import DateInput from '../DateInput';
import { kigaliToday } from '../../lib/kigali';
import type { ReportAddition } from '../../lib/depositsReportPdf';

// Before the Deposits PDF is made (MD, 27 Nov 2026): money received from
// people who aren't in Kivu Daily as a driver on a car yet (not registered,
// no car, not started), so the report's totals cover all money received.
// These lines go into this one report only; nothing is saved.

interface Row { name: string; amount: string; date: string; reason: string }
const blank = (): Row => ({ name: '', amount: '', date: kigaliToday(), reason: '' });
const REASONS = ['Not registered in Kivu Daily yet', 'Registered, no car yet', 'Has a car, has not started yet', 'Paid for someone else'];

export default function ReportAdditionsModal({ initial, busy, onCancel, onMake }: {
  initial: ReportAddition[]; busy: boolean; onCancel: () => void; onMake: (additions: ReportAddition[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((a) => ({ name: a.name, amount: String(a.amount), date: a.date, reason: a.reason })));
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.name.trim() || r.amount);
  const incomplete = filled.some((r) => !r.name.trim() || !(Number(r.amount) > 0) || !r.date);
  const toAdditions = (): ReportAddition[] => filled.map((r) => ({ name: r.name.trim(), amount: Number(r.amount), date: r.date, reason: r.reason.trim() }));
  const total = filled.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <Modal open onClose={busy ? () => undefined : onCancel} title="Anything to add to the report?" subtitle="Money received from someone not in Kivu Daily as a driver on a car yet" maxWidth="max-w-2xl">
      <div className="space-y-3 text-small">
        <p className="text-body text-fg-muted">
          If a driver paid but isn't registered, has no car yet or hasn't started, add them here so the report counts all money received.
          They appear in their own list and in the totals. <b className="text-fg">Nothing is saved in Kivu Daily</b> — this is for this report only.
        </p>

        {rows.length === 0 ? (
          <button onClick={() => setRows([blank()])} className="w-full card-muted border-dashed px-4 py-5 text-center hover:bg-hover transition-colors">
            <UserPlus size={20} className="mx-auto text-fg-subtle mb-1" />
            <span className="text-body font-medium">Add someone who paid</span>
            <span className="block text-caption text-fg-subtle">or make the report as it is</span>
          </button>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border border-line p-3 grid grid-cols-1 sm:grid-cols-[1.3fr_0.8fr_0.9fr_auto] gap-2 items-end">
                <label className="block"><span className="text-caption font-medium text-fg-muted">Driver's name</span>
                  <input className="input mt-1" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Full name" autoFocus={i === rows.length - 1} /></label>
                <label className="block"><span className="text-caption font-medium text-fg-muted">Amount (RWF)</span>
                  <input className="input mt-1" inputMode="numeric" value={r.amount} onChange={(e) => set(i, { amount: e.target.value.replace(/[^\d]/g, '') })} placeholder="45000" /></label>
                <label className="block"><span className="text-caption font-medium text-fg-muted">Received on</span>
                  <div className="mt-1"><DateInput value={r.date} onChange={(v) => set(i, { date: v })} max={kigaliToday()} /></div></label>
                <button onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} className="btn-ghost text-fg-subtle hover:text-danger h-8" title="Remove" aria-label="Remove"><Trash2 size={14} /></button>
                <label className="block sm:col-span-4"><span className="text-caption font-medium text-fg-muted">Why they aren't in the system yet</span>
                  <input className="input mt-1" value={r.reason} onChange={(e) => set(i, { reason: e.target.value })} placeholder="e.g. Registered, no car yet" list="report-addition-reasons" /></label>
              </div>
            ))}
            <datalist id="report-addition-reasons">{REASONS.map((x) => <option key={x} value={x} />)}</datalist>
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setRows((rs) => [...rs, blank()])} className="btn-secondary"><Plus size={14} /> Add another</button>
              {total > 0 && <span className="text-caption text-fg-muted">Added: <b className="text-fg tabular-nums">{total.toLocaleString('en-US')} RWF</b> from {filled.length} {filled.length === 1 ? 'person' : 'people'}</span>}
            </div>
          </div>
        )}

        {incomplete && <p className="text-caption text-attention">Each line needs a name, an amount and the date it was received.</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onCancel} disabled={busy} className="btn-ghost">Cancel</button>
          {filled.length > 0 && <button onClick={() => onMake([])} disabled={busy} className="btn-secondary">Make it without these</button>}
          <button onClick={() => onMake(toAdditions())} disabled={busy || incomplete} className="btn-primary">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {busy ? 'Preparing…' : filled.length ? 'Make the PDF with these' : 'Make the PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
