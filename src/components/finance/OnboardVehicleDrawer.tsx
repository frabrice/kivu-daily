import { useState } from 'react';
import { supabase, Vehicle } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { todayStr, formatDateFull } from '../../lib/utils';
import { ONBOARDING_FEE, ONBOARDING_DEVICE_COST, ONBOARDING_BRANDING_COST, ONBOARDING_UNIFORM_COST, fmt } from '../../lib/finance';
import Modal from '../Modal';
import DateInput from '../DateInput';

// One guided action instead of four separate manual entries - logs the
// 140,000 onboarding fee and its three costs against Bank of Kigali in
// one shot, so nothing gets forgotten or entered piecemeal.
export default function OnboardVehicleDrawer({
  vehicle,
  bkAccountId,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle;
  bkAccountId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const netMargin = ONBOARDING_FEE - ONBOARDING_DEVICE_COST - ONBOARDING_BRANDING_COST - ONBOARDING_UNIFORM_COST;

  const save = async () => {
    setSaving(true);
    setError('');
    const base = {
      account_id: bkAccountId, transaction_date: date, linked_vehicle_id: vehicle.id,
      status: 'posted' as const, created_by: profile!.id, prepared_by: profile!.id,
    };
    const { error: err } = await supabase.from('finance_transactions').insert([
      { ...base, type: 'onboarding_fee', direction: 'in', amount: ONBOARDING_FEE, description: `Onboarding fee — ${vehicle.plate_number}` },
      { ...base, type: 'supplier_payment', direction: 'out', amount: ONBOARDING_DEVICE_COST, description: `Device cost — ${vehicle.plate_number}` },
      { ...base, type: 'supplier_payment', direction: 'out', amount: ONBOARDING_BRANDING_COST, description: `Branding cost — ${vehicle.plate_number}` },
      { ...base, type: 'supplier_payment', direction: 'out', amount: ONBOARDING_UNIFORM_COST, description: `Uniforms (2 drivers) — ${vehicle.plate_number}` },
    ]);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Onboard ${vehicle.plate_number}`} subtitle="Logs the fee and its costs against Bank of Kigali" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Date</label>
          <DateInput value={date} onChange={setDate} />
        </div>
        <div className="card p-3.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 space-y-1.5 text-[12px]">
          <div className="flex justify-between"><span className="text-gray-500">Onboarding fee (120k device + 20k branding)</span><span className="font-medium text-positive">+{fmt(ONBOARDING_FEE)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Device cost</span><span className="font-medium text-red-500">−{fmt(ONBOARDING_DEVICE_COST)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Branding cost</span><span className="font-medium text-red-500">−{fmt(ONBOARDING_BRANDING_COST)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Uniforms (2 drivers, 7,500 each)</span><span className="font-medium text-red-500">−{fmt(ONBOARDING_UNIFORM_COST)}</span></div>
          <div className="flex justify-between pt-1.5 border-t border-gray-200 dark:border-white/10"><span className="font-medium">Net onboarding margin</span><span className="font-semibold text-positive">{fmt(netMargin)}</span></div>
        </div>
        <p className="text-[10px] text-gray-400">All four entries post to Bank of Kigali, dated {formatDateFull(new Date(`${date}T00:00:00`))}.</p>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Logging…' : 'Log Onboarding'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
