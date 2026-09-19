import { useState } from 'react';
import { supabase, Vehicle, VehicleOwner } from '../../lib/supabase';
import { WEEKLY_OWNER_PAYOUT_DEFAULT, MONTHLY_MANAGEMENT_FEE_DEFAULT } from '../../lib/finance';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';
import DateInput from '../DateInput';
import SearchableSelect from '../SearchableSelect';

// Links a managed car to its owner and sets the anchor date its weekly
// payout + margin schedule counts from - the moment this is saved,
// sync_vehicle_obligations() picks the car up on the next Finance load.
export default function AssignVehicleOwnerDrawer({
  vehicle,
  owners,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle;
  owners: VehicleOwner[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ownerId, setOwnerId] = useState(vehicle.owner_id ?? '');
  const [operationStartDate, setOperationStartDate] = useState(vehicle.operation_start_date ?? todayStr());
  const [weeklyPayout, setWeeklyPayout] = useState(String(vehicle.weekly_owner_payout_amount ?? WEEKLY_OWNER_PAYOUT_DEFAULT));
  const [monthlyFee, setMonthlyFee] = useState(String(vehicle.monthly_management_fee_amount ?? MONTHLY_MANAGEMENT_FEE_DEFAULT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = !!ownerId && !!operationStartDate;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('vehicles').update({
      owner_id: ownerId,
      operation_start_date: operationStartDate,
      weekly_owner_payout_amount: Number(weeklyPayout) || WEEKLY_OWNER_PAYOUT_DEFAULT,
      monthly_management_fee_amount: Number(monthlyFee) || MONTHLY_MANAGEMENT_FEE_DEFAULT,
      updated_at: new Date().toISOString(),
    }).eq('id', vehicle.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Assign Owner — ${vehicle.plate_number}`} subtitle="Weekly payout and margin are computed from this once saved" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Owner</label>
          <SearchableSelect
            options={owners.map((o) => ({ id: o.id, label: o.full_name, sublabel: o.phone }))}
            value={ownerId}
            onChange={setOwnerId}
            placeholder="Search owners…"
            emptyLabel="No owners yet — add one first"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Operation Start Date</label>
          <DateInput value={operationStartDate} onChange={setOperationStartDate} />
          <p className="text-[10px] text-gray-400 mt-1">Weekly payout and margin are counted from this date.</p>
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
        <p className="text-[10px] text-gray-400">Standard contract is 240,000 RWF/week to the owner and 30,000 RWF/month management fee — only change these if this car's contract is different.</p>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Assign Owner'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
