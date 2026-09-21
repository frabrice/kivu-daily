import { useState } from 'react';
import { supabase, Vehicle, VehicleOwner, PaymentDay } from '../../lib/supabase';
import { WEEKLY_OWNER_PAYOUT_DEFAULT, MONTHLY_MANAGEMENT_FEE_DEFAULT, ONBOARDING_FEE, fmt } from '../../lib/finance';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';
import DateInput from '../DateInput';
import SearchableSelect from '../SearchableSelect';

type OwnerMode = 'existing' | 'new';

// One guided flow for the whole "an owner joins Kivu Ride" moment: pick
// or create the owner, pick their car, set the date the weekly payout
// schedule counts from - then onboard_vehicle_owner() links the car and
// auto-loads the 140K onboarding fee + first month's 30K management fee
// as pending confirmations. Finance/MD just confirm from here on; the
// device/branding/uniform costs cascade in once the onboarding fee is
// confirmed (see confirm_onboarding_fee(), called from the Payments tab).
export default function OnboardVehicleOwnerDrawer({
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
  const [mode, setMode] = useState<OwnerMode>('existing');
  const [ownerId, setOwnerId] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [paymentDay, setPaymentDay] = useState<PaymentDay | ''>('');
  const [operationStartDate, setOperationStartDate] = useState(todayStr());
  const [weeklyPayout, setWeeklyPayout] = useState(String(WEEKLY_OWNER_PAYOUT_DEFAULT));
  const [monthlyFee, setMonthlyFee] = useState(String(MONTHLY_MANAGEMENT_FEE_DEFAULT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = mode === 'existing'
    ? !!ownerId && !!operationStartDate
    : fullName.trim() && phone.trim() && !!operationStartDate;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');

    let finalOwnerId = ownerId;
    if (mode === 'new') {
      const { data, error: err } = await supabase.from('vehicle_owners').insert({
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        bank_name: bankName.trim() || null,
        account_number: accountNumber.trim() || null,
        payment_day: paymentDay || null,
      }).select().single();
      if (err) { setSaving(false); setError(err.message); return; }
      finalOwnerId = data!.id;
    }

    const { error: err } = await supabase.rpc('onboard_vehicle_owner', {
      p_vehicle_id: vehicle.id,
      p_owner_id: finalOwnerId,
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
    <Modal open onClose={onClose} title={`Onboard Vehicle Owner — ${vehicle.plate_number}`} subtitle="Links the owner, sets the payout schedule, and loads the onboarding fees for confirmation" maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
          <button
            onClick={() => setMode('existing')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${mode === 'existing' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
          >
            Existing Owner
          </button>
          <button
            onClick={() => setMode('new')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${mode === 'new' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
          >
            New Owner
          </button>
        </div>

        {mode === 'existing' ? (
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Owner</label>
            <SearchableSelect
              options={owners.map((o) => ({ id: o.id, label: o.full_name, sublabel: o.phone }))}
              value={ownerId}
              onChange={setOwnerId}
              placeholder="Search owners…"
              emptyLabel="No owners yet — switch to New Owner"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Full Name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" placeholder="e.g. Jean Bosco Habimana" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="078xxxxxxx" />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="Optional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Bank Name</label>
                <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="input" placeholder="e.g. Bank of Kigali" />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Account Number</label>
                <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="input" placeholder="Account number" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Payment Day</label>
              <select value={paymentDay} onChange={(e) => setPaymentDay(e.target.value as PaymentDay | '')} className="input">
                <option value="">Not set</option>
                {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as PaymentDay[]).map((d) => (
                  <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </div>
          </>
        )}

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

        <div className="card p-3.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 space-y-1 text-[11px] text-gray-500">
          <p>On save, this loads two pending confirmations for Finance:</p>
          <p>• Onboarding fee — <span className="font-medium">{fmt(ONBOARDING_FEE)}</span> (Bank of Kigali)</p>
          <p>• First month's management fee — <span className="font-medium">{fmt(Number(monthlyFee) || MONTHLY_MANAGEMENT_FEE_DEFAULT)}</span> (Equity)</p>
          <p>Confirming the onboarding fee then loads the device, branding and uniform costs for approval.</p>
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">
            {saving ? 'Onboarding…' : 'Onboard Owner'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
