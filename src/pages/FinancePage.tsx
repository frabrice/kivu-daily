import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, Plus, LayoutDashboard, Receipt, Landmark,
  Users2, ClipboardCheck, Pencil, Trash2, Car, TrendingUp, TrendingDown, ShieldCheck,
} from 'lucide-react';
import {
  supabase, FinanceAccount, FinanceTransaction, FinanceTransactionType, FinanceDirection,
  FinanceTransactionStatus, FinanceReconciliation, PayrollRun, Driver, Vehicle, Profile, Document as Doc,
} from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { todayStr } from '../lib/utils';
import Modal from '../components/Modal';
import ViewToggle, { ViewMode } from '../components/ViewToggle';
import DataTable from '../components/DataTable';
import EntryActions from '../components/EntryActions';

type Tab = 'dashboard' | 'transactions' | 'accounts' | 'payroll' | 'reconciliation';

const WEEKLY_DEPOSIT_AMOUNT = 180000; // mirrors Fleet's driver_deposits weekly amount

const TYPE_META: Record<FinanceTransactionType, { label: string; defaultDirection: FinanceDirection }> = {
  revenue: { label: 'Revenue', defaultDirection: 'in' },
  fleet_collection: { label: 'Fleet Collection', defaultDirection: 'in' },
  vehicle_owner_payment: { label: 'Vehicle-Owner Payment', defaultDirection: 'out' },
  payroll: { label: 'Payroll', defaultDirection: 'out' },
  supplier_payment: { label: 'Supplier Payment', defaultDirection: 'out' },
  transfer: { label: 'Inter-Bank Transfer', defaultDirection: 'out' },
  expense_claim: { label: 'Expense Claim', defaultDirection: 'out' },
  other: { label: 'Other', defaultDirection: 'out' },
};

const STATUS_META: Record<FinanceTransactionStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#9ca3af' },
  checked: { label: 'Checked', color: '#f97316' },
  approved: { label: 'Approved', color: '#2F8C86' },
  posted: { label: 'Posted', color: '#4F7B3E' },
  rejected: { label: 'Rejected', color: '#ef4444' },
};

function fmt(n: number): string {
  return `${Math.round(n).toLocaleString()} RWF`;
}

interface TxDrawerState { tx: FinanceTransaction | null; startEditing: boolean }
interface ReconcileDrawerState { account: FinanceAccount; systemBalance: number }

