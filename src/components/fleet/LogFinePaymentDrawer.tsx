import { useState } from 'react';
import { supabase, DriverFine } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';
import DateInput from '../DateInput';

export default function LogFinePaymentDrawer({
  fine,
  remaining,
  onClose,
  onSaved,
}: {
  fine: DriverFine;
  remaining: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [amount, setAmount] = useState(String(remaining));
  const [paidDate, setPaidDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0 || !paidDate) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('driver_fine_payments').insert({
      fine_id: fine.id,
      amount: numAmount,
      paid_date: paidDate,
      created_by: profile!.id,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Log Fine Payment" subtitle={`${fine.driver?.full_name ?? 'Driver'} · ${fine.amount.toLocaleString()} RWF fine`} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Amount (RWF)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" autoFocus />
          <p className="text-[10px] text-gray-400 mt-1">{remaining.toLocaleString()} RWF still owed on this fine.</p>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Date Paid</label>
          <DateInput value={paidDate} onChange={setPaidDate} />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !Number(amount) || !paidDate} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Log Payment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
