import { useState } from 'react';
import {
  LayoutDashboard, TrendingUp, Wallet, Users2, Truck, ArrowLeftRight, Receipt, Landmark, ClipboardCheck, ShieldCheck,
} from 'lucide-react';
import FinanceDashboardPage from './finance/FinanceDashboardPage';
import FinanceRevenuePage from './finance/FinanceRevenuePage';
import FinanceFleetCollectionsPage from './finance/FinanceFleetCollectionsPage';
import FinancePayrollPage from './finance/FinancePayrollPage';
import FinanceSuppliersPage from './finance/FinanceSuppliersPage';
import FinanceTransfersPage from './finance/FinanceTransfersPage';
import FinanceExpenseClaimsPage from './finance/FinanceExpenseClaimsPage';
import FinanceAccountsPage from './finance/FinanceAccountsPage';
import FinanceReconciliationPage from './finance/FinanceReconciliationPage';
import FinanceDepositConfirmationsPage from './finance/FinanceDepositConfirmationsPage';

// MD-only: Finance employees see all these as separate sidebar pages
// (src/pages/finance/*); the MD sees them bundled as tabs here, since a
// fully expanded sidebar for every department at once would be
// unmanageable for the one role that already sees everything. Vehicle
// Owners is the one exception - promoted to its own top-level nav item
// (see ManagingDirectorApp.tsx) rather than a tab buried in here, since
// it's grown into its own body of work, not just another ledger page.
type Tab =
  | 'dashboard' | 'revenue' | 'fleet_collections' | 'payroll'
  | 'suppliers' | 'transfers' | 'expense_claims' | 'accounts' | 'reconciliation' | 'deposit_confirmations';

const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'revenue', label: 'Revenue', icon: TrendingUp },
  { key: 'fleet_collections', label: 'Fleet Collections', icon: Wallet },
  { key: 'deposit_confirmations', label: 'Deposit Confirmations', icon: ShieldCheck },
  { key: 'payroll', label: 'Payroll', icon: Users2 },
  { key: 'suppliers', label: 'Supplier Payments', icon: Truck },
  { key: 'transfers', label: 'Inter-Bank Transfers', icon: ArrowLeftRight },
  { key: 'expense_claims', label: 'Expense Claims', icon: Receipt },
  { key: 'accounts', label: 'Bank Accounts', icon: Landmark },
  { key: 'reconciliation', label: 'Reconciliation', icon: ClipboardCheck },
];

export default function FinanceDeptPage() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem('kivu-active-nav-finance-tab');
      if (saved) return saved as Tab;
    } catch { /* ignore */ }
    return 'dashboard';
  });

  const selectTab = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem('kivu-active-nav-finance-tab', t); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => selectTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${tab === t.key ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <FinanceDashboardPage />}
      {tab === 'revenue' && <FinanceRevenuePage />}
      {tab === 'fleet_collections' && <FinanceFleetCollectionsPage />}
      {tab === 'deposit_confirmations' && <FinanceDepositConfirmationsPage />}
      {tab === 'payroll' && <FinancePayrollPage />}
      {tab === 'suppliers' && <FinanceSuppliersPage />}
      {tab === 'transfers' && <FinanceTransfersPage />}
      {tab === 'expense_claims' && <FinanceExpenseClaimsPage />}
      {tab === 'accounts' && <FinanceAccountsPage />}
      {tab === 'reconciliation' && <FinanceReconciliationPage />}
    </div>
  );
}
