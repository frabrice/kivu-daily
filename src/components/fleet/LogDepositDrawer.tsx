import { useMemo, useState } from 'react';
import { ShieldCheck, Smartphone, Landmark } from 'lucide-react';
import { supabase, Driver, DriverDeposit, DepositPaymentMethod } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { todayStr } from '../../lib/utils';
import { WEEKLY_DEPOSIT_AMOUNT, DEPOSIT_PAYMENT_METHODS, formatDateLabelSafe, computeDepositStanding, formatRwf } from '../../lib/fleet';
import Modal from '../Modal';
import DateInput from '../DateInput';

// Pre-fills what the driver actually needs right now - enough to be
// cleared to drive if they aren't, otherwise what's due this Sunday -
// and previews what the payment will cover before it's logged.
export default function LogDepositDrawer({ driver, deposits, onClose, onSaved }: { driver: Driver; deposits: DriverDeposit[]; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const driverDeposits = useMemo(() => deposits.filter((d) => d.driver_id === driver.id), [deposits, driver.id]);
  const before = useMemo(() => computeDepositStanding(driver, driverDeposits), [driver, driverDeposits]);
  const suggested = before.owedNow > 0 ? before.owedNow : before.nextDueAmount > 0 ? before.nextDueAmount : WEEKLY_DEPOSIT_AMOUNT;
  const [amount, setAmount] = useState(String(suggested));
  const [paidDate, setPaidDate] = useState(todayStr());
  const [paymentMethod, setPaymentMethod] = useState<DepositPaymentMethod>('momo');
  const [bankName, setBankName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const numAmount = Number(amount);
  const canContinue = !!numAmount && numAmount > 0 && !!paidDate && (paymentMethod === 'momo' || !!bankName.trim());
  const after = useMemo(
    () => (numAmount > 0 ? computeDepositStanding(driver, [...driverDeposits, { paid_date: paidDate, amount: numAmount, created_at: '9999' } as DriverDeposit]) : before),
    [driver, driverDeposits, paidDate, numAmount, before]
  );
  const dueSunday = after.nextDueDate ? formatDateLabelSafe(after.nextDueDate) : '';
  const clearedText = after.ruleInForce
    ? (before.isCleared ? 'Still cleared' : 'Clears them to drive')
    : (before.isCleared ? 'Still up to date' : 'Brings them up to date');
  const effect = !after.hasStarted
    ? null
    : !after.isCleared
      ? { tone: 'text-amber-500', text: after.ruleInForce ? `${formatRwf(after.owedNow)} still needed before they're cleared to drive.` : `Still ${formatRwf(after.owedNow)} behind.` }
      : after.nextDueAmount > 0
        ? { tone: 'text-emerald-600 dark:text-emerald-400', text: `${clearedText} · ${formatRwf(after.nextDueAmount)} still due by Sunday ${dueSunday}.` }
        : { tone: 'text-emerald-600 dark:text-emerald-400', text: `${clearedText} · the week after Sunday ${dueSunday} is covered too.` };

  const save = async () => {
    if (!canContinue) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('driver_deposits').insert({
      driver_id: driver.id,
      amount: numAmount,
      paid_date: paidDate,
      payment_method: paymentMethod,
      bank_name: paymentMethod === 'bank' ? bankName.trim() : null,
      created_by: profile!.id,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Log Deposit" subtitle={driver.full_name} maxWidth="max-w-md">
      {!confirming ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Amount (RWF)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
            <p className="text-[10px] text-gray-400 mt-1">
              {before.owedNow > 0
                ? (before.ruleInForce ? `${formatRwf(before.owedNow)} needed now to be cleared to drive.` : `${formatRwf(before.owedNow)} behind today.`)
                : before.nextDueAmount > 0
                  ? `${formatRwf(before.nextDueAmount)} due by Sunday ${before.nextDueDate ? formatDateLabelSafe(before.nextDueDate) : ''}.`
                  : 'Already paid for next week - this goes further ahead.'}
            </p>
            {numAmount > 0 && after.paidThrough && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Covers them through {formatDateLabelSafe(after.paidThrough)}.</p>
            )}
            {numAmount > 0 && effect && <p className={`text-[10px] font-medium mt-1 ${effect.tone}`}>{effect.text}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Date Paid</label>
            <DateInput value={paidDate} onChange={setPaidDate} />
            <p className="text-[10px] text-gray-400 mt-1">Every driver pays by Sunday for the Monday–Sunday week ahead.</p>
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Payment Method</label>
            <div className="grid grid-cols-2 gap-2">
              {DEPOSIT_PAYMENT_METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setPaymentMethod(m.key)}
                  className={`p-2 rounded-lg border text-left text-[11px] flex items-center gap-1.5 ${
                    paymentMethod === m.key ? 'border-brand bg-brand/10' : 'border-gray-200 dark:border-white/10'
                  }`}
                >
                  {m.key === 'momo' ? <Smartphone size={12} /> : <Landmark size={12} />}
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {paymentMethod === 'bank' && (
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Which Bank</label>
              <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="input" placeholder="e.g. Bank of Kigali" autoFocus />
            </div>
          )}

          {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={() => setConfirming(true)} disabled={!canContinue} className="btn-primary disabled:opacity-50">
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card p-3.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><ShieldCheck size={12} /> Confirm this deposit</p>
            <p className="text-[13px]"><span className="font-semibold">{numAmount.toLocaleString()} RWF</span> for <span className="font-semibold">{driver.full_name}</span></p>
            <p className="text-[12px] text-gray-500 dark:text-gray-400">Paid on {formatDateLabelSafe(paidDate)}</p>
            <p className="text-[12px] text-gray-500 dark:text-gray-400">
              Via {paymentMethod === 'momo' ? 'MoMo' : `Bank Transfer · ${bankName.trim()}`}
            </p>
            {after.paidThrough && <p className="text-[12px] text-gray-500 dark:text-gray-400">Covers through {formatDateLabelSafe(after.paidThrough)}</p>}
            {effect && <p className={`text-[12px] font-medium ${effect.tone}`}>{effect.text}</p>}
          </div>
          <p className="text-[10px] text-gray-400">It stays pending until Finance confirms it. If this doesn't cover everything owed, you can log another payment for the rest at any time.</p>

          {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={() => setConfirming(false)} disabled={saving} className="btn-ghost">Back</button>
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Confirm & Log Deposit'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
