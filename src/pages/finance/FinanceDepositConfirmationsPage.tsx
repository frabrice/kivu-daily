import { useMemo, useState } from 'react';
import { ShieldCheck, Smartphone, Landmark, Car } from 'lucide-react';
import { useFleetData, formatDateLabelSafe } from '../../lib/fleet';
import { supabase, DriverDeposit } from '../../lib/supabase';

export default function FinanceDepositConfirmationsPage() {
  const { drivers, deposits, loading, reload } = useFleetData();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
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

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ShieldCheck size={16} className="text-blue-600 dark:text-blue-300" /> Deposit Confirmations
          {pending.length > 0 && <span className="text-[8px] font-bold text-white bg-amber-500 px-1.5 py-0.5 rounded-full">{pending.length}</span>}
        </h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Every driver deposit Fleet logs stays pending until Finance confirms it here.</p>
      </div>

      {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="space-y-1.5">
        {pending.length === 0 && (
          <div className="card p-10 text-center">
            <ShieldCheck size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">Nothing waiting on confirmation.</p>
          </div>
        )}
        {pending.map((dep) => {
          const driver = driverById.get(dep.driver_id);
          return (
            <div key={dep.id} className="card p-3.5 flex items-center gap-3">
              <div className="w-1.5 h-9 rounded-full shrink-0 bg-amber-400" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate">{driver?.full_name ?? 'Unknown driver'}</p>
                <p className="text-[10px] text-gray-400 flex items-center gap-1.5">
                  <Car size={10} /> {driver?.vehicle?.plate_number ?? '—'}
                  <span>· {formatDateLabelSafe(dep.paid_date)}</span>
                  <span className="inline-flex items-center gap-1">
                    {dep.payment_method === 'momo' ? <Smartphone size={10} /> : <Landmark size={10} />}
                    {dep.payment_method === 'momo' ? 'MoMo' : dep.bank_name}
                  </span>
                </p>
              </div>
              <p className="text-[13px] font-semibold shrink-0">{dep.amount.toLocaleString()} RWF</p>
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
      </div>

      {recentlyConfirmed.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Recently Confirmed</p>
          <div className="space-y-1">
            {recentlyConfirmed.map((dep) => {
              const driver = driverById.get(dep.driver_id);
              return (
                <div key={dep.id} className="flex items-center justify-between gap-2 text-[11px] py-1.5 px-1 border-b border-gray-50 dark:border-white/5 last:border-0">
                  <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 min-w-0">
                    <ShieldCheck size={11} className="text-emerald-500 shrink-0" />
                    <span className="truncate">{driver?.full_name ?? 'Unknown driver'}</span>
                    <span className="text-gray-300 dark:text-white/20">· {formatDateLabelSafe(dep.paid_date)}</span>
                  </span>
                  <span className="font-medium shrink-0">{dep.amount.toLocaleString()} RWF</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
