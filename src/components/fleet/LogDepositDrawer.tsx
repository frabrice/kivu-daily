import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { supabase, Driver } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { todayStr } from '../../lib/utils';
import { WEEKLY_DEPOSIT_AMOUNT, formatDateLabelSafe } from '../../lib/fleet';
import Modal from '../Modal';
import DateInput from '../DateInput';

export default function LogDepositDrawer({ driver, onClose, onSaved }: { driver: Driver; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [amount, setAmount] = useState(String(WEEKLY_DEPOSIT_AMOUNT));
  const [paidDate, setPaidDate] = useState(todayStr());
  const [confirming, setConfirming] = useState(false);
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
      {!confirming ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Amount (RWF)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Date Paid</label>
            <DateInput value={paidDate} onChange={setPaidDate} />
            <p className="text-[10px] text-gray-400 mt-1">Their next deposit will be due 7 days after this date.</p>
          </div>

          {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={() => setConfirming(true)} disabled={!Number(amount) || !paidDate} className="btn-primary disabled:opacity-50">
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card p-3.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><ShieldCheck size={12} /> Confirm this deposit</p>
            <p className="text-[13px]"><span className="font-semibold">{Number(amount).toLocaleString()} RWF</span> for <span className="font-semibold">{driver.full_name}</span></p>
            <p className="text-[12px] text-gray-500 dark:text-gray-400">Paid on {formatDateLabelSafe(paidDate)}</p>
          </div>
          <p className="text-[10px] text-gray-400">This logs one week's deposit and can't be logged again until the next one is due.</p>

          {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={() => setConfirming(false)} disabled={saving} className="btn-ghost">Back</button>
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Confirm & Log Deposit'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
