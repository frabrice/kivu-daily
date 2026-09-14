import { useState, useMemo } from 'react';
import { Plus, LucideIcon, Clock3, ListChecks } from 'lucide-react';
import { FinanceTransaction, FinanceTransactionType } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useFinanceData, TYPE_META, STATUS_META, fmt, sumWhere } from '../../lib/finance';
import { todayStr } from '../../lib/utils';
import ViewToggle, { ViewMode } from '../ViewToggle';
import DataTable from '../DataTable';
import EntryActions from '../EntryActions';
import KpiTile from '../KpiTile';
import FinanceTransactionDrawer from './FinanceTransactionDrawer';

interface TransactionTypePageProps {
  type: FinanceTransactionType;
  title: string;
  icon: LucideIcon;
  description: string;
  emptyText: string;
}

interface TxDrawerState { tx: FinanceTransaction | null; startEditing: boolean }

export default function TransactionTypePage({ type, title, icon: Icon, description, emptyText }: TransactionTypePageProps) {
  const { profile } = useAuth();
  const { accounts, transactions, drivers, vehicles, documents, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const [view, setView] = useState<ViewMode>('table');
  const [drawer, setDrawer] = useState<TxDrawerState | null>(null);

  const rows = useMemo(() => transactions.filter((t) => t.type === type), [transactions, type]);
  const direction = TYPE_META[type].defaultDirection;

  const thisMonth = todayStr().slice(0, 7);
  const monthRows = rows.filter((t) => t.transaction_date.slice(0, 7) === thisMonth);
  const monthTotal = sumWhere(monthRows, type, direction);
  const pendingCount = rows.filter((t) => t.status === 'pending' || t.status === 'checked').length;

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Icon size={16} className="text-amber-600 dark:text-amber-300" /> {title}</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          {canEdit && (
            <button onClick={() => setDrawer({ tx: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> New {title.replace(/s$/, '')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiTile icon={Icon} label={`This Month (${direction === 'in' ? 'Received' : 'Paid'})`} value={fmt(monthTotal)} tone={direction === 'in' ? 'positive' : 'negative'} color="amber" />
        <KpiTile icon={ListChecks} label="Total Logged" value={String(rows.length)} color="amber" />
        <KpiTile icon={Clock3} label="Awaiting Approval" value={String(pendingCount)} tone={pendingCount > 0 ? 'negative' : undefined} color="amber" />
      </div>

      {rows.length === 0 && (
        <div className="card p-12 text-center">
          <Icon size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">{emptyText}</p>
        </div>
      )}

      {rows.length > 0 && view === 'table' && (
        <DataTable
          rows={rows}
          keyFn={(t) => t.id}
          onRowClick={(t) => setDrawer({ tx: t, startEditing: false })}
          columns={[
            { header: 'Reference', render: (t) => <span className="font-mono text-[10px]">{t.reference}</span> },
            { header: 'Account', render: (t) => t.account?.name ?? '—' },
            { header: 'Counterparty', render: (t) => t.counterparty ?? '—' },
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
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_META[t.status].color}20`, color: STATUS_META[t.status].color }}>
                  {STATUS_META[t.status].label}
                </span>
              ),
            },
            {
              header: '',
              className: 'text-right',
              render: (t) => <EntryActions onView={() => setDrawer({ tx: t, startEditing: false })} onEdit={() => setDrawer({ tx: t, startEditing: true })} canEdit={canEdit} />,
            },
          ]}
        />
      )}

      {rows.length > 0 && view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((t) => (
            <div key={t.id} onClick={() => setDrawer({ tx: t, startEditing: false })} className="card p-4 cursor-pointer hover:shadow-md hover:border-brand/30 transition-all">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="font-mono text-[9px] text-gray-400">{t.reference}</span>
                <EntryActions onView={() => setDrawer({ tx: t, startEditing: false })} onEdit={() => setDrawer({ tx: t, startEditing: true })} canEdit={canEdit} />
              </div>
              <p className={`text-lg font-bold ${t.direction === 'in' ? 'text-positive' : 'text-red-500'}`}>
                {t.direction === 'in' ? '+' : '−'}{fmt(t.amount)}
              </p>
              <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">{t.account?.name}</p>
              {t.counterparty && <p className="text-[10px] text-gray-400 mt-0.5">{t.counterparty}</p>}
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-gray-400">{t.transaction_date}</span>
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_META[t.status].color}20`, color: STATUS_META[t.status].color }}>
                  {STATUS_META[t.status].label}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {drawer && (
        <FinanceTransactionDrawer
          tx={drawer.tx}
          startEditing={drawer.startEditing}
          fixedType={type}
          accounts={accounts}
          drivers={drivers}
          vehicles={vehicles}
          documents={documents}
          canEdit={canEdit}
          onClose={() => setDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
