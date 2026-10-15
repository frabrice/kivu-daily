import { useMemo, useState } from 'react';
import { CalendarCheck, Car, Info, RotateCcw, Wallet } from 'lucide-react';
import { supabase, Driver, DriverContractEvent, DriverDeposit, DriverRestDay, DriverShift, Vehicle } from '../../lib/supabase';
import { todayStr } from '../../lib/utils';
import {
  CONTRACT_CAN_RETURN, CONTRACT_RENEW_CHANGES, CONTRACT_RENEW_REASONS, REST_DAYS, carSeats, computeDepositStanding, contractSettlement, formatDateLabelSafe,
  formatRwf, seatFree, shiftDay, shiftLabel, weeklyAmountOf, dailyRateOf,
} from '../../lib/fleet';
import Modal from '../Modal';
import DateInput from '../DateInput';
import { LegalDocFields } from '../legal/LegalDocFields';
import { LegalDraft, draftError, emptyDraft, uploadDraft } from '../../lib/legalDocs';

const SHIFTS: { key: DriverShift; label: string; sub: string }[] = [
  { key: 'day', label: 'Day shift', sub: '180,000 a week' },
  { key: 'night', label: 'Night shift', sub: '180,000 a week' },
  { key: 'full', label: 'Both shifts', sub: '360,000 a week · the whole car' },
];

