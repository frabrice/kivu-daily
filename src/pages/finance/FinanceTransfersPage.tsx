import { useState, useMemo } from 'react';
import { Plus, ArrowLeftRight, ListChecks, Clock3 } from 'lucide-react';
import { FinanceTransaction } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useFinanceData, STATUS_META, fmt } from '../../lib/finance';
import { todayStr } from '../../lib/utils';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import KpiTile from '../../components/KpiTile';
import FinanceTransactionDrawer from '../../components/finance/FinanceTransactionDrawer';

interface TransferGroup {
  groupId: string;
  outLeg: FinanceTransaction;
  inLeg: FinanceTransaction | null;
}

interface TxDrawerState { tx: FinanceTransaction | null; startEditing: boolean }

export default function FinanceTransfersPage() {
  const { profile } = useAuth();
  const { accounts, transactions, drivers, vehicles, documents, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const [drawer, setDrawer] = useState<TxDrawerState | null>(null);

  const groups = useMemo(() => {
    const transfers = transactions.filter((t) => t.type === 'transfer' && t.transfer_group_id);
    const byGroup = new Map<string, FinanceTransaction[]>();
    for (const t of transfers) {
      const arr = byGroup.get(t.transfer_group_id!) ?? [];
      arr.push(t);
      byGroup.set(t.transfer_group_id!, arr);
    }
    const result: TransferGroup[] = [];
    for (const [groupId, legs] of byGroup) {
      const outLeg = legs.find((l) => l.direction === 'out') ?? legs[0];
      const inLeg = legs.find((l) => l.direction === 'in') ?? null;
      result.push({ groupId, outLeg, inLeg });
    }
    return result.sort((a, b) => b.outLeg.transaction_date.localeCompare(a.outLeg.transaction_date));
  }, [transactions]);

  const thisMonth = todayStr().slice(0, 7);
  const monthGroups = groups.filter((g) => g.outLeg.transaction_date.slice(0, 7) === thisMonth);
  const monthTotal = monthGroups.reduce((s, g) => s + g.outLeg.amount, 0);
  const pendingCount = groups.filter((g) => g.outLeg.status === 'pending' || g.outLeg.status === 'checked').length;

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><ArrowLeftRight size={16} className="text-amber-600 dark:text-amber-300" /> Inter-Bank Transfers</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Internal movements between Kivu Ride's own accounts — never counted as revenue or expense.</p>
        </div>
        {canEdit && (
          <button onClick={() => setDrawer({ tx: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> New Transfer
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiTile icon={ArrowLeftRight} label="This Month" value={fmt(monthTotal)} color="amber" />
        <KpiTile icon={ListChecks} label="Total Logged" value={String(groups.length)} color="amber" />
        <KpiTile icon={Clock3} label="Awaiting Approval" value={String(pendingCount)} tone={pendingCount > 0 ? 'negative' : undefined} color="amber" />
      </div>

      {groups.length === 0 ? (
        <div className="card p-12 text-center">
          <ArrowLeftRight size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No inter-bank transfers logged yet.</p>
        </div>
      ) : (
        <DataTable
          rows={groups}
          keyFn={(g) => g.groupId}
          onRowClick={(g) => setDrawer({ tx: g.outLeg, startEditing: false })}
          columns={[
            { header: 'From', render: (g) => g.outLeg.account?.name ?? '—' },
            { header: 'To', render: (g) => g.inLeg?.account?.name ?? '—' },
            { header: 'Amount', render: (g) => <span className="font-medium">{fmt(g.outLeg.amount)}</span> },
            { header: 'Purpose', className: 'max-w-xs truncate', render: (g) => g.outLeg.description ?? '—' },
            { header: 'Date', render: (g) => g.outLeg.transaction_date },
            {
              header: 'Status',
              render: (g) => (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_META[g.outLeg.status].color}20`, color: STATUS_META[g.outLeg.status].color }}>
                  {STATUS_META[g.outLeg.status].label}
                </span>
              ),
            },
            {
              header: '',
              className: 'text-right',
              render: (g) => (
                <EntryActions
                  onView={() => setDrawer({ tx: g.outLeg, startEditing: false })}
                  onEdit={() => setDrawer({ tx: g.outLeg, startEditing: true })}
                  canEdit={canEdit}
                />
              ),
            },
          ]}
        />
      )}

      {drawer && (
        <FinanceTransactionDrawer
          tx={drawer.tx}
          startEditing={drawer.startEditing}
          fixedType="transfer"
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
