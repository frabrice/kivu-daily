import { useMemo } from 'react';
import { LayoutDashboard, Car, Users2, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle, Landmark, Wallet } from 'lucide-react';
import { useFinanceData, sumWhere, fmt, WEEKLY_DEPOSIT_AMOUNT } from '../../lib/finance';
import { todayStr } from '../../lib/utils';
import KpiTile from '../../components/KpiTile';

export default function FinanceDashboardPage() {
  const { accounts, transactions, drivers, vehicles, balances, loading } = useFinanceData();

  const thisMonth = todayStr().slice(0, 7);
  const monthTx = useMemo(() => transactions.filter((t) => t.transaction_date.slice(0, 7) === thisMonth), [transactions, thisMonth]);

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

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><LayoutDashboard size={16} className="text-brand-600 dark:text-brand-300" /> Finance Dashboard</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Showing {thisMonth} · figures update live as transactions are logged across every Finance page</p>
      </div>

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

      {accounts.length === 0 && (
        <p className="text-[12px] text-gray-400 text-center pt-2">No bank accounts set up yet — add them from the Accounts page.</p>
      )}
    </div>
  );
}
