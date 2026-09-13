import { useState } from 'react';
import { supabase, FinanceAccount } from '../../lib/supabase';
import { fmt } from '../../lib/finance';
import { useAuth } from '../../lib/auth';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';

export default function ReconcileDrawer({
  account,
  systemBalance,
  onClose,
  onSaved,
}: {
  account: FinanceAccount;
  systemBalance: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [period, setPeriod] = useState(todayStr().slice(0, 7));
  const [statementBalance, setStatementBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const variance = statementBalance ? Number(statementBalance) - systemBalance : null;

  const save = async () => {
    if (!statementBalance) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('finance_reconciliations').upsert({
      account_id: account.id,
      period,
      statement_balance: Number(statementBalance),
      system_balance: systemBalance,
      notes: notes.trim() || null,
      reconciled_by: profile!.id,
      reconciled_at: new Date().toISOString(),
    }, { onConflict: 'account_id,period' });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Reconcile ${account.name}`} subtitle={`System balance right now: ${fmt(systemBalance)}`} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Period</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Actual Bank Statement Balance (RWF)</label>
          <input type="number" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} className="input" autoFocus />
        </div>
        {variance !== null && (
          <div className={`p-2.5 rounded-lg text-[12px] font-medium ${variance === 0 ? 'bg-positive/10 text-positive' : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'}`}>
            Variance: {fmt(variance)} {variance === 0 ? '— matches the books' : '— investigate before closing'}
          </div>
        )}
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" placeholder="Explain any variance…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !statementBalance} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Reconciliation'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