// Start a new contract for a driver whose contract ended: new start date,
// a new first payment and/or credit carried from days they had already
// paid for, car/shift/rest day, and what changed. Shows when they'll be
// paid through and their next payment before saving.
export default function RenewContractDrawer({ driver, drivers, vehicles, deposits, contractEvents, onClose, onSaved }: {
  driver: Driver; drivers: Driver[]; vehicles: Vehicle[]; deposits: DriverDeposit[]; contractEvents: DriverContractEvent[]; onClose: () => void; onSaved: () => void;
}) {
  const lastEnd = useMemo(() => contractEvents.filter((e) => e.driver_id === driver.id && e.event_type === 'ended').sort((a, b) => b.event_date.localeCompare(a.event_date))[0] ?? null, [contractEvents, driver.id]);
  const myDeposits = useMemo(() => deposits.filter((d) => d.driver_id === driver.id), [deposits, driver.id]);
  // Credit from the old contract: what they'd paid beyond its last day.
  const suggestedCredit = useMemo(() => {
    const saved = Number((lastEnd?.meta as { credit?: number } | null)?.credit ?? NaN);
    if (!Number.isNaN(saved)) return saved;
    return lastEnd ? contractSettlement(driver, myDeposits, lastEnd.event_date).credit : 0;
  }, [lastEnd, driver, myDeposits]);
  const canReturn = (lastEnd?.meta as { can_return?: string } | null)?.can_return;

  const [reasonKey, setReasonKey] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [shift, setShift] = useState<DriverShift>('day');
  const [vehicleId, setVehicleId] = useState('');
  const [restDay, setRestDay] = useState<DriverRestDay | ''>(driver.rest_day ?? '');
  const [paidFirst, setPaidFirst] = useState(true);
  const [firstAmount, setFirstAmount] = useState(String(weeklyAmountOf({ shift: 'day' })));
  const [firstDate, setFirstDate] = useState(todayStr());
  const [useCredit, setUseCredit] = useState(suggestedCredit > 0);
  const [creditAmount, setCreditAmount] = useState(String(suggestedCredit || ''));
  const [changes, setChanges] = useState<string[]>([]);
  const [agreedNext, setAgreedNext] = useState('');
  const [details, setDetails] = useState('');
  const [contract, setContract] = useState<LegalDraft>(emptyDraft(todayStr()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pickShift = (s: DriverShift) => {
    setShift(s);
    if (firstAmount === String(weeklyAmountOf({ shift })) || !firstAmount) setFirstAmount(String(weeklyAmountOf({ shift: s })));
    if (vehicleId && !seatFree(vehicleId, s, drivers, driver.id)) setVehicleId('');
    if (s === 'full' && !changes.includes('Now on both shifts')) setChanges((c) => [...c, 'Now on both shifts']);
  };
  const cars = vehicles.map((v) => ({ v, free: seatFree(v.id, shift, drivers, driver.id), seats: carSeats(v.id, drivers, driver.id) }));
  const first = paidFirst ? Number(firstAmount.replace(/[^\d]/g, '')) || 0 : 0;
  const credit = useCredit ? Number(creditAmount.replace(/[^\d]/g, '')) || 0 : 0;
  const reason = reasonKey === 'other' ? otherReason.trim() : CONTRACT_RENEW_REASONS.find((r) => r.key === reasonKey)?.label ?? '';

  // What the new contract looks like with these numbers.
  const preview = useMemo(() => {
    if (!startDate) return null;
    const hyp: Driver = {
      ...driver, contract_status: 'active', start_date: startDate, shift, rest_day: (restDay || null) as Driver['rest_day'],
      payments_from: lastEnd ? shiftDay(lastEnd.event_date, 1) : startDate, opening_credit: credit,
      initial_deposit_paid: first > 0, initial_deposit_amount: first > 0 ? first : null, initial_deposit_date: first > 0 ? firstDate : null, pauses: [],
    };
    const on = startDate > todayStr() ? startDate : todayStr();
    return computeDepositStanding(hyp, myDeposits, on);
  }, [driver, startDate, shift, vehicleId, restDay, lastEnd, credit, first, firstDate, myDeposits]);

  const contractError = draftError('driver_contract', contract);
  const canSave = !!reasonKey && (reasonKey !== 'other' || !!otherReason.trim()) && !!startDate && !!restDay && (!paidFirst || first > 0) && !contractError;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    // The new signed contract is uploaded, then the renewal and the
    // contract are saved together.
    const up = await uploadDraft('driver_contract', driver.id, contract);
    if ('error' in up) { setSaving(false); setError(up.error); return; }
    const { error: err } = await supabase.rpc('renew_driver_contract_with_contract', {
      doc: up.doc,
      p: {
        driver_id: driver.id, start_date: startDate, reason_key: reasonKey, reason, details: details.trim(),
        vehicle_id: vehicleId || null, shift: vehicleId ? shift : null, rest_day: restDay,
        first_payment: first > 0 ? first : null, first_payment_date: firstDate, opening_credit: credit,
        changes, agreed_next_payment: agreedNext || null,
      },
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const label = 'block text-caption font-medium mb-1.5 text-fg-muted';
  return (
    <Modal open onClose={onClose} title="Renew contract" subtitle={`${driver.full_name}${lastEnd ? ` · ended ${formatDateLabelSafe(lastEnd.event_date)} (${lastEnd.reason})` : ''}`} maxWidth="max-w-2xl">
      <div className="space-y-5">
        {canReturn === 'no' && <p className="text-small text-danger bg-danger-muted rounded-md px-3 py-2 flex items-start gap-2"><Info size={14} className="mt-0.5 shrink-0" /> When this contract ended it was marked “do not rehire”. Make sure renewing has been agreed.</p>}
        {canReturn === 'conditions' && <p className="text-small text-attention bg-attention-muted rounded-md px-3 py-2 flex items-start gap-2"><Info size={14} className="mt-0.5 shrink-0" /> They could come back only under conditions{lastEnd?.details ? `: ${lastEnd.details}` : ''}.</p>}

        <section className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Why renew?</span>
            <select value={reasonKey} onChange={(e) => setReasonKey(e.target.value)} className="input" autoFocus>
              <option value="" disabled>Choose a reason…</option>
              {CONTRACT_RENEW_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={label}>New start date</span>
            <DateInput value={startDate} onChange={setStartDate} />
          </label>
          {reasonKey === 'other' && <label className="block sm:col-span-2"><span className={label}>The reason</span><input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} className="input" /></label>}
        </section>

        <section>
          <p className={label}>How they'll work</p>
          <div className="grid grid-cols-3 gap-1.5">
            {SHIFTS.map((s) => (
              <button key={s.key} type="button" onClick={() => pickShift(s.key)} className={`rounded-md border px-3 py-2 text-left ${shift === s.key ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover'}`}>
                <span className="block text-small font-semibold">{s.label}</span><span className="block text-caption text-fg-muted">{s.sub}</span>
              </button>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <label className="block">
              <span className={label}><Car size={12} className="inline -mt-0.5" /> Car</span>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="input">
                <option value="">No car yet</option>
                {cars.map(({ v, free, seats }) => (
                  <option key={v.id} value={v.id} disabled={!free}>
                    {v.plate_number}{free ? '' : ` — ${seats.full ? `${seats.full.full_name} has both shifts` : `${shift === 'full' ? 'has drivers' : `${shiftLabel(shift)} taken`}`}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>Rest day</span>
              <select value={restDay} onChange={(e) => setRestDay(e.target.value as DriverRestDay)} className="input">
                <option value="" disabled>Choose…</option>
                {REST_DAYS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-line p-3 space-y-2">
            <label className="flex items-center gap-2 text-small font-medium"><input type="checkbox" checked={paidFirst} onChange={(e) => setPaidFirst(e.target.checked)} /> Paid a new first payment</label>
            {paidFirst && (
              <div className="grid grid-cols-2 gap-2">
                <input value={firstAmount} onChange={(e) => setFirstAmount(e.target.value)} inputMode="numeric" className="input" aria-label="First payment amount" />
                <DateInput value={firstDate} onChange={setFirstDate} />
              </div>
            )}
            <p className="text-caption text-fg-muted">A full week on {shiftLabel(shift).toLowerCase()} is {formatRwf(weeklyAmountOf({ shift }))}.</p>
          </div>
          <div className="rounded-lg border border-line p-3 space-y-2">
            <label className="flex items-center gap-2 text-small font-medium"><input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} /> Still had paid days left</label>
            {useCredit && <input value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} inputMode="numeric" className="input" aria-label="Credit carried over" placeholder="Amount in RWF" />}
            <p className="text-caption text-fg-muted">
              {suggestedCredit > 0 ? `When the contract ended they had ${formatRwf(suggestedCredit)} paid ahead.` : 'Nothing was paid ahead when the contract ended.'}
              {credit > 0 && (Math.floor(credit / dailyRateOf({ shift })) >= 1 ? ` That covers ${Math.floor(credit / dailyRateOf({ shift }))} working day${Math.floor(credit / dailyRateOf({ shift })) === 1 ? '' : 's'}.` : ` That is less than one working day (${formatRwf(dailyRateOf({ shift }))}); it still counts towards the first week.`)}
            </p>
          </div>
        </section>

        {preview && (
          <section className="rounded-lg bg-inset border border-line-muted p-3 grid sm:grid-cols-3 gap-3 text-small">
            <div><p className="text-caption text-fg-muted flex items-center gap-1"><Wallet size={11} /> Paid in for this contract</p><p className="font-semibold tabular-nums">{formatRwf(preview.totalPaid)}</p></div>
            <div><p className="text-caption text-fg-muted flex items-center gap-1"><CalendarCheck size={11} /> Paid through</p><p className="font-semibold">{preview.paidThrough ? formatDateLabelSafe(preview.paidThrough) : 'Not covered yet'}</p></div>
            <div><p className="text-caption text-fg-muted flex items-center gap-1"><RotateCcw size={11} /> Next payment</p><p className="font-semibold">{preview.nextDueAmount > 0 ? `${formatRwf(preview.nextDueAmount)} by ${preview.nextDueDate ? formatDateLabelSafe(preview.nextDueDate) : '—'}` : 'Nothing due this week'}</p></div>
            {!preview.isCleared && <p className="sm:col-span-3 text-danger">Not cleared to drive on the start date — {formatRwf(preview.weekBehind)} short for the first week.</p>}
          </section>
        )}

        <section className="space-y-3">
          <div>
            <p className={label}>What changed in how they work?</p>
            <div className="flex flex-wrap gap-1.5">
              {CONTRACT_RENEW_CHANGES.map((c) => (
                <button key={c} type="button" onClick={() => setChanges((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}
                  className={`label ${changes.includes(c) ? 'border-accent/50 bg-accent/10 text-accent-fg' : 'border-line text-fg-muted bg-surface-2 hover:bg-hover'}`}>{c}</button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Agreed next payment date (optional)</span>
              <DateInput value={agreedNext} onChange={setAgreedNext} />
              <span className="block text-caption text-fg-subtle mt-1">Only if you agreed something different from the usual Sunday rule.</span>
            </label>
            <label className="block">
              <span className={label}>Notes</span>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} className="input resize-none" placeholder="New terms, conditions, warnings…" />
            </label>
          </div>
        </section>

        <LegalDocFields kind="driver_contract" draft={contract} onChange={setContract} title="The new contract — signed and stamped *" />
        {error && <div className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</div>}
        {!error && contractError && <p className="text-caption text-fg-muted">{contractError}</p>}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-muted">
          <p className="text-caption text-fg-muted">{CONTRACT_CAN_RETURN.find((c) => c.key === canReturn) ? `When it ended: ${CONTRACT_CAN_RETURN.find((c) => c.key === canReturn)!.label.toLowerCase()}` : ''}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">{saving ? 'Renewing…' : 'Renew contract'}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
