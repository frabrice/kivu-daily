import { useState } from 'react';
import { supabase, Driver } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { todayStr } from '../../lib/utils';
import { WEEKLY_DEPOSIT_AMOUNT } from '../../lib/fleet';
import Modal from '../Modal';

export default function LogDepositDrawer({ driver, onClose, onSaved }: { driver: Driver; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [amount, setAmount] = useState(String(WEEKLY_DEPOSIT_AMOUNT));
  const [paidDate, setPaidDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0 || !paidDate) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('driver_deposits').insert({
      driver_id: driver.id,
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
    <Modal open onClose={onClose} title="Log Deposit" subtitle={driver.full_name} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Amount (RWF)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Date Paid</label>
          <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="input" />
          <p className="text-[11px] text-gray-400 mt-1">Their next deposit will be due 7 days after this date.</p>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !Number(amount) || !paidDate} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Log Deposit'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