export default function FinancePage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [reconciliations, setReconciliations] = useState<FinanceReconciliation[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  const [txDrawer, setTxDrawer] = useState<TxDrawerState | null>(null);
  const [reconcileDrawer, setReconcileDrawer] = useState<ReconcileDrawerState | null>(null);
  const [payrollDrawer, setPayrollDrawer] = useState<PayrollRun | 'new' | null>(null);
  const [txView, setTxView] = useState<ViewMode>('table');

  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';

  const load = useCallback(async () => {
    const [acc, tx, rec, pr, d, v, emp, docs] = await Promise.all([
      supabase.from('finance_accounts').select('*').order('key'),
      supabase
        .from('finance_transactions')
        .select('*, account:finance_accounts(*), linked_vehicle:vehicles(*), linked_driver:drivers(*), preparer:profiles!finance_transactions_prepared_by_fkey(*), checker:profiles!finance_transactions_checked_by_fkey(*), approver:profiles!finance_transactions_approved_by_fkey(*), supporting_document:documents(*)')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('finance_reconciliations').select('*, account:finance_accounts(*), reconciler:profiles(*)').order('period', { ascending: false }),
      supabase.from('payroll_runs').select('*, lines:payroll_lines(*, employee:profiles(*))').order('period', { ascending: false }),
      supabase.from('drivers').select('*, vehicle:vehicles(*)'),
      supabase.from('vehicles').select('*'),
      supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
      supabase.from('documents').select('*').order('created_at', { ascending: false }),
    ]);
    setAccounts((acc.data as FinanceAccount[]) ?? []);
    setTransactions((tx.data as FinanceTransaction[]) ?? []);
    setReconciliations((rec.data as FinanceReconciliation[]) ?? []);
    setPayrollRuns((pr.data as PayrollRun[]) ?? []);
    setDrivers((d.data as Driver[]) ?? []);
    setVehicles((v.data as Vehicle[]) ?? []);
    setEmployees((emp.data as Profile[]) ?? []);
    setDocuments((docs.data as Doc[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('finance-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_transactions' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_reconciliations' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_runs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_lines' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const accountBalance = useCallback(
    (accountId: string) => {
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc) return 0;
      let bal = acc.opening_balance;
      for (const t of transactions) {
        if (t.account_id !== accountId) continue;
        bal += t.direction === 'in' ? t.amount : -t.amount;
      }
      return bal;
    },
    [accounts, transactions]
  );

  const thisMonth = todayStr().slice(0, 7);
  const monthTx = useMemo(() => transactions.filter((t) => t.transaction_date.slice(0, 7) === thisMonth), [transactions, thisMonth]);

  const sumWhere = (rows: FinanceTransaction[], type: FinanceTransactionType | FinanceTransactionType[], direction: FinanceDirection) => {
    const types = Array.isArray(type) ? type : [type];
    return rows.filter((t) => types.includes(t.type) && t.direction === direction).reduce((s, t) => s + t.amount, 0);
  };

  const dashboard = useMemo(() => {
    const revenueIn = sumWhere(monthTx, 'revenue', 'in');
    const fleetIn = sumWhere(monthTx, 'fleet_collection', 'in');
    const ownerOut = sumWhere(monthTx, 'vehicle_owner_payment', 'out');
    const opexOut = sumWhere(monthTx, ['supplier_payment', 'payroll', 'expense_claim', 'other'], 'out');
    const netCashFlow = revenueIn + fleetIn - ownerOut - opexOut;

    const activeCars = vehicles.length;
    const operationalCars = vehicles.filter((v) => drivers.some((d) => d.vehicle_id === v.id)).length;
    const activeDrivers = drivers.filter((d) => d.stage !== 'inactive').length;

    const assignedDrivers = drivers.filter((d) => d.vehicle_id);
    let outstandingDriverCount = 0;
    for (const d of assignedDrivers) {
      const lastTx = transactions
        .filter((t) => t.type === 'fleet_collection' && t.linked_driver_id === d.id)
        .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))[0];
      const daysSince = lastTx ? Math.floor((new Date(todayStr()).getTime() - new Date(lastTx.transaction_date).getTime()) / 86400000) : Infinity;
      if (daysSince >= 7) outstandingDriverCount++;
    }
    const outstandingDriverAmount = outstandingDriverCount * WEEKLY_DEPOSIT_AMOUNT;

    const outstandingOwnerAmount = transactions
      .filter((t) => t.type === 'vehicle_owner_payment' && (t.status === 'pending' || t.status === 'checked'))
      .reduce((s, t) => s + t.amount, 0);

    return {
      revenueIn, fleetIn, ownerOut, opexOut, netCashFlow,
      activeCars, operationalCars, activeDrivers,
      outstandingDriverAmount, outstandingOwnerAmount,
    };
  }, [monthTx, vehicles, drivers, transactions]);

  const balances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of accounts) map[a.key] = accountBalance(a.id);
    return map;
  }, [accounts, accountBalance]);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit flex-wrap">
          <FinTabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')} icon={LayoutDashboard} label="Dashboard" />
          <FinTabButton active={tab === 'transactions'} onClick={() => setTab('transactions')} icon={Receipt} label="Transactions" />
          <FinTabButton active={tab === 'accounts'} onClick={() => setTab('accounts')} icon={Landmark} label="Accounts" />
          <FinTabButton active={tab === 'payroll'} onClick={() => setTab('payroll')} icon={Users2} label="Payroll" />
          <FinTabButton active={tab === 'reconciliation'} onClick={() => setTab('reconciliation')} icon={ClipboardCheck} label="Reconciliation" />
        </div>
        <div className="flex items-center gap-2">
          {tab === 'transactions' && <ViewToggle value={txView} onChange={setTxView} />}
          {canEdit && tab === 'transactions' && (
            <button onClick={() => setTxDrawer({ tx: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> New Transaction
            </button>
          )}
          {canEdit && tab === 'payroll' && (
            <button onClick={() => setPayrollDrawer('new')} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> New Payroll Run
            </button>
          )}
        </div>
      </div>

      {tab === 'dashboard' && (
        <DashboardTab dashboard={dashboard} balances={balances} thisMonth={thisMonth} />
      )}

      {tab === 'transactions' && (
        <TransactionsTab
          transactions={transactions}
          view={txView}
          canEdit={canEdit}
          onOpen={(tx, startEditing) => setTxDrawer({ tx, startEditing })}
        />
      )}

      {tab === 'accounts' && (
        <AccountsTab accounts={accounts} balances={balances} onReconcile={(a) => setReconcileDrawer({ account: a, systemBalance: accountBalance(a.id) })} />
      )}

      {tab === 'payroll' && (
        <PayrollTab runs={payrollRuns} canEdit={canEdit} onOpen={(r) => setPayrollDrawer(r)} />
      )}

      {tab === 'reconciliation' && (
        <ReconciliationTab reconciliations={reconciliations} />
      )}

      {txDrawer && (
        <TransactionDrawer
          tx={txDrawer.tx}
          startEditing={txDrawer.startEditing}
          accounts={accounts}
          drivers={drivers}
          vehicles={vehicles}
          documents={documents}
          canEdit={canEdit}
          onClose={() => setTxDrawer(null)}
          onSaved={load}
        />
      )}

      {reconcileDrawer && (
        <ReconcileDrawer
          account={reconcileDrawer.account}
          systemBalance={reconcileDrawer.systemBalance}
          onClose={() => setReconcileDrawer(null)}
          onSaved={load}
        />
      )}

      {payrollDrawer && (
        <PayrollDrawer
          run={payrollDrawer === 'new' ? null : payrollDrawer}
          employees={employees}
          accounts={accounts}
          canEdit={canEdit}
          onClose={() => setPayrollDrawer(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function FinTabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Wallet; label: string }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}

function KpiTile({ icon: Icon, label, value, tone }: { icon: typeof Wallet; label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-6 h-6 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
          <Icon size={12} className="text-brand-600 dark:text-brand-300" />
        </div>
        <p className="stat-label">{label}</p>
      </div>
      <p className={`text-xl font-bold leading-none ${tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-red-500' : ''}`}>{value}</p>
    </div>
  );
}

function DashboardTab({
  dashboard,
  balances,
  thisMonth,
}: {
  dashboard: {
    revenueIn: number; fleetIn: number; ownerOut: number; opexOut: number; netCashFlow: number;
    activeCars: number; operationalCars: number; activeDrivers: number;
    outstandingDriverAmount: number; outstandingOwnerAmount: number;
  };
  balances: Record<string, number>;
  thisMonth: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">Showing {thisMonth} · figures update live as transactions are logged</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Car} label="Active Cars" value={String(dashboard.activeCars)} />
        <KpiTile icon={Car} label="Operational Cars" value={String(dashboard.operationalCars)} />
        <KpiTile icon={Users2} label="Drivers" value={String(dashboard.activeDrivers)} />
        <KpiTile icon={dashboard.netCashFlow >= 0 ? TrendingUp : TrendingDown} label="Net Operating Cash Flow" value={fmt(dashboard.netCashFlow)} tone={dashboard.netCashFlow >= 0 ? 'positive' : 'negative'} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={ArrowDownCircle} label="Monthly Kivu Revenue" value={fmt(dashboard.revenueIn)} tone="positive" />
        <KpiTile icon={ArrowDownCircle} label="Fleet Collections" value={fmt(dashboard.fleetIn)} tone="positive" />
        <KpiTile icon={ArrowUpCircle} label="Vehicle-Owner Payments" value={fmt(dashboard.ownerOut)} tone="negative" />
        <KpiTile icon={ArrowUpCircle} label="Operating Expenses" value={fmt(dashboard.opexOut)} tone="negative" />
      </div>

      <div>
        <h3 className="section-title mb-2.5">Cash Position</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile icon={Landmark} label="Equity Balance" value={fmt(balances.equity ?? 0)} />
          <KpiTile icon={Landmark} label="Bank of Kigali Balance" value={fmt(balances.bank_of_kigali ?? 0)} />
          <KpiTile icon={Landmark} label="I&M Balance" value={fmt(balances.im_bank ?? 0)} />
          <KpiTile icon={Wallet} label="MoMo Balance" value={fmt(balances.momo ?? 0)} />
        </div>
      </div>

      <div>
        <h3 className="section-title mb-2.5">Needs Attention</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KpiTile icon={ArrowUpCircle} label="Outstanding Driver Payments" value={fmt(dashboard.outstandingDriverAmount)} tone={dashboard.outstandingDriverAmount > 0 ? 'negative' : undefined} />
          <KpiTile icon={ArrowUpCircle} label="Outstanding Owner Payments" value={fmt(dashboard.outstandingOwnerAmount)} tone={dashboard.outstandingOwnerAmount > 0 ? 'negative' : undefined} />
        </div>
      </div>
    </div>
  );
}

function TransactionsTab({
  transactions,
  view,
  canEdit,
  onOpen,
}: {
  transactions: FinanceTransaction[];
  view: ViewMode;
  canEdit: boolean;
  onOpen: (tx: FinanceTransaction, startEditing: boolean) => void;
}) {
  if (transactions.length === 0) {
    return (
      <div className="card p-12 text-center">
        <Receipt size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
        <p className="text-[13px] text-gray-400">No transactions logged yet.</p>
      </div>
    );
  }

  if (view === 'table') {
    return (
      <DataTable
        rows={transactions}
        keyFn={(t) => t.id}
        onRowClick={(t) => onOpen(t, false)}
        columns={[
          { header: 'Reference', render: (t) => <span className="font-mono text-[11px]">{t.reference}</span> },
          { header: 'Type', render: (t) => TYPE_META[t.type].label },
          { header: 'Account', render: (t) => t.account?.name ?? '—' },
          {
            header: 'Amount',
            render: (t) => (
              <span className={t.direction === 'in' ? 'text-positive font-medium' : 'text-red-500 font-medium'}>
                {t.direction === 'in' ? '+' : '−'}{fmt(t.amount)}
              </span>
            ),
          },
          { header: 'Date', render: (t) => t.transaction_date },
          {
            header: 'Status',
            render: (t) => (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_META[t.status].color}20`, color: STATUS_META[t.status].color }}>
                {STATUS_META[t.status].label}
              </span>
            ),
          },
          {
            header: '',
            className: 'text-right',
            render: (t) => <EntryActions onView={() => onOpen(t, false)} onEdit={() => onOpen(t, true)} canEdit={canEdit} />,
          },
        ]}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {transactions.map((t) => (
        <div key={t.id} onClick={() => onOpen(t, false)} className="card p-4 cursor-pointer hover:shadow-md hover:border-brand/30 transition-all">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="font-mono text-[10px] text-gray-400">{t.reference}</span>
            <EntryActions onView={() => onOpen(t, false)} onEdit={() => onOpen(t, true)} canEdit={canEdit} />
          </div>
          <p className={`text-lg font-bold ${t.direction === 'in' ? 'text-positive' : 'text-red-500'}`}>
            {t.direction === 'in' ? '+' : '−'}{fmt(t.amount)}
          </p>
          <p className="text-[12px] text-gray-600 dark:text-gray-300 mt-0.5">{TYPE_META[t.type].label} · {t.account?.name}</p>
          {t.counterparty && <p className="text-[11px] text-gray-400 mt-0.5">{t.counterparty}</p>}
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-gray-400">{t.transaction_date}</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_META[t.status].color}20`, color: STATUS_META[t.status].color }}>
              {STATUS_META[t.status].label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountsTab({
  accounts,
  balances,
  onReconcile,
}: {
  accounts: FinanceAccount[];
  balances: Record<string, number>;
  onReconcile: (a: FinanceAccount) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {accounts.map((a) => (
        <div key={a.id} className="card p-4">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div>
              <p className="text-[13px] font-semibold">{a.name}</p>
              <p className="text-[11px] text-gray-400">{a.bank_name}</p>
            </div>
            <button onClick={() => onReconcile(a)} className="btn-ghost flex items-center gap-1.5 shrink-0">
              <ShieldCheck size={13} /> Reconcile
            </button>
          </div>
          <p className="text-2xl font-bold mt-2">{fmt(balances[a.key] ?? 0)}</p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-2">{a.purpose}</p>
        </div>
      ))}
    </div>
  );
}

function PayrollTab({ runs, canEdit, onOpen }: { runs: PayrollRun[]; canEdit: boolean; onOpen: (r: PayrollRun) => void }) {
  if (runs.length === 0) {
    return (
      <div className="card p-12 text-center">
        <Users2 size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
        <p className="text-[13px] text-gray-400">No payroll runs yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {runs.map((r) => (
        <div key={r.id} onClick={() => onOpen(r)} className="card p-3.5 flex items-center gap-3 cursor-pointer hover:shadow-md hover:border-brand/30 transition-all">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium">{r.period}</p>
            <p className="text-[11px] text-gray-400">{r.lines?.length ?? 0} employee{(r.lines?.length ?? 0) === 1 ? '' : 's'}</p>
          </div>
          <p className="text-[13px] font-semibold">{fmt(r.total_amount)}</p>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-gray-500 capitalize">{r.status}</span>
          <EntryActions onView={() => onOpen(r)} onEdit={() => onOpen(r)} canEdit={canEdit} />
        </div>
      ))}
    </div>
  );
}

function ReconciliationTab({ reconciliations }: { reconciliations: FinanceReconciliation[] }) {
  if (reconciliations.length === 0) {
    return (
      <div className="card p-12 text-center">
        <ClipboardCheck size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
        <p className="text-[13px] text-gray-400">No reconciliations logged yet. Reconcile an account from the Accounts tab.</p>
      </div>
    );
  }
  return (
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
  );
}

function ReconcileDrawer({
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

function TransactionDrawer({
  tx,
  startEditing,
  accounts,
  drivers,
  vehicles,
  documents,
  canEdit,
  onClose,
  onSaved,
}: {
  tx: FinanceTransaction | null;
  startEditing: boolean;
  accounts: FinanceAccount[];
  drivers: Driver[];
  vehicles: Vehicle[];
  documents: Doc[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [type, setType] = useState<FinanceTransactionType>(tx?.type ?? 'revenue');
  const [direction, setDirection] = useState<FinanceDirection>(tx?.direction ?? TYPE_META[tx?.type ?? 'revenue'].defaultDirection);
  const [accountId, setAccountId] = useState(tx?.account_id ?? '');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  const [date, setDate] = useState(tx?.transaction_date ?? todayStr());
  const [counterparty, setCounterparty] = useState(tx?.counterparty ?? '');
  const [description, setDescription] = useState(tx?.description ?? '');
  const [linkedVehicleId, setLinkedVehicleId] = useState(tx?.linked_vehicle_id ?? '');
  const [linkedDriverId, setLinkedDriverId] = useState(tx?.linked_driver_id ?? '');
  const [supportingDocId, setSupportingDocId] = useState(tx?.supporting_document_id ?? '');
  const [status, setStatus] = useState<FinanceTransactionStatus>(tx?.status ?? 'pending');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isTransfer = type === 'transfer';

  const save = async () => {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0 || !date) return;
    if (isTransfer && (!accountId || !toAccountId || accountId === toAccountId)) return;
    if (!isTransfer && !accountId) return;

    setSaving(true);
    setError('');

    const basePayload = {
      transaction_date: date,
      description: description.trim() || null,
      counterparty: counterparty.trim() || null,
      linked_vehicle_id: linkedVehicleId || null,
      linked_driver_id: linkedDriverId || null,
      supporting_document_id: supportingDocId || null,
      status,
      updated_at: new Date().toISOString(),
      ...(status === 'checked' && tx?.status !== 'checked' ? { checked_by: profile!.id, checked_at: new Date().toISOString() } : {}),
      ...(status === 'approved' && tx?.status !== 'approved' ? { approved_by: profile!.id, approved_at: new Date().toISOString() } : {}),
    };

    if (tx) {
      const { error: err } = await supabase.from('finance_transactions').update({
        ...basePayload, type, account_id: accountId, direction, amount: numAmount,
      }).eq('id', tx.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else if (isTransfer) {
      const groupId = crypto.randomUUID();
      const { error: err } = await supabase.from('finance_transactions').insert([
        { ...basePayload, type: 'transfer', account_id: accountId, direction: 'out', amount: numAmount, transfer_group_id: groupId, prepared_by: profile!.id, created_by: profile!.id },
        { ...basePayload, type: 'transfer', account_id: toAccountId, direction: 'in', amount: numAmount, transfer_group_id: groupId, prepared_by: profile!.id, created_by: profile!.id },
      ]);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else {
      const { error: err } = await supabase.from('finance_transactions').insert({
        ...basePayload, type, account_id: accountId, direction, amount: numAmount, prepared_by: profile!.id, created_by: profile!.id,
      });
      setSaving(false);
      if (err) { setError(err.message); return; }
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!tx) return;
    setSaving(true);
    if (tx.transfer_group_id) {
      await supabase.from('finance_transactions').delete().eq('transfer_group_id', tx.transfer_group_id);
    } else {
      await supabase.from('finance_transactions').delete().eq('id', tx.id);
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={tx ? tx.reference : 'New Transaction'} subtitle={tx ? TYPE_META[tx.type].label : 'Every ledger row needs a real account and a purpose'} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Type</label>
          <select
            value={type}
            onChange={(e) => { const t = e.target.value as FinanceTransactionType; setType(t); setDirection(TYPE_META[t].defaultDirection); }}
            disabled={!editing || !!tx}
            className="input"
          >
            {(Object.keys(TYPE_META) as FinanceTransactionType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </select>
        </div>

        {isTransfer ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[12px] font-medium mb-1.5 text-gray-500">From Account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!editing || !!tx} className="input">
                <option value="">Select</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5 text-gray-500">To Account</label>
              <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} disabled={!editing || !!tx} className="input">
                <option value="">Select</option>
                {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!editing} className="input">
                <option value="">Select</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Direction</label>
              <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg">
                {(['in', 'out'] as FinanceDirection[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={!editing}
                    onClick={() => setDirection(d)}
                    className={`flex-1 px-2 py-1.5 rounded-md text-[12px] font-medium transition-all ${direction === d ? 'bg-white dark:bg-navy-800 shadow-sm' : 'text-gray-500'} ${d === 'in' ? 'text-positive' : 'text-red-500'}`}
                  >
                    {d === 'in' ? 'Cash In' : 'Cash Out'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Amount (RWF)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editing} className="input" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!editing} className="input" />
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Counterparty</label>
          <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} disabled={!editing} className="input" placeholder="Vehicle owner, supplier, employee…" />
        </div>

        {(type === 'vehicle_owner_payment' || type === 'fleet_collection') && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Vehicle</label>
              <select value={linkedVehicleId} onChange={(e) => setLinkedVehicleId(e.target.value)} disabled={!editing} className="input">
                <option value="">None</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Driver</label>
              <select value={linkedDriverId} onChange={(e) => setLinkedDriverId(e.target.value)} disabled={!editing} className="input">
                <option value="">None</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editing} rows={2} className="input resize-none" placeholder="Purpose of this transaction…" />
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Supporting Document</label>
          <select value={supportingDocId} onChange={(e) => setSupportingDocId(e.target.value)} disabled={!editing} className="input">
            <option value="">None linked</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as FinanceTransactionStatus)} disabled={!editing} className="input">
            {(Object.keys(STATUS_META) as FinanceTransactionStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>

        {tx && (
          <div className="text-[11px] text-gray-400 space-y-0.5 pt-1">
            {tx.preparer && <p>Prepared by {tx.preparer.full_name}</p>}
            {tx.checker && <p>Checked by {tx.checker.full_name}</p>}
            {tx.approver && <p>Approved by {tx.approver.full_name}</p>}
            {tx.system_generated && <p className="text-brand-600 dark:text-brand-300">Auto-posted from Fleet</p>}
          </div>
        )}

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {tx ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (tx ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !amount || !date} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : tx ? 'Save Changes' : 'Create Transaction'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && !tx?.system_generated && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PayrollDrawer({
  run,
  employees,
  accounts,
  canEdit,
  onClose,
  onSaved,
}: {
  run: PayrollRun | null;
  employees: Profile[];
  accounts: FinanceAccount[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(!run);
  const [period, setPeriod] = useState(run?.period ?? todayStr().slice(0, 7));
  const [lines, setLines] = useState<{ employee_id: string; gross_amount: string; deductions: string }[]>(
    run?.lines?.map((l) => ({ employee_id: l.employee_id, gross_amount: String(l.gross_amount), deductions: String(l.deductions) })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = lines.reduce((s, l) => s + (Number(l.gross_amount) - Number(l.deductions || 0)), 0);

  const addLine = () => setLines((prev) => [...prev, { employee_id: '', gross_amount: '', deductions: '0' }]);
  const updateLine = (i: number, patch: Partial<{ employee_id: string; gross_amount: string; deductions: string }>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const saveDraft = async () => {
    setSaving(true);
    setError('');
    const validLines = lines.filter((l) => l.employee_id && Number(l.gross_amount) > 0);
    if (validLines.length === 0) { setSaving(false); setError('Add at least one employee with a gross amount.'); return; }

    let runId = run?.id;
    if (!runId) {
      const { data, error: err } = await supabase.from('payroll_runs').insert({
        period, total_amount: total, prepared_by: profile!.id,
      }).select().single();
      if (err) { setSaving(false); setError(err.message); return; }
      runId = data!.id;
    } else {
      await supabase.from('payroll_runs').update({ total_amount: total, updated_at: new Date().toISOString() }).eq('id', runId);
      await supabase.from('payroll_lines').delete().eq('payroll_run_id', runId);
    }

    const { error: linesErr } = await supabase.from('payroll_lines').insert(
      validLines.map((l) => ({ payroll_run_id: runId, employee_id: l.employee_id, gross_amount: Number(l.gross_amount), deductions: Number(l.deductions || 0) }))
    );
    setSaving(false);
    if (linesErr) { setError(linesErr.message); return; }
    onSaved();
    onClose();
  };

  const approveAndPay = async () => {
    if (!run) return;
    setSaving(true);
    setError('');
    const equity = accounts.find((a) => a.key === 'equity');
    const im = accounts.find((a) => a.key === 'im_bank');
    if (!equity || !im) { setSaving(false); setError('Bank accounts not found.'); return; }

    const groupId = crypto.randomUUID();
    const { error: transferErr } = await supabase.from('finance_transactions').insert([
      { type: 'transfer', account_id: equity.id, direction: 'out', amount: run.total_amount, transaction_date: todayStr(), description: 'Payroll funding — ' + run.period, transfer_group_id: groupId, prepared_by: profile!.id, created_by: profile!.id, status: 'approved', approved_by: profile!.id, approved_at: new Date().toISOString() },
      { type: 'transfer', account_id: im.id, direction: 'in', amount: run.total_amount, transaction_date: todayStr(), description: 'Payroll funding — ' + run.period, transfer_group_id: groupId, prepared_by: profile!.id, created_by: profile!.id, status: 'approved', approved_by: profile!.id, approved_at: new Date().toISOString() },
    ]);
    if (transferErr) { setSaving(false); setError(transferErr.message); return; }

    const { data: payTx, error: payErr } = await supabase.from('finance_transactions').insert({
      type: 'payroll', account_id: im.id, direction: 'out', amount: run.total_amount, transaction_date: todayStr(),
      description: 'Payroll — ' + run.period, prepared_by: profile!.id, created_by: profile!.id,
      status: 'approved', approved_by: profile!.id, approved_at: new Date().toISOString(),
    }).select().single();
    if (payErr) { setSaving(false); setError(payErr.message); return; }

    await supabase.from('payroll_runs').update({
      status: 'paid', approved_by: profile!.id, finance_transaction_id: payTx!.id, updated_at: new Date().toISOString(),
    }).eq('id', run.id);

    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={run ? `Payroll — ${run.period}` : 'New Payroll Run'} subtitle="Funded Equity → I&M, paid from I&M" maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Period</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} disabled={!editing || !!run} className="input" />
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Employees</label>
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select value={l.employee_id} onChange={(e) => updateLine(i, { employee_id: e.target.value })} disabled={!editing} className="input flex-1">
                  <option value="">Select employee</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
                <input type="number" value={l.gross_amount} onChange={(e) => updateLine(i, { gross_amount: e.target.value })} disabled={!editing} placeholder="Gross" className="input w-28" />
                <input type="number" value={l.deductions} onChange={(e) => updateLine(i, { deductions: e.target.value })} disabled={!editing} placeholder="Deductions" className="input w-28" />
                {editing && (
                  <button type="button" onClick={() => removeLine(i)} className="shrink-0 text-gray-300 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {editing && (
              <button type="button" onClick={addLine} className="text-[12px] text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 pt-0.5">
                <Plus size={12} /> Add employee
              </button>
            )}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-white/5 flex items-center justify-between">
          <span className="text-[12px] text-gray-500">Total net payroll</span>
          <span className="text-[14px] font-semibold">{fmt(total)}</span>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          {run?.status === 'paid' ? (
            <p className="text-[12px] text-positive font-medium flex items-center gap-1.5"><ShieldCheck size={14} /> Paid</p>
          ) : editing ? (
            <div className="flex gap-2 ml-auto">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={saveDraft} disabled={saving} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
            </div>
          ) : (
            <div className="flex gap-2 ml-auto">
              {canEdit && <button onClick={() => setEditing(true)} className="btn-ghost flex items-center gap-1.5"><Pencil size={13} /> Edit</button>}
              {canEdit && (
                <button onClick={approveAndPay} disabled={saving} className="btn-primary disabled:opacity-50">
                  {saving ? 'Processing…' : 'Approve & Pay'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
