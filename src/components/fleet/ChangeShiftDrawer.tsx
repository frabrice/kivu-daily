import { useMemo, useState } from 'react';
import { CalendarCheck, Info, SunMoon, Wallet } from 'lucide-react';
import { supabase, Driver, DriverDeposit, DriverRestDay, DriverShift } from '../../lib/supabase';
import { todayStr } from '../../lib/utils';
import {
  DEPOSIT_PAYMENT_METHODS, REST_DAYS, carSeats, computeDepositStanding, dailyRateOn, formatDateLabelSafe, formatRwf, seatFree, shiftLabel, weeklyAmountOf,
} from '../../lib/fleet';
import { LegalDraft, draftError, emptyDraft, uploadDraft } from '../../lib/legalDocs';
import { LegalDocFields } from '../legal/LegalDocFields';
import Modal from '../Modal';

// Move a driver already on a car between one shift and both shifts
// (MD, 15 Oct 2026). Both shifts only when they're alone on the car. Every
// term is confirmed, the prepayment for the new rate is recorded (or a
// date agreed), and the signed and stamped amendment is attached - all
// saved in one step. Days before the change keep the old rate.
export default function ChangeShiftDrawer({ driver, drivers, deposits, onClose, onSaved }: {
  driver: Driver; drivers: Driver[]; deposits: DriverDeposit[]; onClose: () => void; onSaved: () => void;
}) {
  const t = todayStr();
  const others = carSeats(driver.vehicle_id!, drivers, driver.id);
  const coDriver = others.day ?? others.night;
  const options: { key: DriverShift; label: string; sub: string; ok: boolean; why?: string }[] = (['full', 'day', 'night'] as DriverShift[])
    .filter((s) => s !== driver.shift)
    .map((s) => {
      const ok = seatFree(driver.vehicle_id!, s, drivers, driver.id);
      return {
        key: s, label: s === 'full' ? 'Both shifts' : `${shiftLabel(s)} shift only`, sub: `${formatRwf(weeklyAmountOf({ shift: s }))} a week`, ok,
        why: ok ? undefined : s === 'full' ? `${coDriver?.full_name ?? 'Another driver'} also drives ${driver.vehicle?.plate_number ?? 'this car'} — both shifts is only possible for a driver alone on the car.` : `The ${s} seat on this car is taken.`,
      };
    });
  const [shift, setShift] = useState<DriverShift | ''>(options.find((o) => o.ok)?.key ?? '');
  const [effective, setEffective] = useState(t > (driver.start_date ?? t) ? t : driver.start_date ?? t);
  const [restDay, setRestDay] = useState<DriverRestDay | ''>(driver.rest_day ?? '');
  const [prepaid, setPrepaid] = useState<'now' | 'later'>('now');
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(t);
  const [method, setMethod] = useState<'momo' | 'bank'>('momo');
  const [bank, setBank] = useState('');
  const [payBy, setPayBy] = useState('');
  const [agreed, setAgreed] = useState<string[]>([]);
  const [details, setDetails] = useState('');
  const [amendment, setAmendment] = useState<LegalDraft>(emptyDraft(t));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const myDeposits = useMemo(() => deposits.filter((d) => d.driver_id === driver.id), [deposits, driver.id]);
  const oldDaily = dailyRateOn(driver, effective);
  const newDaily = shift === 'full' ? 60000 : 30000;
  const toBoth = shift === 'full';

  // Where they'd stand on the new rate with what they've paid so far: what
  // has to come in now to be paid up to the end of this week.
  const preview = useMemo(() => {
    if (!shift || !driver.start_date) return null;
    const history = driver.rate_history?.length ? driver.rate_history.filter((h) => h.from < effective) : [{ from: driver.start_date, daily: oldDaily }];
    const hyp: Driver = { ...driver, shift, rest_day: (restDay || driver.rest_day) as Driver['rest_day'], rate_history: [...history, { from: effective, daily: newDaily }] };
    const on = effective > t ? effective : t;
    const st = computeDepositStanding(hyp, myDeposits, on);
    return { st, topUp: Math.max(0, st.owes + st.weekBehind) };
  }, [shift, driver, effective, restDay, oldDaily, newDaily, myDeposits, t]);

  const terms = shift ? [
    `Pays ${formatRwf(newDaily * 6)} a week (${formatRwf(newDaily)} per working day) from ${formatDateLabelSafe(effective)} — days before keep the old rate`,
    `Monthly salary becomes ${formatRwf(toBoth ? 300000 : 150000)}`,
    toBoth ? `Drives both the day and the night shift of ${driver.vehicle?.plate_number ?? 'the car'} alone — no second driver while on both shifts` : `Drives the ${shiftLabel(shift).toLowerCase()} shift only — the other shift goes to another driver`,
    'Same rest day and the same Sunday payment rule',
    'The driver has read and signed the contract amendment',
  ] : [];
  const allAgreed = terms.length > 0 && terms.every((x) => agreed.includes(x));
  const amountN = Number(amount.replace(/[^\d]/g, '')) || 0;
  const amendmentError = draftError('driver_contract_amendment', amendment);
  const problem = !shift ? 'Choose the new shift.'
    : !effective ? 'Choose the date the change starts.'
    : driver.start_date && effective < driver.start_date ? "The change can't start before the contract."
    : !allAgreed ? 'Tick every term once the driver has agreed to it.'
    : prepaid === 'now' && amountN <= 0 ? 'Enter the prepayment received (or choose “Agreed to pay later”).'
    : prepaid === 'now' && method === 'bank' && !bank.trim() ? 'Enter the bank.'
    : prepaid === 'later' && !payBy ? 'Enter the date they agreed to pay by.'
    : amendmentError;

  const save = async () => {
    if (problem || !shift) { setError(problem ?? ''); return; }
    setSaving(true); setError('');
    const up = await uploadDraft('driver_contract_amendment', driver.id, amendment);
    if ('error' in up) { setSaving(false); setError(up.error); return; }
    const { error: err } = await supabase.rpc('change_driver_shift_with_amendment', {
      doc: up.doc,
      p: {
        driver_id: driver.id, effective_date: effective, new_shift: shift, rest_day: restDay || null,
        prepayment: prepaid === 'now' ? { amount: amountN, paid_date: paidDate, payment_method: method, bank_name: method === 'bank' ? bank.trim() : null } : null,
        agreed_pay_by: prepaid === 'later' ? payBy : null, terms, details: details.trim(),
      },
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const label = 'block text-caption font-medium mb-1.5 text-fg-muted';
  return (
    <Modal open onClose={onClose} title="Change shift" subtitle={`${driver.full_name} · ${driver.vehicle?.plate_number ?? ''} · now ${shiftLabel(driver.shift)}${driver.shift === 'full' ? '' : ' shift'}`} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div>
          <span className={label}>New shift *</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {options.map((o) => (
              <button key={o.key} type="button" disabled={!o.ok} onClick={() => setShift(o.key)} aria-pressed={shift === o.key}
                className={`text-left rounded-lg border px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${shift === o.key ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover'}`}>
                <span className="flex items-center gap-1.5 text-small font-medium"><SunMoon size={13} /> {o.label}</span>
                <span className="block text-caption text-fg-muted">{o.sub}</span>
              </button>
            ))}
          </div>
          {options.filter((o) => !o.ok).map((o) => <p key={o.key} className="mt-1.5 text-caption text-attention flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" />{o.why}</p>)}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block"><span className={label}>Starts on *</span>
            <input type="date" value={effective} min={driver.start_date ?? undefined} onChange={(e) => setEffective(e.target.value)} className="input" />
          </label>
          <label className="block"><span className={label}>Rest day</span>
            <select value={restDay} onChange={(e) => setRestDay(e.target.value as DriverRestDay)} className="input">
              {REST_DAYS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
        </div>

        {preview && (
          <div className="rounded-lg border border-line bg-inset p-3 text-small space-y-1">
            <p className="text-caption font-semibold text-fg-muted flex items-center gap-1.5"><Wallet size={12} /> On the new rate</p>
            <p>{formatRwf(oldDaily)} → <b>{formatRwf(newDaily)}</b> a working day · {formatRwf(newDaily * 6)} a week</p>
            {preview.topUp > 0
              ? <p className="text-attention font-medium">To be paid up to the end of this week: {formatRwf(preview.topUp)}</p>
              : <p className="text-success">Already paid up on the new rate{preview.st.paidThrough ? ` through ${formatDateLabelSafe(preview.st.paidThrough)}` : ''}.</p>}
            {preview.st.nextDueDate && <p className="text-fg-muted">Then {formatRwf(preview.st.nextDueAmount)} due {formatDateLabelSafe(preview.st.nextDueDate)}</p>}
          </div>
        )}

        <div>
          <span className={label}>Prepayment for the new rate *</span>
          <div className="flex gap-1 mb-2">
            {([['now', 'Received'], ['later', 'Agreed to pay later']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setPrepaid(k)} aria-pressed={prepaid === k} className={`px-2.5 py-1.5 rounded-md text-caption border ${prepaid === k ? 'border-accent bg-accent/10' : 'border-line text-fg-muted'}`}>{l}</button>
            ))}
          </div>
          {prepaid === 'now' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="input tabular-nums" placeholder={preview?.topUp ? `e.g. ${preview.topUp.toLocaleString()}` : 'Amount (RWF)'} aria-label="Amount received" />
              <input type="date" value={paidDate} max={t} onChange={(e) => setPaidDate(e.target.value)} className="input" aria-label="Date received" />
              <select value={method} onChange={(e) => setMethod(e.target.value as 'momo' | 'bank')} className="input" aria-label="Paid with">
                {DEPOSIT_PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              {method === 'bank' && <input value={bank} onChange={(e) => setBank(e.target.value)} className="input sm:col-span-3" placeholder="Bank, e.g. Bank of Kigali" aria-label="Bank" />}
              <p className="sm:col-span-3 text-caption text-fg-muted">Recorded as a driver payment waiting for Finance to confirm.</p>
            </div>
          ) : (
            <label className="block"><span className="block text-caption text-fg-muted mb-1">Agreed to pay by *</span>
              <input type="date" value={payBy} min={t} onChange={(e) => setPayBy(e.target.value)} className="input sm:w-1/2" />
            </label>
          )}
        </div>

        {terms.length > 0 && (
          <div>
            <span className={label}>Terms agreed with the driver *</span>
            <div className="space-y-1">
              {terms.map((x) => (
                <label key={x} className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-small cursor-pointer ${agreed.includes(x) ? 'border-success/50 bg-success-muted' : 'border-line hover:bg-hover'}`}>
                  <input type="checkbox" className="mt-0.5" checked={agreed.includes(x)} onChange={(e) => setAgreed((a) => (e.target.checked ? [...a, x] : a.filter((y) => y !== x)))} />{x}
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="block"><span className={label}>Notes</span>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} className="input resize-none" placeholder="Anything else agreed" />
        </label>

        <LegalDocFields kind="driver_contract_amendment" draft={amendment} onChange={setAmendment} title="Contract amendment — signed and stamped *" />

        {error && <div className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</div>}
        {!error && problem && <p className="text-caption text-fg-muted">{problem}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !!problem} className="btn-primary disabled:opacity-50"><CalendarCheck size={14} /> {saving ? 'Saving…' : 'Change shift'}</button>
        </div>
      </div>
    </Modal>
  );
}
