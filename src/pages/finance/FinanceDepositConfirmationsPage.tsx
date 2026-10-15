import { useMemo, useState } from 'react';
import { Pager, usePaged } from '../../ui/Pager';
import { ShieldCheck, Smartphone, Landmark, Car, Ban } from 'lucide-react';
import { useFleetData, formatDateLabelSafe } from '../../lib/fleet';
import { supabase, DriverDeposit } from '../../lib/supabase';
import RejectDepositModal from '../../components/finance/RejectDepositModal';

export default function FinanceDepositConfirmationsPage() {
  const { drivers, deposits, loading, reload } = useFleetData();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<DriverDeposit | null>(null);
  const [error, setError] = useState('');

  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const pending = useMemo(
    () => deposits.filter((d) => d.status === 'pending').sort((a, b) => a.paid_date.localeCompare(b.paid_date)),
    [deposits]
  );
  const recentlyConfirmed = useMemo(
    () => deposits.filter((d) => d.status === 'confirmed').sort((a, b) => (b.confirmed_at ?? '').localeCompare(a.confirmed_at ?? '')).slice(0, 15),
    [deposits]
  );

  const confirm = async (dep: DriverDeposit) => {
    setConfirmingId(dep.id);
    setError('');
    const { error: err } = await supabase.rpc('confirm_driver_deposit', { p_deposit_id: dep.id });
    setConfirmingId(null);
    if (err) { setError(err.message); return; }
    reload();
  };

  const pgPending = usePaged(pending, { key: 'deposit-confirm' });
  const pgRecentlyConfirmed = usePaged(recentlyConfirmed, { key: 'deposit-confirmed' });
  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ShieldCheck size={16} className="text-blue-600 dark:text-blue-300" /> Deposit Confirmations
          {pending.length > 0 && <span className="text-micro font-bold text-white bg-amber-500 px-1.5 py-0.5 rounded-full">{pending.length}</span>}
        </h2>
        <p className="text-caption text-fg-subtle mt-0.5">Every driver deposit Fleet logs stays pending until Finance confirms it here.</p>
      </div>

      {error && <div className="text-caption text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="space-y-1.5">
        {pending.length === 0 && (
          <div className="card p-10 text-center">
            <ShieldCheck size={26} className="text-fg-subtle mx-auto mb-2" />
            <p className="text-small text-fg-subtle">Nothing waiting on confirmation.</p>
          </div>
        )}
        {pgPending.rows.map((dep) => {
          const driver = driverById.get(dep.driver_id);
          return (
            <div key={dep.id} className="card p-3.5 flex items-center gap-3">
              <div className="w-1.5 h-9 rounded-full shrink-0 bg-amber-400" />
              <div className="flex-1 min-w-0">
                <p className="text-small font-medium truncate">{driver?.full_name ?? 'Unknown driver'}</p>
                <p className="text-micro text-fg-subtle flex items-center gap-1.5">
                  <Car size={10} /> {driver?.vehicle?.plate_number ?? '—'}
                  <span>· {formatDateLabelSafe(dep.paid_date)}</span>
                  <span className="inline-flex items-center gap-1">
                    {dep.payment_method === 'momo' ? <Smartphone size={10} /> : <Landmark size={10} />}
                    {dep.payment_method === 'momo' ? 'MoMo' : dep.bank_name}
                  </span>
                </p>
              </div>
              <p className="text-body font-semibold shrink-0">{dep.amount.toLocaleString()} RWF</p>
              <button
                onClick={() => setRejecting(dep)}
                disabled={confirmingId === dep.id}
                className="btn-ghost text-red-500 shrink-0 whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50"
              >
                <Ban size={13} /> Reject
              </button>
              <button
                onClick={() => confirm(dep)}
                disabled={confirmingId === dep.id}
                className="btn-primary shrink-0 whitespace-nowrap disabled:opacity-50"
              >
                {confirmingId === dep.id ? 'Confirming…' : 'Confirm'}
              </button>
            </div>
          );
        })}
        <Pager pager={pgPending.pager} noun="payments" />
      </div>

      {recentlyConfirmed.length > 0 && (
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-fg-subtle mb-2">Recently Confirmed</p>
          <div className="space-y-1">
            {pgRecentlyConfirmed.rows.map((dep) => {
              const driver = driverById.get(dep.driver_id);
              return (
                <div key={dep.id} className="flex items-center justify-between gap-2 text-caption py-1.5 px-1 border-b border-line-muted last:border-0">
                  <span className="flex items-center gap-1.5 text-fg-muted min-w-0">
                    <ShieldCheck size={11} className="text-emerald-500 shrink-0" />
                    <span className="truncate">{driver?.full_name ?? 'Unknown driver'}</span>
                    <span className="text-fg-subtle ">· {formatDateLabelSafe(dep.paid_date)}</span>
                  </span>
                  <span className="font-medium shrink-0">{dep.amount.toLocaleString()} RWF</span>
                </div>
              );
            })}
            <Pager pager={pgRecentlyConfirmed.pager} noun="payments" />
          </div>
        </div>
      )}

      {rejecting && (
        <RejectDepositModal
          depositId={rejecting.id}
          driverName={driverById.get(rejecting.driver_id)?.full_name ?? 'Unknown driver'}
          amount={rejecting.amount}
          date={rejecting.paid_date}
          onClose={() => setRejecting(null)}
          onRejected={() => { setRejecting(null); reload(); }}
        />
      )}
    </div>
  );
}
