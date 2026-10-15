import { useMemo, useState } from 'react';
import { ShieldAlert, Wallet } from 'lucide-react';
import { supabase, Driver, DriverDeposit, DriverFine, DriverFinePayment } from '../../lib/supabase';
import { todayStr } from '../../lib/utils';
import {
  CONTRACT_CAN_RETURN, CONTRACT_END_DECIDED_BY, CONTRACT_END_REASONS, contractSettlement, fineAmountPaid, formatDateLabelSafe, formatRwf, shiftLabel,
} from '../../lib/fleet';
import Modal from '../Modal';
import DateInput from '../DateInput';
import { LegalDocFields } from '../legal/LegalDocFields';
import { LegalDraft, draftError, emptyDraft, uploadDraft } from '../../lib/legalDocs';

const GROUPS = [...new Set(CONTRACT_END_REASONS.map((r) => r.group))];

// End a driver's contract: why (from a list), who decided, can they come
// back - and, worked out for you, what they still owe or had paid ahead
// (credit a renewal can carry over).
export default function EndContractDrawer({ driver, deposits = [], fines = [], finePayments = [], onClose, onSaved }: {
  driver: Driver; deposits?: DriverDeposit[]; fines?: DriverFine[]; finePayments?: DriverFinePayment[]; onClose: () => void; onSaved: () => void;
}) {
  const [reasonKey, setReasonKey] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [decidedBy, setDecidedBy] = useState<string>('kivu');
  const [canReturn, setCanReturn] = useState<string>('yes');
  const [eventDate, setEventDate] = useState(todayStr());
  const [details, setDetails] = useState('');
  const [letter, setLetter] = useState<LegalDraft>(emptyDraft(todayStr()));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isOther = reasonKey === 'other';
  const finalReason = isOther ? otherReason.trim() : CONTRACT_END_REASONS.find((r) => r.key === reasonKey)?.label ?? '';
  const letterError = draftError('driver_termination_letter', letter);
  const canContinue = !!reasonKey && !!eventDate && (!isOther || !!otherReason.trim()) && !letterError;
  const myDeposits = useMemo(() => deposits.filter((d) => d.driver_id === driver.id), [deposits, driver.id]);
  const settle = useMemo(() => contractSettlement(driver, myDeposits, eventDate), [driver, myDeposits, eventDate]);
  const finesUnpaid = fines.filter((f) => f.driver_id === driver.id).reduce((s, f) => s + Math.max(0, f.amount - fineAmountPaid(f.id, finePayments)), 0);

  const save = async () => {
    if (!canContinue) return;
    setSaving(true);
    setError('');
    // The letter is uploaded first, then the contract ends and the letter is
    // recorded in one step - one can't be saved without the other.
    const up = await uploadDraft('driver_termination_letter', driver.id, letter);
    if ('error' in up) { setSaving(false); setError(up.error); return; }
    const { error: err } = await supabase.rpc('end_driver_contract_with_letter', {
      doc: up.doc,
      p: {
        driver_id: driver.id, event_date: eventDate, reason_key: reasonKey, reason: finalReason, details: details.trim(),
        meta: { decided_by: decidedBy, can_return: canReturn, owed: settle.owes, credit: settle.credit, paid_through: settle.paidThrough, fines_unpaid: finesUnpaid },
      },
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const radio = (name: string, value: string, set: (v: string) => void, options: readonly { key: string; label: string }[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
      {options.map((o) => (
        <label key={o.key} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-small cursor-pointer ${value === o.key ? 'border-accent bg-accent/10 text-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>
          <input type="radio" name={name} checked={value === o.key} onChange={() => set(o.key)} className="accent-[rgb(var(--c-accent))]" />{o.label}
        </label>
      ))}
    </div>
  );

  const money = (
    <div className="rounded-lg border border-line bg-inset p-3 text-small space-y-1">
      <p className="text-caption font-semibold text-fg-muted flex items-center gap-1.5"><Wallet size={12} /> On {formatDateLabelSafe(eventDate)}</p>
      {settle.owes > 0 && <p className="text-danger font-medium">Still owes {formatRwf(settle.owes)} for days already driven</p>}
      {settle.credit > 0 && <p className="text-success font-medium">Paid {formatRwf(settle.credit)} ahead — kept as credit if the contract is renewed</p>}
      {settle.owes === 0 && settle.credit === 0 && <p>Fully paid up to the end date, nothing ahead.</p>}
      {finesUnpaid > 0 && <p className="text-attention">Unpaid fines: {formatRwf(finesUnpaid)}</p>}
      <p className="text-fg-muted">Paid in this contract: {formatRwf(settle.totalPaid)}{settle.paidThrough ? ` · paid through ${formatDateLabelSafe(settle.paidThrough)}` : ''}</p>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="End contract" subtitle={`${driver.full_name}${driver.vehicle ? ` · ${driver.vehicle.plate_number}` : ''}${driver.shift ? ` · ${shiftLabel(driver.shift)}` : ''}`} maxWidth="max-w-lg">
      {!confirming ? (
        <div className="space-y-4">
          <label className="block">
            <span className="block text-caption font-medium mb-1.5 text-fg-muted">Why is the contract ending?</span>
            <select value={reasonKey} onChange={(e) => setReasonKey(e.target.value)} className="input" autoFocus>
              <option value="" disabled>Choose a reason…</option>
              {GROUPS.map((g) => <optgroup key={g} label={g}>{CONTRACT_END_REASONS.filter((r) => r.group === g).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</optgroup>)}
            </select>
          </label>
          {isOther && (
            <label className="block">
              <span className="block text-caption font-medium mb-1.5 text-fg-muted">The reason</span>
              <input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} className="input" placeholder="What happened" />
            </label>
          )}
          <div><span className="block text-caption font-medium mb-1.5 text-fg-muted">Who decided?</span>{radio('decided', decidedBy, setDecidedBy, CONTRACT_END_DECIDED_BY)}</div>
          <div><span className="block text-caption font-medium mb-1.5 text-fg-muted">Can they come back later?</span>{radio('return', canReturn, setCanReturn, CONTRACT_CAN_RETURN)}</div>
          <label className="block">
            <span className="block text-caption font-medium mb-1.5 text-fg-muted">Last day of the contract</span>
            <DateInput value={eventDate} onChange={setEventDate} />
          </label>
          {money}
          <label className="block">
            <span className="block text-caption font-medium mb-1.5 text-fg-muted">Notes (optional)</span>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} className="input resize-none" placeholder={canReturn === 'conditions' ? 'Under what conditions can they come back?' : 'Anything else worth knowing'} />
          </label>
          <LegalDocFields kind="driver_termination_letter" draft={letter} onChange={setLetter} />
          {error && <div className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</div>}
          {!error && reasonKey && letterError && <p className="text-caption text-fg-muted">{letterError}</p>}
          <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={() => setConfirming(true)} disabled={!canContinue} className="btn-danger disabled:opacity-50">Continue</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg p-3.5 bg-danger-muted border border-danger/30 space-y-1.5">
            <p className="text-micro font-semibold uppercase tracking-wide text-danger flex items-center gap-1.5"><ShieldAlert size={12} /> Confirm ending this contract</p>
            <p className="text-body"><b>{driver.full_name}</b>'s contract ends on <b>{formatDateLabelSafe(eventDate)}</b>.</p>
            <p className="text-small text-fg-muted">Reason: {finalReason} · {CONTRACT_END_DECIDED_BY.find((d) => d.key === decidedBy)?.label} · Come back: {CONTRACT_CAN_RETURN.find((c) => c.key === canReturn)?.label}</p>
          </div>
          {money}
          <p className="text-small">Termination letter: <b>{letter.file?.name}</b></p>
          <p className="text-caption text-fg-muted">They move to Inactive and their seat on {driver.vehicle?.plate_number ?? 'their car'} becomes free for another driver. The contract can be renewed later from their page.</p>
          {error && <div className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</div>}
          <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
            <button onClick={() => setConfirming(false)} disabled={saving} className="btn-ghost">Back</button>
            <button onClick={save} disabled={saving} className="btn-primary !bg-danger disabled:opacity-50">{saving ? 'Ending…' : 'End contract'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
