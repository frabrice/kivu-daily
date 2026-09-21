import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { supabase, Driver } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { todayStr } from '../../lib/utils';
import { CONTRACT_END_REASONS, formatDateLabelSafe } from '../../lib/fleet';
import Modal from '../Modal';
import DateInput from '../DateInput';

export default function EndContractDrawer({ driver, onClose, onSaved }: { driver: Driver; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [reasonKey, setReasonKey] = useState(CONTRACT_END_REASONS[0].key);
  const [otherReason, setOtherReason] = useState('');
  const [eventDate, setEventDate] = useState(todayStr());
  const [details, setDetails] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isOther = reasonKey === 'other';
  const finalReason = isOther ? otherReason.trim() : CONTRACT_END_REASONS.find((r) => r.key === reasonKey)?.label ?? reasonKey;
  const canContinue = !!eventDate && (!isOther || !!otherReason.trim());

  const save = async () => {
    if (!canContinue || !profile) return;
    setSaving(true);
    setError('');
    const { error: eventErr } = await supabase.from('driver_contract_events').insert({
      driver_id: driver.id,
      event_type: 'ended',
      reason: finalReason,
      details: details.trim() || null,
      event_date: eventDate,
      created_by: profile.id,
    });
    if (eventErr) { setSaving(false); setError(eventErr.message); return; }
    const { error: driverErr } = await supabase.from('drivers').update({
      contract_status: 'ended',
      stage: 'inactive',
      // Frees the seat immediately - the car should show one driver (or
      // none, if both shifts have ended) rather than a terminated driver
      // still occupying a shift that's actually open.
      vehicle_id: null,
      shift: null,
      updated_at: new Date().toISOString(),
    }).eq('id', driver.id);
    setSaving(false);
    if (driverErr) { setError(driverErr.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="End Contract" subtitle={driver.full_name} maxWidth="max-w-md">
      {!confirming ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Reason</label>
            <select value={reasonKey} onChange={(e) => setReasonKey(e.target.value)} className="input">
              {CONTRACT_END_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          {isOther && (
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Specify reason</label>
              <input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} className="input" placeholder="e.g. Relocated to another city" autoFocus />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Date Ending</label>
            <DateInput value={eventDate} onChange={setEventDate} />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Additional notes (optional)</label>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} className="input resize-none" placeholder="Any extra context…" />
          </div>

          {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={() => setConfirming(true)} disabled={!canContinue} className="btn-primary disabled:opacity-50 bg-red-500 hover:bg-red-600">
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card p-3.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 flex items-center gap-1.5"><ShieldAlert size={12} /> Confirm ending this contract</p>
            <p className="text-[13px]"><span className="font-semibold">{driver.full_name}</span>'s contract will end on <span className="font-semibold">{formatDateLabelSafe(eventDate)}</span></p>
            <p className="text-[12px] text-gray-600 dark:text-gray-300">Reason: {finalReason}</p>
          </div>
          <p className="text-[10px] text-gray-400">This moves them to Inactive in the pipeline and frees their seat on {driver.vehicle?.plate_number ?? 'their vehicle'} for a new driver. They can be reactivated later with a reason of their own.</p>

          {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={() => setConfirming(false)} disabled={saving} className="btn-ghost">Back</button>
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50 bg-red-500 hover:bg-red-600">
              {saving ? 'Ending…' : 'Confirm & End Contract'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
