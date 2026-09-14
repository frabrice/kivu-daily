import { useState } from 'react';
import { ClipboardCheck, Plus } from 'lucide-react';
import { FinanceAccount } from '../../lib/supabase';
import { useFinanceData, fmt } from '../../lib/finance';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import ReconcileDrawer from '../../components/finance/ReconcileDrawer';

export default function FinanceReconciliationPage() {
  const { accounts, reconciliations, accountBalance, loading, reload } = useFinanceData();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reconcileAccount, setReconcileAccount] = useState<FinanceAccount | null>(null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><ClipboardCheck size={16} className="text-amber-600 dark:text-amber-300" /> Bank Reconciliation</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Every account reconciled against its actual bank statement, at least monthly.</p>
        </div>
        <button onClick={() => setPickerOpen(true)} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
          <Plus size={14} /> New Reconciliation
        </button>
      </div>

      {reconciliations.length === 0 ? (
        <div className="card p-12 text-center">
          <ClipboardCheck size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No reconciliations logged yet.</p>
        </div>
      ) : (
        <DataTable
          rows={reconciliations}
          keyFn={(r) => r.id}
          columns={[
            { header: 'Account', render: (r) => <span className="font-medium">{r.account?.name ?? '—'}</span> },
            { header: 'Period', render: (r) => r.period },
            { header: 'Statement Balance', render: (r) => fmt(r.statement_balance) },
            { header: 'System Balance', render: (r) => fmt(r.system_balance) },
            {
              header: 'Variance',
              render: (r) => <span className={r.variance === 0 ? 'text-positive' : 'text-red-500'}>{fmt(r.variance)}</span>,
            },
            { header: 'Reconciled By', render: (r) => r.reconciler?.full_name ?? 'Unknown' },
          ]}
        />
      )}

      {pickerOpen && (
        <Modal open onClose={() => setPickerOpen(false)} title="Reconcile Which Account?" maxWidth="max-w-sm">
          <div className="space-y-1.5">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => { setReconcileAccount(a); setPickerOpen(false); }}
                className="w-full card p-3 text-left hover:shadow-md hover:border-brand/30 transition-all flex items-center justify-between"
              >
                <span className="text-[12px] font-medium">{a.name}</span>
                <span className="text-[11px] text-gray-400">{fmt(accountBalance(a.id))}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {reconcileAccount && (
        <ReconcileDrawer
          account={reconcileAccount}
          systemBalance={accountBalance(reconcileAccount.id)}
          onClose={() => setReconcileAccount(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
