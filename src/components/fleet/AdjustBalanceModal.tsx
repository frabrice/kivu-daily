import { useMemo, useState } from 'react';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import Modal from '../Modal';
import { supabase, Driver, DriverDeposit } from '../../lib/supabase';
import { computeDepositStanding, formatDateLabelSafe } from '../../lib/fleet';
import type { BalanceAdjustment } from '../../lib/fleet';
import { rwf } from '../../ui/kit';

// Adjust a driver's numbers (migration 20261101130000): type what "Owes",
// "Behind" and the next payment date should be, and why. Owes and behind
// both come from what the driver paid, so they move together: the
// difference is recorded as one credit or charge. A later payment date is
// recorded as "may drive until". Nothing is overwritten; it is all kept
// with who, when, the reason and the numbers before and after.
export default function AdjustBalanceModal({ driver, deposits, onClose, onSaved }: { driver: Driver; deposits: DriverDeposit[]; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
  const before = useMemo(() => computeDepositStanding(driver, deposits), [driver, deposits]);
  const [amount, setAmount] = useState(0); // credit (+) or charge (-)
  const [owesText, setOwesText] = useState(String(before.owes));
  const [behindText, setBehindText] = useState(String(before.weekBehind));
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The numbers with this adjustment, as every page will show them.
  const after = useMemo(() => {
    const extra: BalanceAdjustment[] = [
      ...(amount ? [{ id: 'new-a', kind: 'amount' as const, date: today, amount, reason: '', by: null, by_name: null, at: new Date().toISOString() }] : []),
      ...(until ? [{ id: 'new-g', kind: 'grace' as const, date: today, until, reason: '', by: null, by_name: null, at: new Date().toISOString() }] : []),
    ];
    return computeDepositStanding({ ...driver, balance_adjustments: [...(driver.balance_adjustments ?? []), ...extra] }, deposits);
  }, [amount, until, driver, deposits, today]);

  // Typing "Owes" or "Behind" sets the credit; the other number follows.
  const fromOwes = (v: string) => {
    setOwesText(v);
    const n = Number(v.replace(/[^\d]/g, ''));
    if (v.trim() === '' || Number.isNaN(n)) return;
    const a = before.owes - n;
    setAmount(a);
    setBehindText(String(Math.max(0, before.weekBehind - a)));
  };
  const fromBehind = (v: string) => {
    setBehindText(v);
    const n = Number(v.replace(/[^\d]/g, ''));
    if (v.trim() === '' || Number.isNaN(n)) return;
    const a = before.weekBehind - n;
    setAmount(a);
    setOwesText(String(Math.max(0, before.owes - a)));
  };

  const changed = amount !== 0 || !!until;
  const save = async () => {
    setBusy(true); setErr(null);
    const snap = (s: typeof before) => ({ owes: s.owes, behind: s.weekBehind, next_due: s.nextDueDate });
    const { error } = await supabase.rpc('adjust_driver_balance', {
      p_driver: driver.id, p_amount: amount || null, p_until: until || null, p_reason: reason, p_before: snap(before), p_after: snap(after),
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Adjust ${driver.full_name}'s numbers`} subtitle="Recorded with your name, the date, the reason and the numbers before and after" maxWidth="max-w-lg">
      <div className="space-y-4 text-small">
        <div className="grid grid-cols-3 gap-2">
          {([['Owes now', rwf(before.owes)], ['Behind this week', rwf(before.weekBehind)], ['Next payment', before.nextDueDate ? formatDateLabelSafe(before.nextDueDate) : '—']] as [string, string][]).map(([l, v]) => (
            <div key={l} className="rounded-lg bg-inset p-2 text-center"><p className="text-micro text-fg-muted">{l} today</p><p className="font-semibold">{v}</p></div>
          ))}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block"><span className="text-caption font-semibold text-fg-muted">Owes should be</span>
            <input className="input w-full mt-1" inputMode="numeric" value={owesText} onChange={(e) => fromOwes(e.target.value)} /></label>
          <label className="block"><span className="text-caption font-semibold text-fg-muted">Behind should be</span>
            <input className="input w-full mt-1" inputMode="numeric" value={behindText} onChange={(e) => fromBehind(e.target.value)} /></label>
          <label className="block"><span className="text-caption font-semibold text-fg-muted">May drive until</span>
            <input type="date" className="input w-full mt-1" value={until} min={today} max={new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} /></label>
        </div>
        <p className="text-caption text-fg-muted">Owes and behind both come from what the driver has paid, so they move together. The date: the driver is cleared to drive until that day even if not paid up, and those days are not counted as lost.</p>

        {changed && (
          <div className="rounded-lg border border-brand/40 bg-brand/5 p-3 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><SlidersHorizontal size={14} /> What will be recorded</p>
            {amount !== 0 && <p>{amount > 0 ? `A credit of ${rwf(amount)}` : `A charge of ${rwf(-amount)}`} on the driver's account (not money received: Finance's cash does not change).</p>}
            {until && <p>The driver may drive until {formatDateLabelSafe(until)}.</p>}
            <p className="text-fg-muted">After: owes {rwf(after.owes)} · behind {rwf(after.weekBehind)} · next payment {after.nextDueDate ? formatDateLabelSafe(after.nextDueDate) : '—'} · {after.isCleared ? 'cleared to drive' : 'not cleared to drive'}</p>
          </div>
        )}

        <label className="block"><span className="text-caption font-semibold text-fg-muted">Reason (required)</span>
          <textarea className="input w-full mt-1" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Paid 30,000 in cash to Fleet on 28 Oct, not logged; car was in the garage 2 days" /></label>

        {err && <p className="text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!changed || reason.trim().length < 5 || busy} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Record the adjustment</button>
        </div>
      </div>
    </Modal>
  );
}
