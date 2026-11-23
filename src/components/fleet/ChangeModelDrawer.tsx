import { useMemo, useState } from 'react';
import { CalendarCheck, Info, Wallet } from 'lucide-react';
import { supabase, Driver, DriverDeposit, DriverModel, DriverRestDay } from '../../lib/supabase';
import { todayStr } from '../../lib/utils';
import {
  DEPOSIT_PAYMENT_METHODS, DRIVER_MODELS, REST_DAYS, carSeats, computeDepositStanding, dailyRateOn, driverTermsLabel, formatDateLabelSafe, formatRwf,
  modelWeekly, shiftDay, mondayOf,
} from '../../lib/fleet';
import { LegalDraft, draftError, emptyDraft, uploadDraft } from '../../lib/legalDocs';
import { LegalDocFields } from '../legal/LegalDocFields';
import Modal from '../Modal';

// Move a driver already on a car to another model (MD, 12 Nov 2026), or to
// another shift or rest day on the same model:
//   One shift (day or night) 30,000 x 6 · Both shifts 60,000 x 6 · Solo car 45,000 x 7.
// A whole-car model needs the car to itself. Every term is confirmed, the
// prepayment for the new terms is recorded (or a date agreed), and the
// signed and stamped amendment is attached - all saved in one step
// (change_driver_model). Days before the change keep the old rate and rest day.

type Choice = { key: string; model: DriverModel; shift: 'day' | 'night' | null; label: string; sub: string; ok: boolean; why?: string };

