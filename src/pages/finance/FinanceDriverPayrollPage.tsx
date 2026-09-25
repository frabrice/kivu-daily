import { useMemo, useState } from 'react';
import { Wallet, Users2, Clock3, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFinanceData, DRIVER_MONTHLY_SALARY, STATUS_META, fmt, sumWhere } from '../../lib/finance';
import { supabase, Driver, FinanceTransaction } from '../../lib/supabase';
import { todayStr, dateStr, addMonths } from '../../lib/utils';
import { formatDateLabelSafe } from '../../lib/fleet';
import KpiTile from '../../components/KpiTile';
import DataTable from '../../components/DataTable';

// Drivers are paid a flat 150,000/month, counted from their own start
// date - not the shared Internal Payroll date, since each driver starts
// on a different day, and not initial_deposit_date either, which is
// accounting-only (confirming the money arrived) and no longer
// schedules anything. A driver whose contract ends just stops
// generating new months from that point on (sync_driver_payroll only
// ever loops over contract_status = 'active' drivers) - no partial
// final payment, they simply drop off.
function nextPayrollDate(driver: Driver, transactions: FinanceTransaction[]): string | null {
  if (!driver.start_date) return null;
  const existingCount = transactions.filter((t) => t.type === 'driver_payroll' && t.linked_driver_id === driver.id && t.system_generated).length;
  return dateStr(addMonths(new Date(`${driver.start_date}T00:00:00`), existingCount + 1));
}
export default function FinanceDriverPayrollPage() {
  const { profile } = useAuth();
  const { drivers, transactions, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const [payingId, setPayingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const onPayroll = useMemo(
    () => drivers.filter((d) => d.initial_deposit_paid && d.start_date && d.contract_status === 'active'),
    [drivers],
  );
  const rows = useMemo(() => transactions.filter((t) => t.type === 'driver_payroll'), [transactions]);
  const pendingRows = useMemo(() => rows.filter((t) => t.status === 'pending').sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)), [rows]);

  const thisMonth = todayStr().slice(0, 7);
  const pendingTotal = sumWhere(pendingRows, 'driver_payroll', 'out');
  const paidThisMonth = sumWhere(rows.filter((t) => t.status === 'posted' && t.transaction_date.slice(0, 7) === thisMonth), 'driver_payroll', 'out');

  const payDriver = async (txId: string) => {
    setPayingId(txId);
    setError('');
    const { error: err } = await supabase.rpc('mark_driver_payroll_paid', { p_transaction_id: txId });
    setPayingId(null);
    if (err) { setError(err.message); return; }
    reload();
  };

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Users2 size={16} className="text-amber-600 dark:text-amber-300" /> Driver Payroll</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Flat {fmt(DRIVER_MONTHLY_SALARY)}/month per driver, counted from their own start date — paid from I&M.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiTile icon={Users2} label="On Payroll" value={String(onPayroll.length)} color="amber" />
        <KpiTile icon={Clock3} label="Pending Payments" value={fmt(pendingTotal)} tone={pendingTotal > 0 ? 'negative' : undefined} color="amber" />
        <KpiTile icon={Wallet} label="Paid This Month" value={fmt(paidThisMonth)} tone="positive" color="amber" />
      </div>

      {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Pending Payments</p>
        <DataTable
          rows={pendingRows}
          keyFn={(t) => t.id}
          emptyLabel="Nothing pending right now."
          columns={[
            { header: 'Driver', render: (t) => t.linked_driver?.full_name ?? t.description?.replace('Driver payroll — ', '') ?? '—' },
            { header: 'Due Date', render: (t) => formatDateLabelSafe(t.transaction_date) },
            { header: 'Amount', render: (t) => <span className="font-medium">−{fmt(t.amount)}</span> },
            {
              header: '',
              className: 'text-right',
              render: (t) => canEdit ? (
                <button onClick={() => payDriver(t.id)} disabled={payingId === t.id} className="btn-primary text-[11px] px-2.5 py-1.5 disabled:opacity-50">
                  {payingId === t.id ? 'Confirming…' : 'Confirm Paid'}
                </button>
              ) : null,
            },
          ]}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Drivers on Payroll</p>
        <DataTable
          rows={onPayroll}
          keyFn={(d) => d.id}
          emptyLabel="No drivers on payroll yet."
          columns={[
            { header: 'Driver', render: (d) => d.full_name },
            { header: 'Start Date', render: (d) => (d.start_date ? formatDateLabelSafe(d.start_date) : '—') },
            {
              header: 'Next Payment',
              render: (d) => {
                const next = nextPayrollDate(d, transactions);
                return next ? formatDateLabelSafe(next) : '—';
              },
            },
            {
              header: 'Paid To Date',
              render: (d) => {
                const paid = rows.filter((t) => t.linked_driver_id === d.id && t.status === 'posted').reduce((s, t) => s + t.amount, 0);
                return fmt(paid);
              },
            },
          ]}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Payment History</p>
        <DataTable
          rows={rows.filter((t) => t.status === 'posted').sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))}
          keyFn={(t) => t.id}
          emptyLabel="No driver payroll paid yet."
          columns={[
            { header: 'Driver', render: (t) => t.linked_driver?.full_name ?? '—' },
            { header: 'Date', render: (t) => formatDateLabelSafe(t.transaction_date) },
            { header: 'Amount', render: (t) => <span className="font-medium">−{fmt(t.amount)}</span> },
            {
              header: 'Status',
              render: (t) => (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1 w-fit" style={{ backgroundColor: `${STATUS_META[t.status].color}20`, color: STATUS_META[t.status].color }}>
                  <CheckCircle2 size={9} /> {STATUS_META[t.status].label}
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
