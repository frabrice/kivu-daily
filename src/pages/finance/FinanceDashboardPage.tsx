import { useMemo } from 'react';
import { LayoutDashboard, Car, Users2, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle, Landmark, Wallet, PiggyBank, Handshake } from 'lucide-react';
import { useFinanceData, sumWhere, fmt, KIVU_REVENUE_TYPES } from '../../lib/finance';
import { effectiveStage, computeDepositWaterfall, depositDaysSince } from '../../lib/fleet';
import { todayStr } from '../../lib/utils';
import KpiTile from '../../components/KpiTile';

export default function FinanceDashboardPage() {
  const { accounts, transactions, drivers, deposits, vehicles, balances, loading } = useFinanceData();

  const thisMonth = todayStr().slice(0, 7);
  const monthTx = useMemo(() => transactions.filter((t) => t.transaction_date.slice(0, 7) === thisMonth), [transactions, thisMonth]);

  const dashboard = useMemo(() => {
    const revenueIn = sumWhere(monthTx, KIVU_REVENUE_TYPES, 'in');
    const fleetIn = sumWhere(monthTx, 'fleet_collection', 'in');
    const ownerOut = sumWhere(monthTx, 'vehicle_owner_payment', 'out');
    const opexOut = sumWhere(monthTx, ['supplier_payment', 'payroll', 'expense_claim', 'other'], 'out');
    const netCashFlow = revenueIn + fleetIn - ownerOut - opexOut;

    const managementMarginMonth = sumWhere(monthTx, 'management_margin', 'in');
    const onboardingRevenueMonth = sumWhere(monthTx, 'onboarding_fee', 'in');
    const managedCars = vehicles.filter((v) => v.owner_id).length;
    const pendingOwnerPayments = transactions.filter((t) => t.type === 'vehicle_owner_payment' && t.status === 'pending').reduce((s, t) => s + t.amount, 0);

    const activeCars = vehicles.length;
    const operationalCars = vehicles.filter((v) => drivers.some((d) => d.vehicle_id === v.id)).length;
    const activeDrivers = drivers.filter((d) => effectiveStage(d) === 'active').length;

    // Same waterfall Fleet's own Deposits page uses, so "what's owed"
    // agrees everywhere instead of this page's own flatter estimate
    // (driver hasn't paid in 7+ days x a flat weekly amount) drifting
    // from what installments/rollover credit actually leave outstanding.
    let outstandingDriverCount = 0;
    let outstandingDriverAmount = 0;
    for (const d of drivers.filter((dr) => dr.vehicle_id && dr.contract_status !== 'ended')) {
      const driverDeposits = deposits.filter((dep) => dep.driver_id === d.id);
      const wf = computeDepositWaterfall(d.initial_deposit_paid, d.initial_deposit_date, d.initial_deposit_amount, driverDeposits);
      const daysSince = depositDaysSince(wf.currentAnchor);
      if (daysSince === null || daysSince >= 7) {
        outstandingDriverCount++;
        outstandingDriverAmount += wf.currentRemaining;
      }
    }

    const outstandingOwnerAmount = transactions
      .filter((t) => t.type === 'vehicle_owner_payment' && (t.status === 'pending' || t.status === 'checked'))
      .reduce((s, t) => s + t.amount, 0);

    return {
      revenueIn, fleetIn, ownerOut, opexOut, netCashFlow,
      managementMarginMonth, onboardingRevenueMonth, managedCars, pendingOwnerPayments,
      activeCars, operationalCars, activeDrivers,
      outstandingDriverCount, outstandingDriverAmount, outstandingOwnerAmount,
    };
  }, [monthTx, vehicles, drivers, deposits, transactions]);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><LayoutDashboard size={16} className="text-amber-600 dark:text-amber-300" /> Finance Dashboard</h2>
        <p className="text-[10px] text-gray-400 mt-0.5">Showing {thisMonth} · figures update live as transactions are logged across every Finance page</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Car} label="Active Cars" value={String(dashboard.activeCars)} color="amber" />
        <KpiTile icon={Car} label="Operational Cars" value={String(dashboard.operationalCars)} color="amber" />
        <KpiTile icon={Users2} label="Drivers" value={String(dashboard.activeDrivers)} color="amber" />
        <KpiTile icon={dashboard.netCashFlow >= 0 ? TrendingUp : TrendingDown} label="Net Operating Cash Flow" value={fmt(dashboard.netCashFlow)} tone={dashboard.netCashFlow >= 0 ? 'positive' : 'negative'} color="amber" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={ArrowDownCircle} label="Monthly Kivu Revenue" value={fmt(dashboard.revenueIn)} tone="positive" color="amber" />
        <KpiTile icon={ArrowDownCircle} label="Fleet Collections" value={fmt(dashboard.fleetIn)} tone="positive" color="amber" />
        <KpiTile icon={ArrowUpCircle} label="Vehicle-Owner Payments" value={fmt(dashboard.ownerOut)} tone="negative" color="amber" />
        <KpiTile icon={ArrowUpCircle} label="Operating Expenses" value={fmt(dashboard.opexOut)} tone="negative" color="amber" />
      </div>

      <div>
        <h3 className="section-title mb-2.5">Car Management</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile icon={Handshake} label="Management Margin (MTD)" value={fmt(dashboard.managementMarginMonth)} tone="positive" color="amber" />
          <KpiTile icon={PiggyBank} label="Onboarding Revenue (MTD)" value={fmt(dashboard.onboardingRevenueMonth)} tone="positive" color="amber" />
          <KpiTile icon={Car} label="Managed Cars" value={String(dashboard.managedCars)} color="amber" />
          <KpiTile icon={Wallet} label="Pending Owner Payments" value={fmt(dashboard.pendingOwnerPayments)} tone={dashboard.pendingOwnerPayments > 0 ? 'negative' : undefined} color="amber" />
        </div>
      </div>

      <div>
        <h3 className="section-title mb-2.5">Cash Position</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile icon={Landmark} label="Equity Balance" value={fmt(balances.equity ?? 0)} color="amber" />
          <KpiTile icon={Landmark} label="Bank of Kigali Balance" value={fmt(balances.bank_of_kigali ?? 0)} color="amber" />
          <KpiTile icon={Landmark} label="I&M Balance" value={fmt(balances.im_bank ?? 0)} color="amber" />
          <KpiTile icon={Wallet} label="MoMo Balance" value={fmt(balances.momo ?? 0)} color="amber" />
        </div>
      </div>

      <div>
        <h3 className="section-title mb-2.5">Needs Attention</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KpiTile icon={ArrowUpCircle} label="Outstanding Driver Payments" value={fmt(dashboard.outstandingDriverAmount)} tone={dashboard.outstandingDriverAmount > 0 ? 'negative' : undefined} color="amber" />
          <KpiTile icon={ArrowUpCircle} label="Outstanding Owner Payments" value={fmt(dashboard.outstandingOwnerAmount)} tone={dashboard.outstandingOwnerAmount > 0 ? 'negative' : undefined} color="amber" />
        </div>
      </div>

      {accounts.length === 0 && (
        <p className="text-[11px] text-gray-400 text-center pt-2">No bank accounts set up yet — add them from the Accounts page.</p>
      )}
    </div>
  );
}