export default function ChangeModelDrawer({ driver, drivers, deposits, onClose, onSaved }: {
  driver: Driver; drivers: Driver[]; deposits: DriverDeposit[]; onClose: () => void; onSaved: () => void;
}) {
  const t = todayStr();
  const others = carSeats(driver.vehicle_id!, drivers, driver.id);
  const coDriver = others.day ?? others.night;
  const plate = driver.vehicle?.plate_number ?? 'this car';

  const choices: Choice[] = useMemo(() => {
    const list: Omit<Choice, 'ok' | 'why'>[] = [
      { key: 'solo_car', model: 'solo_car', shift: null, label: 'Solo car', sub: `${formatRwf(modelWeekly('solo_car'))} a week · 45,000 every day · no salary` },
      { key: 'both_shifts', model: 'both_shifts', shift: null, label: 'Both shifts', sub: `${formatRwf(modelWeekly('both_shifts'))} a week · 60,000 a working day` },
      { key: 'day', model: 'one_shift', shift: 'day', label: 'Day shift', sub: `${formatRwf(modelWeekly('one_shift'))} a week · shares the car` },
      { key: 'night', model: 'one_shift', shift: 'night', label: 'Night shift', sub: `${formatRwf(modelWeekly('one_shift'))} a week · shares the car` },
    ];
    return list.map((c) => {
      const whole = DRIVER_MODELS[c.model].wholeCar;
      const ok = whole ? !others.day && !others.night : !others.full && !(c.shift && others[c.shift]);
      return { ...c, ok, why: ok ? undefined : whole ? `${coDriver?.full_name ?? 'Another driver'} also drives ${plate}: ${c.label} needs the car to itself.` : `The ${c.shift} shift on ${plate} is taken.` };
    });
  }, [others, coDriver, plate]);
  const currentKey = driver.model === 'one_shift' ? driver.shift ?? 'day' : driver.model;

  const [choice, setChoice] = useState<string>(choices.find((c) => c.ok && c.key !== currentKey)?.key ?? '');
  const picked = choices.find((c) => c.key === choice) ?? null;
  const nextMonday = shiftDay(mondayOf(t), 7);
  const [effective, setEffective] = useState(driver.start_date && driver.start_date > nextMonday ? driver.start_date : nextMonday);
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
  const m = picked ? DRIVER_MODELS[picked.model] : null;
  const newRest = m && m.restDay ? (restDay || null) : null;
  const oldDaily = dailyRateOn(driver, shiftDay(effective, -1));
  const sameAsNow = !!picked && picked.model === driver.model && (picked.shift ?? (m?.wholeCar ? 'full' : driver.shift)) === driver.shift && newRest === driver.rest_day;

  // Where they'd stand on the new terms with what they've paid so far.
  const preview = useMemo(() => {
    if (!picked || !m || !driver.start_date) return null;
    const history = (driver.rate_history ?? []).filter((h) => h.from < effective);
    const base = history.length ? history : [{ from: driver.start_date, daily: oldDaily, model: driver.model, rest_day: driver.rest_day }];
    const hyp: Driver = {
      ...driver, model: picked.model, shift: m.wholeCar ? 'full' : picked.shift, rest_day: newRest,
      rate_history: [...base, { from: effective, daily: m.daily, model: picked.model, rest_day: newRest }],
    };
    const on = effective > t ? effective : t;
    const st = computeDepositStanding(hyp, myDeposits, on);
    return { st, topUp: Math.max(0, st.owes + st.weekBehind) };
  }, [picked, m, driver, effective, newRest, oldDaily, myDeposits, t]);

  const terms = picked && m ? [
    `Pays ${formatRwf(m.daily * (m.restDay ? 6 : 7))} a week (${formatRwf(m.daily)} a ${m.restDay ? 'working day' : 'day, every day'}) from ${formatDateLabelSafe(effective)} — days before keep the old terms`,
    m.salary ? `Monthly salary: ${formatRwf(m.salary)}` : 'No monthly salary from Kivu Ride',
    m.wholeCar ? `Has ${plate} alone — no second driver on the car` : `Drives the ${picked.shift} shift only — the other shift goes to another driver`,
    m.restDay ? `Rest day: ${REST_DAYS.find((r) => r.key === restDay)?.label ?? '—'}, free` : 'No rest day: every day is paid, only approved pauses (sick, garage) are free',
    'Same payment rule: each day paid before it is driven (the day before; the same day is tolerated)',
    'The driver has read and signed the contract amendment',
  ] : [];
  const allAgreed = terms.length > 0 && terms.every((x) => agreed.includes(x));
  const amountN = Number(amount.replace(/[^\d]/g, '')) || 0;
  const amendmentError = draftError('driver_contract_amendment', amendment);
  const problem = !picked ? 'Choose the new model.'
    : !picked.ok ? picked.why ?? 'That choice is not possible on this car.'
    : sameAsNow ? 'That is what the driver is on now: pick another model, shift or rest day.'
    : m?.restDay && !restDay ? 'Choose the rest day.'
    : !effective ? 'Choose the date the change starts.'
    : driver.start_date && effective < driver.start_date ? "The change can't start before the contract."
    : !allAgreed ? 'Tick every term once the driver has agreed to it.'
    : prepaid === 'now' && amountN <= 0 ? 'Enter the prepayment received (or choose “Agreed to pay later”).'
    : prepaid === 'now' && method === 'bank' && !bank.trim() ? 'Enter the bank.'
    : prepaid === 'later' && !payBy ? 'Enter the date they agreed to pay by.'
    : amendmentError;

  const save = async () => {
    if (problem || !picked) { setError(problem ?? ''); return; }
    setSaving(true); setError('');
    const up = await uploadDraft('driver_contract_amendment', driver.id, amendment);
    if ('error' in up) { setSaving(false); setError(up.error); return; }
    const { error: err } = await supabase.rpc('change_driver_model_with_amendment', {
      doc: up.doc,
      p: {
        driver_id: driver.id, effective_date: effective, model: picked.model, shift: picked.shift, rest_day: newRest,
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
    <Modal open onClose={onClose} title="Change model" subtitle={`${driver.full_name} · ${driver.vehicle?.plate_number ?? ''} · now ${driverTermsLabel(driver)}`} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div>
          <span className={label}>New model *</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {choices.map((c) => (
              <button key={c.key} type="button" disabled={!c.ok} onClick={() => { setChoice(c.key); setAgreed([]); }} aria-pressed={choice === c.key}
                className={`text-left rounded-lg border px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${choice === c.key ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover'}`}>
                <span className="flex items-center gap-1.5 text-small font-medium">{c.label}{c.key === currentKey && <span className="text-micro text-fg-subtle font-normal">· now</span>}</span>
                <span className="block text-caption text-fg-muted">{c.sub}</span>
              </button>
            ))}
          </div>
          {choices.filter((c) => !c.ok).map((c) => <p key={c.key} className="mt-1.5 text-caption text-attention flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" />{c.why}</p>)}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block"><span className={label}>Starts on *</span>
            <input type="date" value={effective} min={driver.start_date ?? undefined} onChange={(e) => setEffective(e.target.value)} className="input" />
            <span className="block text-micro text-fg-subtle mt-1">A Monday fits the weekly prepayment best. Each day counts at the terms of that day.</span>
          </label>
          {m?.restDay !== false ? (
            <label className="block"><span className={label}>Rest day *</span>
              <select value={restDay} onChange={(e) => setRestDay(e.target.value as DriverRestDay)} className="input">
                <option value="">Choose…</option>
                {REST_DAYS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>
          ) : (
            <div><span className={label}>Rest day</span><p className="text-small text-fg-muted pt-2">None: Solo car works every day.</p></div>
          )}
        </div>

        {preview && m && (
          <div className="rounded-lg border border-line bg-inset p-3 text-small space-y-1">
            <p className="text-caption font-semibold text-fg-muted flex items-center gap-1.5"><Wallet size={12} /> On the new terms</p>
            <p>{formatRwf(oldDaily)} → <b>{formatRwf(m.daily)}</b> a day · <b>{formatRwf(m.daily * (m.restDay ? 6 : 7))}</b> a week ({m.restDay ? '6 paid days' : '7 paid days'})</p>
            {preview.topUp > 0
              ? <p className="text-attention font-medium">To be paid up to the end of this week: {formatRwf(preview.topUp)}</p>
              : <p className="text-success">Already paid up on the new terms{preview.st.paidThrough ? ` through ${formatDateLabelSafe(preview.st.paidThrough)}` : ''}.</p>}
            {preview.st.nextDueDate && <p className="text-fg-muted">Then {formatRwf(preview.st.nextDueAmount)} due {formatDateLabelSafe(preview.st.nextDueDate)}</p>}
          </div>
        )}

        <div>
          <span className={label}>Prepayment for the new terms *</span>
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
                {DEPOSIT_PAYMENT_METHODS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
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
          <button onClick={save} disabled={saving || !!problem} className="btn-primary disabled:opacity-50"><CalendarCheck size={14} /> {saving ? 'Saving…' : 'Change model'}</button>
        </div>
      </div>
    </Modal>
  );
}
