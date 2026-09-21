import { useState } from 'react';
import { supabase, Vehicle } from '../../lib/supabase';
import { WEEKLY_OWNER_PAYOUT_DEFAULT, MONTHLY_MANAGEMENT_FEE_DEFAULT } from '../../lib/finance';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';
import DateInput from '../DateInput';

// Sets (or edits) the date a managed car's weekly payout/margin schedule
// counts from - for owners already on the books before this automation
// existed, this is how their onboarding fee and first month's fee get
// loaded retroactively. Goes through onboard_vehicle_owner(), the same
// idempotent RPC the onboarding flow uses: saving with a start date that
// has no onboarding fee on file yet loads the 140,000 fee + first
// month's 30,000 fee as pending, and the next sync_vehicle_obligations()
// pass (every Finance load) backfills every weekly payout and monthly
// fee that's elapsed since that date. Saving again with the same date
// just updates payout terms - no duplicates, matching sync's own
// idempotency guards.
export default function SetVehicleStartDateDrawer({
  vehicle, onClose, onSaved,
}: {
  vehicle: Vehicle;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [operationStartDate, setOperationStartDate] = useState(vehicle.operation_start_date ?? todayStr());
  const [weeklyPayout, setWeeklyPayout] = useState(String(vehicle.weekly_owner_payout_amount ?? WEEKLY_OWNER_PAYOUT_DEFAULT));
  const [monthlyFee, setMonthlyFee] = useState(String(vehicle.monthly_management_fee_amount ?? MONTHLY_MANAGEMENT_FEE_DEFAULT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isFirstTime = !vehicle.operation_start_date;

  const save = async () => {
    if (!operationStartDate || !vehicle.owner_id) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.rpc('onboard_vehicle_owner', {
      p_vehicle_id: vehicle.id,
      p_owner_id: vehicle.owner_id,
      p_operation_start_date: operationStartDate,
      p_weekly_owner_payout: Number(weeklyPayout) || WEEKLY_OWNER_PAYOUT_DEFAULT,
      p_monthly_management_fee: Number(monthlyFee) || MONTHLY_MANAGEMENT_FEE_DEFAULT,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Payout Schedule — ${vehicle.plate_number}`} subtitle="Weekly payout and margin are counted from this date" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Operation Start Date</label>
          <DateInput value={operationStartDate} onChange={setOperationStartDate} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Weekly Owner Payout</label>
            <input type="number" value={weeklyPayout} onChange={(e) => setWeeklyPayout(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Monthly Management Fee</label>
            <input type="number" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} className="input" />
          </div>
        </div>
        {isFirstTime ? (
          <p className="text-[10px] text-gray-400">This car has no onboarding fee on file yet — saving loads the 140,000 onboarding fee and first month's management fee as pending, and backfills every weekly payout and monthly fee elapsed since this date.</p>
        ) : (
          <p className="text-[10px] text-gray-400">Changing this date only affects payments not yet generated — it won't rewrite history already on the books.</p>
        )}

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !operationStartDate} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
