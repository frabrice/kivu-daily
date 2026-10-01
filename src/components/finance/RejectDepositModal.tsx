import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatDateLabelSafe } from '../../lib/fleet';
import Modal from '../Modal';

// Shared by Deposit Confirmations and Fleet Collections - both pages
// show the same underlying driver_deposits row (fleet_collection
// transactions are its auto-posted Finance mirror), so one reject flow
// covers wherever Finance spots a mistake, not just the confirmation
// queue. Only ever offered on a still-pending deposit - a confirmed one
// is money Finance has already verified as received, a different and
// far more consequential thing to undo than catching a mistake before
// it's confirmed. Deleting cascades to remove the mirrored Finance
// ledger row too (see reject_driver_deposit / source_deposit_id).
export default function RejectDepositModal({
  depositId, driverName, amount, date, onClose, onRejected,
}: {
  depositId: string;
  driverName: string;
  amount: number;
  date: string;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reject = async () => {
    setSaving(true);
    setError('');
    const { error: err } = await supabase.rpc('reject_driver_deposit', { p_deposit_id: depositId, p_reason: reason.trim() || null });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onRejected();
  };

  return (
    <Modal open onClose={onClose} title="Reject & Delete Deposit" subtitle={`${driverName} — ${amount.toLocaleString()} RWF on ${formatDateLabelSafe(date)}`} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">This permanently removes this deposit and its matching Finance record. Use this only if it's not true — a mistake, a duplicate, or otherwise never actually happened — not for a real payment that just needs a correction.</p>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Reason (optional)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input" placeholder="e.g. duplicate entry, logged by mistake…" />
        </div>
        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={reject} disabled={saving} className="bg-red-500 hover:bg-red-600 text-white text-[12px] font-medium px-3.5 py-2 rounded-lg disabled:opacity-50">
            {saving ? 'Deleting…' : 'Reject & Delete'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
