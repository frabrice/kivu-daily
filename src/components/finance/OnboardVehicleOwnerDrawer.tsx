import { useState } from 'react';
import { supabase, Vehicle, VehicleOwner, PaymentDay } from '../../lib/supabase';
import { OWNER_PAYOUT_DAYS_PER_WEEK, DAILY_OWNER_PAYOUT_DEFAULT, MONTHLY_MANAGEMENT_FEE_DEFAULT, ONBOARDING_FEE, fmt } from '../../lib/finance';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';
import DateInput from '../DateInput';
import SearchableSelect from '../SearchableSelect';
import { LegalDocFields } from '../legal/LegalDocFields';
import { LegalDraft, draftError, emptyDraft, uploadDraft, useLegalDocs } from '../../lib/legalDocs';

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
  const [dailyPayout, setDailyPayout] = useState(String(DAILY_OWNER_PAYOUT_DEFAULT));
  const [monthlyFee, setMonthlyFee] = useState(String(MONTHLY_MANAGEMENT_FEE_DEFAULT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The signed and stamped management agreement (MD, 15 Oct 2026): required
  // unless this owner already has one on file. The new owner's id is fixed
  // up front so the file is filed under it.
  const [newOwnerId] = useState(() => crypto.randomUUID());
  const [agreement, setAgreement] = useState<LegalDraft>(emptyDraft(todayStr()));
  const { docs: legalDocs } = useLegalDocs();
  const targetOwner = mode === 'existing' ? ownerId : newOwnerId;
  const hasAgreement = mode === 'existing' && !!ownerId && legalDocs.some((x) => x.owner_id === ownerId && x.kind === 'owner_management_agreement');
  const agreementError = hasAgreement && !agreement.file ? null : draftError('owner_management_agreement', agreement);

  const weeklyPayout = (Number(dailyPayout) || DAILY_OWNER_PAYOUT_DEFAULT) * OWNER_PAYOUT_DAYS_PER_WEEK;
  const canSave = (mode === 'existing'
    ? !!ownerId && !!operationStartDate
    : fullName.trim() && phone.trim() && !!operationStartDate) && !agreementError;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const up = agreement.file ? await uploadDraft('owner_management_agreement', targetOwner, agreement) : null;
    if (up && 'error' in up) { setSaving(false); setError(up.error); return; }

    let finalOwnerId = ownerId;
    if (mode === 'new') {
      const { data, error: err } = await supabase.from('vehicle_owners').insert({
        id: newOwnerId,
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

    const { error: err } = await supabase.rpc('onboard_vehicle_owner_with_agreement', {
      p_doc: up ? up.doc : null,
      p_vehicle_id: vehicle.id,
      p_owner_id: finalOwnerId,
      p_operation_start_date: operationStartDate,
      p_weekly_owner_payout: weeklyPayout,
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
        <div className="flex gap-0.5 p-0.5 bg-inset rounded-lg w-fit">
          <button
            onClick={() => setMode('existing')}
            className={`px-3 py-1.5 rounded-md text-small font-medium transition-all ${mode === 'existing' ? 'bg-surface-2 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-fg-muted'}`}
          >
            Existing Owner
          </button>
          <button
            onClick={() => setMode('new')}
            className={`px-3 py-1.5 rounded-md text-small font-medium transition-all ${mode === 'new' ? 'bg-surface-2 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-fg-muted'}`}
          >
            New Owner
          </button>
        </div>

        {mode === 'existing' ? (
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Owner</label>
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
              <label className="block text-caption font-medium mb-1.5 text-fg-muted">Full Name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" placeholder="e.g. Jean Bosco Habimana" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-caption font-medium mb-1.5 text-fg-muted">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="078xxxxxxx" />
              </div>
              <div>
                <label className="block text-caption font-medium mb-1.5 text-fg-muted">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="Optional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-caption font-medium mb-1.5 text-fg-muted">Bank Name</label>
                <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="input" placeholder="e.g. Bank of Kigali" />
              </div>
              <div>
                <label className="block text-caption font-medium mb-1.5 text-fg-muted">Account Number</label>
                <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="input" placeholder="Account number" />
              </div>
            </div>
            <div>
              <label className="block text-caption font-medium mb-1.5 text-fg-muted">Payment Day</label>
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
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Operation Start Date</label>
          <DateInput value={operationStartDate} onChange={setOperationStartDate} />
          <p className="text-micro text-fg-subtle mt-1">Weekly payout and margin are counted from this date.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Daily Payment ({OWNER_PAYOUT_DAYS_PER_WEEK} days/week)</label>
            <input type="number" value={dailyPayout} onChange={(e) => setDailyPayout(e.target.value)} className="input" />
            <p className="text-micro text-fg-subtle mt-1">= {fmt(weeklyPayout)}/week</p>
          </div>
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Monthly Management Fee</label>
            <input type="number" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} className="input" />
          </div>
        </div>
        <p className="text-micro text-fg-subtle">Standard contract is 40,000 RWF/day (240,000/week) to the owner and 30,000 RWF/month management fee — only change these if this car/car type's contract is different (e.g. a car paying 45,000/day = 270,000/week).</p>

        <div className="card p-3.5 bg-inset border border-line space-y-1 text-caption text-fg-muted">
          <p>On save, this loads two pending confirmations for Finance:</p>
          <p>• Onboarding fee — <span className="font-medium">{fmt(ONBOARDING_FEE)}</span> (Bank of Kigali)</p>
          <p>• First month's management fee — <span className="font-medium">{fmt(Number(monthlyFee) || MONTHLY_MANAGEMENT_FEE_DEFAULT)}</span> (Equity)</p>
          <p>Confirming the onboarding fee then loads the device, branding and uniform costs for approval.</p>
        </div>

        {hasAgreement && !agreement.file
          ? <p className="text-caption text-success">This owner's signed and stamped management agreement is already on file. Attach a new one below only if this car has its own.</p>
          : null}
        <LegalDocFields kind="owner_management_agreement" draft={agreement} onChange={setAgreement} title={hasAgreement ? 'Management agreement for this car (optional)' : 'Management agreement — signed and stamped *'} />
        {!error && agreementError && <p className="text-caption text-fg-muted">{agreementError}</p>}

        {error && <div className="text-caption text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted ">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">
            {saving ? 'Onboarding…' : 'Onboard Owner'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
