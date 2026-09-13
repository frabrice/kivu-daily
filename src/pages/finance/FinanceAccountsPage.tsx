import { useState } from 'react';
import { ShieldCheck, Landmark } from 'lucide-react';
import { FinanceAccount } from '../../lib/supabase';
import { useFinanceData, fmt } from '../../lib/finance';
import ReconcileDrawer from '../../components/finance/ReconcileDrawer';

export default function FinanceAccountsPage() {
  const { accounts, balances, accountBalance, loading, reload } = useFinanceData();
  const [reconcileAccount, setReconcileAccount] = useState<FinanceAccount | null>(null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Landmark size={16} className="text-brand-600 dark:text-brand-300" /> Bank Accounts</h2>
        <p className="text-[12px] text-gray-400 mt-0.5">The three principal accounts plus MoMo, each with a defined purpose. Balances update live from the ledger.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {accounts.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div>
                <p className="text-[13px] font-semibold">{a.name}</p>
                <p className="text-[11px] text-gray-400">{a.bank_name}</p>
              </div>
              <button onClick={() => setReconcileAccount(a)} className="btn-ghost flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                <ShieldCheck size={13} /> Reconcile
              </button>
            </div>
            <p className="text-2xl font-bold mt-2">{fmt(balances[a.key] ?? 0)}</p>
            <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-2">{a.purpose}</p>
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="card p-10 text-center col-span-full">
            <Landmark size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[13px] text-gray-400">No accounts set up yet.</p>
          </div>
        )}
      </div>

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
