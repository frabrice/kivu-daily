import { useState } from 'react';
import { FileText, Loader2, Plus, Save, Trash2, UserPlus } from 'lucide-react';
import Modal from '../Modal';
import DateInput from '../DateInput';
import { kigaliToday } from '../../lib/kigali';
import { addDays } from '../../lib/performance';
import { OtherMoney, OtherMoneyKind, KIND_LABEL, OTHER_MONEY_REPORT_DAYS, canRemoveOtherMoney, deleteOtherMoney, saveOtherMoney } from '../../lib/otherMoney';

// Money received from people who aren't in Kivu Daily as a driver on a car
// yet (not registered, no car, not started). Opened from "Record other money"
// on Deposits, or before the PDF report is made (MD, 27 Nov 2026). What is
// entered here is saved, so every report counts it on the day it came in.

interface Row { name: string; amount: string; date: string; reason: string; kind: OtherMoneyKind }
const blank = (): Row => ({ name: '', amount: '', date: kigaliToday(), reason: '', kind: 'deposit' });
const REASONS = ['Not registered in Kivu Daily yet', 'Registered, no car yet', 'Has a car, has not started yet', 'Paid for someone else'];
const rwf = (n: number) => `${n.toLocaleString('en-US')} RWF`;
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export default function ReportAdditionsModal({ mode, recorded, profileId, isMd, busy = false, onCancel, onSaved, onMake }: {
  mode: 'record' | 'report';
  recorded: OtherMoney[];
  profileId: string | undefined;
  isMd: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onMake?: () => void;
}) {
  const report = mode === 'report';
  const [rows, setRows] = useState<Row[]>(() => (report ? [] : [blank()]));
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.name.trim() || r.amount);
  const incomplete = filled.some((r) => !r.name.trim() || !(Number(r.amount) > 0) || !r.date);
  const total = filled.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const since = addDays(kigaliToday(), -(OTHER_MONEY_REPORT_DAYS - 1));
  // The last week, and anything older still waiting to be connected to a driver.
  const recent = recorded.filter((m) => m.received_on >= since || !m.driver_id);
  const recentTotal = recent.reduce((s, m) => s + Number(m.amount), 0);
  const working = busy || saving;

  const save = async () => {
    setError('');
    if (filled.length) {
      setSaving(true);
      const err = await saveOtherMoney(filled.map((r) => ({ payer_name: r.name, amount: Number(r.amount), received_on: r.date, reason: r.reason, kind: r.kind })));
      setSaving(false);
      if (err) { setError(`Couldn't save: ${err}`); return; }
      setRows([]);
      onSaved();
    }
    if (report) onMake?.();
    else onCancel();
  };

  const remove = async (m: OtherMoney) => {
    if (!window.confirm(`Remove ${m.payer_name.trim()}'s ${rwf(Number(m.amount))} of ${dayLabel(m.received_on)}? It will no longer count in the reports.`)) return;
    setRemoving(m.id); setError('');
    const err = await deleteOtherMoney(m.id);
    setRemoving(null);
    if (err) { setError(`Couldn't remove it: ${err}`); return; }
    onSaved();
  };

  return (
    <Modal open onClose={working ? () => undefined : onCancel}
      title={report ? 'Anything to add to the report?' : 'Record other money received'}
      subtitle="Money from someone not in Kivu Daily as a driver on a car yet" maxWidth="max-w-2xl">
      <div className="space-y-3 text-small">
        <p className="text-body text-fg-muted">
          If someone paid but isn't registered, has no car yet or hasn't started, record it here. <b className="text-fg">It is saved</b>, and every Deposits report counts it on the day it was received.
          When you add them as a driver, connect it there so it is never counted twice. <b className="text-fg">Collateral</b> is security money: held, given back at the end, never counted as paying for days.
        </p>

        <div>
          <p className="text-caption font-semibold text-fg-muted mb-1.5">
            Recorded in the last {OTHER_MONEY_REPORT_DAYS} days, and any not connected yet{recent.length ? ` · ${rwf(recentTotal)}` : ''}
          </p>
          {recent.length === 0 ? (
            <p className="text-caption text-fg-subtle">Nothing recorded yet.</p>
          ) : (
            <div className="rounded-lg border border-line divide-y divide-line-muted">
              {recent.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium truncate flex items-center gap-1.5">
                      {m.payer_name}
                      <span className={`text-micro font-semibold px-1.5 py-0.5 rounded ${m.kind === 'collateral' ? 'bg-accent-muted text-accent-fg' : 'bg-surface-2 text-fg-muted'}`}>{KIND_LABEL[m.kind]}</span>
                    </p>
                    <p className={`text-caption truncate ${m.driver_id ? 'text-success' : 'text-attention'}`}>{m.driver_id ? `Connected to ${m.driver?.full_name ?? 'a driver'}` : 'Not connected to a driver yet'}</p>
                    <p className="text-caption text-fg-subtle truncate">{dayLabel(m.received_on)}{m.reason ? ` · ${m.reason}` : ''}{m.author?.full_name ? ` · by ${m.author.full_name.split(' ')[0]}` : ''}</p>
                  </div>
                  <span className="text-body font-semibold tabular-nums whitespace-nowrap">{rwf(Number(m.amount))}</span>
                  {canRemoveOtherMoney(m, profileId, isMd) ? (
                    <button onClick={() => remove(m)} disabled={working || removing === m.id} className="btn-ghost text-fg-subtle hover:text-danger h-8" title="Remove" aria-label={`Remove ${m.payer_name}`}>
                      {removing === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  ) : <span className="w-8" />}
                </div>
              ))}
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <button onClick={() => setRows([blank()])} className="w-full card-muted border-dashed px-4 py-4 text-center hover:bg-hover transition-colors">
            <UserPlus size={20} className="mx-auto text-fg-subtle mb-1" />
            <span className="text-body font-medium">Add someone who paid</span>
            {report && <span className="block text-caption text-fg-subtle">or make the report as it is</span>}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-caption font-semibold text-fg-muted">New</p>
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border border-line p-3 grid grid-cols-1 sm:grid-cols-[1.3fr_0.8fr_0.9fr_auto] gap-2 items-end">
                <label className="block"><span className="text-caption font-medium text-fg-muted">Name</span>
                  <input className="input mt-1" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Full name" autoFocus={i === rows.length - 1} /></label>
                <label className="block"><span className="text-caption font-medium text-fg-muted">Amount (RWF)</span>
                  <input className="input mt-1" inputMode="numeric" value={r.amount} onChange={(e) => set(i, { amount: e.target.value.replace(/[^\d]/g, '') })} placeholder="45000" /></label>
                <label className="block"><span className="text-caption font-medium text-fg-muted">Received on</span>
                  <div className="mt-1"><DateInput value={r.date} onChange={(v) => set(i, { date: v })} max={kigaliToday()} /></div></label>
                <button onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} className="btn-ghost text-fg-subtle hover:text-danger h-8" title="Remove" aria-label="Remove"><Trash2 size={14} /></button>
                <div className="sm:col-span-4 flex gap-1.5" role="radiogroup" aria-label="What is this money">
                  {(['deposit', 'collateral'] as const).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={r.kind === k} onClick={() => set(i, { kind: k })}
                      className={`flex-1 rounded-md border px-2.5 py-1.5 text-left ${r.kind === k ? 'border-accent bg-accent/10' : 'border-line text-fg-muted hover:bg-hover'}`}>
                      <span className="block text-caption font-medium">{KIND_LABEL[k]}</span>
                      <span className="block text-micro text-fg-subtle">{k === 'deposit' ? 'Pays for driving days once they start' : 'Security money, given back at the end'}</span>
                    </button>
                  ))}
                </div>
                <label className="block sm:col-span-4"><span className="text-caption font-medium text-fg-muted">Why they aren't in the system yet</span>
                  <input className="input mt-1" value={r.reason} onChange={(e) => set(i, { reason: e.target.value })} placeholder="e.g. Registered, no car yet" list="report-addition-reasons" /></label>
              </div>
            ))}
            <datalist id="report-addition-reasons">{REASONS.map((x) => <option key={x} value={x} />)}</datalist>
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setRows((rs) => [...rs, blank()])} className="btn-secondary"><Plus size={14} /> Add another</button>
              {total > 0 && <span className="text-caption text-fg-muted">New: <b className="text-fg tabular-nums">{rwf(total)}</b> from {filled.length} {filled.length === 1 ? 'person' : 'people'}</span>}
            </div>
          </div>
        )}

        {incomplete && <p className="text-caption text-attention">Each line needs a name, an amount and the date it was received.</p>}
        {error && <div className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</div>}
        <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onCancel} disabled={working} className="btn-ghost">{report || filled.length ? 'Cancel' : 'Close'}</button>
          {report ? (
            <button onClick={save} disabled={working || incomplete} className="btn-primary">
              {working ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {working ? 'Preparing…' : filled.length ? 'Save and make the PDF' : 'Make the PDF'}
            </button>
          ) : (
            <button onClick={save} disabled={working || incomplete || !filled.length} className="btn-primary">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
