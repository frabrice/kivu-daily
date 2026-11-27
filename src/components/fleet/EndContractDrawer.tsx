import { useMemo, useState } from 'react';
import { ShieldAlert, Wallet } from 'lucide-react';
import { supabase, Driver, DriverDeposit, DriverFine, DriverFinePayment } from '../../lib/supabase';
import { todayStr } from '../../lib/utils';
import {
  CONTRACT_CAN_RETURN, CONTRACT_END_DECIDED_BY, CONTRACT_END_REASONS, contractSettlement, fineAmountPaid, formatDateLabelSafe, formatRwf, driverShiftShort,
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
  // The letter is optional (MD, 27 Nov 2026): the end date and the reason are
  // enough. Without it, the letter shows under Admin -> Missing until added.
  const letterError = letter.file ? draftError('driver_termination_letter', letter) : null;
  const myDeposits = useMemo(() => deposits.filter((d) => d.driver_id === driver.id), [deposits, driver.id]);
  const settle = useMemo(() => contractSettlement(driver, myDeposits, eventDate), [driver, myDeposits, eventDate]);
  const finesUnpaid = fines.filter((f) => f.driver_id === driver.id).reduce((s, f) => s + Math.max(0, f.amount - fineAmountPaid(f.id, finePayments)), 0);
  // Collateral (MD, 27 Nov 2026): given back unless they owe money, have
  // fines or damaged the car. Suggested: keep what they owe plus unpaid fines.
  const collateral = driver.collateral_settled_on ? 0 : Number(driver.collateral_amount ?? 0);
  const suggestedKeep = Math.min(collateral, settle.owes + finesUnpaid);
  const [keepText, setKeepText] = useState<string | null>(null);
  const keep = Math.min(collateral, Math.max(0, Number(keepText ?? suggestedKeep) || 0));
  const giveBack = collateral - keep;
  const [damageNote, setDamageNote] = useState('');
  const keepReason = [
    settle.owes > 0 ? `owed ${formatRwf(settle.owes)} for days driven` : '',
    finesUnpaid > 0 ? `unpaid fines ${formatRwf(finesUnpaid)}` : '',
    damageNote.trim(),
  ].filter(Boolean).join('; ');
  const collateralError = collateral > 0 && keep > 0 && !keepReason ? 'Say why part of the collateral is kept (for example: damage to the car).' : null;
  const canContinue = !!reasonKey && !!eventDate && (!isOther || !!otherReason.trim()) && !letterError && !collateralError;

  const save = async () => {
    if (!canContinue) return;
    setSaving(true);
    setError('');
    const p = {
      driver_id: driver.id, event_date: eventDate, reason_key: reasonKey, reason: finalReason, details: details.trim(),
      meta: {
        decided_by: decidedBy, can_return: canReturn, owed: settle.owes, credit: settle.credit, paid_through: settle.paidThrough, fines_unpaid: finesUnpaid,
        ...(collateral > 0 ? { collateral, collateral_returned: giveBack, collateral_kept: keep, collateral_kept_reason: keep > 0 ? keepReason : null } : {}),
      },
    };
    let err: { message: string } | null = null;
    if (letter.file) {
      // With a letter: uploaded first, then the contract ends and the letter is recorded in one step.
      const up = await uploadDraft('driver_termination_letter', driver.id, letter);
      if ('error' in up) { setSaving(false); setError(up.error); return; }
      ({ error: err } = await supabase.rpc('end_driver_contract_with_letter', { doc: up.doc, p }));
    } else {
      ({ error: err } = await supabase.rpc('end_driver_contract', { p }));
    }
    if (err) { setSaving(false); setError(err.message); return; }
    if (collateral > 0) {
      const { error: cErr } = await supabase.from('drivers').update({
        collateral_returned: giveBack, collateral_kept: keep, collateral_kept_reason: keep > 0 ? keepReason : null, collateral_settled_on: eventDate,
      }).eq('id', driver.id);
      if (cErr) { setSaving(false); onSaved(); setError(`The contract is ended, but the collateral decision wasn't saved: ${cErr.message}`); return; }
    }
    setSaving(false);
    // Also out of the Kivu Ride app: off the car and out of the fleet company,
    // so no more requests. If it fails (or the person isn't Fleet/MD), it
    // stays on Under Management > To confirm for Fleet.
    supabase.functions.invoke('fleet-sync', { body: { action: 'offboard', driver_id: driver.id } }).catch(() => null);
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
      {collateral > 0 && (
        <p className="pt-1 border-t border-line-muted">
          Collateral {formatRwf(collateral)}: <b className="text-success">give back {formatRwf(giveBack)}</b>
          {keep > 0 && <> · <b className="text-attention">keep {formatRwf(keep)}</b> ({keepReason || 'reason needed'})</>}
        </p>
      )}
    </div>
  );

  const collateralBox = collateral > 0 && (
    <div className="rounded-lg border border-line p-3 space-y-2 text-small">
      <p className="text-caption font-semibold text-fg-muted">Collateral held: {formatRwf(collateral)}</p>
      <p className="text-caption text-fg-muted">Given back in full unless they owe money, have unpaid fines or damaged the car.{suggestedKeep > 0 ? ` Suggested to keep ${formatRwf(suggestedKeep)} for what they owe.` : ''}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="block text-caption font-medium mb-1 text-fg-muted">Keep (RWF)</span>
          <input inputMode="numeric" value={keepText ?? String(suggestedKeep)} onChange={(e) => setKeepText(e.target.value.replace(/[^\d]/g, ''))} className="input" /></label>
        <div><span className="block text-caption font-medium mb-1 text-fg-muted">Give back</span><p className="input bg-inset font-semibold tabular-nums">{formatRwf(giveBack)}</p></div>
      </div>
      <label className="block"><span className="block text-caption font-medium mb-1 text-fg-muted">Damage or other reason to keep some (optional)</span>
        <input value={damageNote} onChange={(e) => setDamageNote(e.target.value)} className="input" placeholder="e.g. Scratches on the rear door, 40,000" /></label>
      {collateralError && <p className="text-caption text-attention">{collateralError}</p>}
    </div>
  );

  return (
    <Modal open onClose={onClose} title="End contract" subtitle={`${driver.full_name}${driver.vehicle ? ` · ${driver.vehicle.plate_number}` : ''}${driver.shift ? ` · ${driverShiftShort(driver)}` : ''}`} maxWidth="max-w-lg">
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
          {collateralBox}
          <label className="block">
            <span className="block text-caption font-medium mb-1.5 text-fg-muted">Notes (optional)</span>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} className="input resize-none" placeholder={canReturn === 'conditions' ? 'Under what conditions can they come back?' : 'Anything else worth knowing'} />
          </label>
          <LegalDocFields kind="driver_termination_letter" draft={letter} onChange={setLetter} title="Termination letter (optional — if you don't have it now, it shows under Admin → Missing)" />
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
          <p className="text-small">Termination letter: {letter.file ? <b>{letter.file.name}</b> : <span className="text-fg-muted">not attached — it will show under Admin → Missing</span>}</p>
          <p className="text-caption text-fg-muted">They move to Inactive and their seat on {driver.vehicle?.plate_number ?? 'their car'} becomes free for another driver. In the Kivu Ride app they are taken off the car and out of the fleet company (their account stays, so they get no requests). The contract can be renewed later from their page.</p>
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
