import { useMemo, useState } from 'react';
import { Car, UserPlus, Wallet, Users2, ShieldCheck, TrendingUp, Landmark, Phone } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFinanceData, computeVehicleObligations, fmt } from '../../lib/finance';
import { supabase, Vehicle, VehicleOwner } from '../../lib/supabase';
import { startOfWeek, dateStr } from '../../lib/utils';
import KpiTile from '../../components/KpiTile';
import DataTable from '../../components/DataTable';
import VehicleOwnerDrawer from '../../components/finance/VehicleOwnerDrawer';
import AssignVehicleOwnerDrawer from '../../components/finance/AssignVehicleOwnerDrawer';
import OnboardVehicleDrawer from '../../components/finance/OnboardVehicleDrawer';

// Car-management money, per car: two shift drivers pay 360,000/week into
// BK (the existing driver_deposits system), of which the owner gets a
// flat 240,000/week from I&M and Kivu keeps 120,000/week margin in
// Equity, plus a separate 30,000/month management fee. Both the margin
// and the fee are schedule-driven (sync_vehicle_obligations, called on
// every Finance load) - this page is where that money becomes visible
// per owner and per car, and where a pending owner payout gets marked
// as actually paid once Finance has sent it.
export default function FinanceVehicleOwnersPage() {
  const { profile } = useAuth();
  const { accounts, vehicles, owners, transactions, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const bkAccountId = accounts.find((a) => a.key === 'bank_of_kigali')?.id ?? '';

  const [ownerDrawer, setOwnerDrawer] = useState<{ owner: VehicleOwner | null; startEditing: boolean } | null>(null);
  const [assignVehicle, setAssignVehicle] = useState<Vehicle | null>(null);
  const [onboardVehicle, setOnboardVehicle] = useState<Vehicle | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const onboardedVehicleIds = useMemo(() => new Set(transactions.filter((t) => t.type === 'onboarding_fee').map((t) => t.linked_vehicle_id)), [transactions]);
  const managedVehicles = useMemo(() => vehicles.filter((v) => v.owner_id), [vehicles]);
  const unassignedVehicles = useMemo(() => vehicles.filter((v) => !v.owner_id), [vehicles]);

  const pendingPayouts = transactions.filter((t) => t.type === 'vehicle_owner_payment' && t.status === 'pending');
  const totalPending = pendingPayouts.reduce((s, t) => s + t.amount, 0);
  const thisWeekStart = dateStr(startOfWeek(new Date()));
  const marginThisWeek = transactions
    .filter((t) => t.type === 'management_margin' && dateStr(startOfWeek(new Date(`${t.transaction_date}T00:00:00`))) === thisWeekStart)
    .reduce((s, t) => s + t.amount, 0);

  const payOwner = async (txId: string) => {
    setPayingId(txId);
    setError('');
    const { error: err } = await supabase.rpc('mark_vehicle_owner_payment_paid', { p_transaction_id: txId });
    setPayingId(null);
    if (err) { setError(err.message); return; }
    reload();
  };

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Car size={16} className="text-amber-600 dark:text-amber-300" /> Vehicle Owners</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Weekly payouts (I&M) and management margin (Equity) per managed car, computed automatically from operation start date.</p>
        </div>
        {canEdit && (
          <button onClick={() => setOwnerDrawer({ owner: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <UserPlus size={14} /> Add Owner
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Car} label="Managed Cars" value={String(managedVehicles.length)} color="amber" />
        <KpiTile icon={Wallet} label="Pending Owner Payments" value={fmt(totalPending)} tone={totalPending > 0 ? 'negative' : undefined} color="amber" />
        <KpiTile icon={TrendingUp} label="This Week's Margin" value={fmt(marginThisWeek)} tone="positive" color="amber" />
        <KpiTile icon={Users2} label="Owners On File" value={String(owners.length)} color="amber" />
      </div>

      {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      {unassignedVehicles.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Needs an Owner</p>
          <div className="space-y-1.5">
            {unassignedVehicles.map((v) => (
              <div key={v.id} className="card p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium">{v.plate_number}</p>
                  <p className="text-[10px] text-gray-400">{v.make} {v.model}</p>
                </div>
                {canEdit && (
                  <>
                    {onboardedVehicleIds.has(v.id) ? (
                      <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-full shrink-0">Onboarded</span>
                    ) : (
                      <button onClick={() => setOnboardVehicle(v)} disabled={!bkAccountId} className="btn-ghost shrink-0 whitespace-nowrap disabled:opacity-50">
                        Log Onboarding
                      </button>
                    )}
                    <button onClick={() => setAssignVehicle(v)} className="btn-primary shrink-0 whitespace-nowrap">
                      Assign Owner
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Managed Cars</p>
        {managedVehicles.length === 0 ? (
          <div className="card p-10 text-center">
            <Car size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">No managed car has an owner assigned yet.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {managedVehicles.map((v) => {
              const owner = owners.find((o) => o.id === v.owner_id);
              const ob = computeVehicleObligations(v, transactions);
              const pendingForVehicle = pendingPayouts.filter((t) => t.linked_vehicle_id === v.id).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
              const oldestPending = pendingForVehicle[0] ?? null;
              return (
                <div key={v.id} className="card p-3.5 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-[12px] font-medium">{v.plate_number}</p>
                    <p className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Users2 size={10} /> {owner?.full_name ?? 'Unknown owner'}
                      {owner?.phone && <span className="flex items-center gap-0.5"><Phone size={9} /> {owner.phone}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-gray-400">Owner Paid / Pending</p>
                    <p className="text-[11px] font-medium">{fmt(ob.ownerPaid)} <span className="text-gray-400">/ {fmt(ob.ownerPending)}</span></p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-gray-400">Margin Recognized</p>
                    <p className="text-[11px] font-medium text-positive">{fmt(ob.marginRecognized)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-gray-400">Mgmt Fee Recognized</p>
                    <p className="text-[11px] font-medium text-positive">{fmt(ob.managementFeeRecognized)}</p>
                  </div>
                  {canEdit && oldestPending && (
                    <button
                      onClick={() => payOwner(oldestPending.id)}
                      disabled={payingId === oldestPending.id}
                      className="btn-primary shrink-0 whitespace-nowrap disabled:opacity-50"
                    >
                      {payingId === oldestPending.id ? 'Marking…' : `Pay ${fmt(oldestPending.amount)}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><ShieldCheck size={13} /> Owners Directory</p>
        <DataTable
          rows={owners}
          keyFn={(o) => o.id}
          emptyLabel="No vehicle owners on file yet."
          onRowClick={(o) => setOwnerDrawer({ owner: o, startEditing: false })}
          columns={[
            { header: 'Name', render: (o) => o.full_name },
            { header: 'Phone', render: (o) => o.phone },
            { header: 'Bank', render: (o) => <span className="flex items-center gap-1">{o.bank_name && <Landmark size={11} className="text-gray-400" />} {o.bank_name ?? '—'}</span> },
            { header: 'Account No.', render: (o) => o.account_number ?? '—' },
            { header: 'Cars', render: (o) => vehicles.filter((v) => v.owner_id === o.id).map((v) => v.plate_number).join(', ') || '—' },
          ]}
        />
      </div>

      {ownerDrawer && (
        <VehicleOwnerDrawer
          owner={ownerDrawer.owner}
          startEditing={ownerDrawer.startEditing}
          canEdit={canEdit}
          onClose={() => setOwnerDrawer(null)}
          onSaved={reload}
        />
      )}

      {assignVehicle && (
        <AssignVehicleOwnerDrawer
          vehicle={assignVehicle}
          owners={owners}
          onClose={() => setAssignVehicle(null)}
          onSaved={reload}
        />
      )}

      {onboardVehicle && (
        <OnboardVehicleDrawer
          vehicle={onboardVehicle}
          bkAccountId={bkAccountId}
          onClose={() => setOnboardVehicle(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
