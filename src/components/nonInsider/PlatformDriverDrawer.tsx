import { useState } from 'react';
import { Trash2, Pencil, CarFront, ChevronDown } from 'lucide-react';
import { supabase, PlatformDriver, PlatformCar } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo } from '../../lib/utils';
import Modal from '../Modal';
import TriStateToggle from './TriStateToggle';
import PlatformCarDrawer from './PlatformCarDrawer';

export default function PlatformDriverDrawer({
  driver,
  startEditing,
  cars,
  canEdit,
  onClose,
  onSaved,
}: {
  driver: PlatformDriver | null;
  startEditing: boolean;
  cars: PlatformCar[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [fullName, setFullName] = useState(driver?.full_name ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [email, setEmail] = useState(driver?.email ?? '');
  const [isOwner, setIsOwner] = useState<boolean | null>(driver?.is_owner ?? null);
  const [carId, setCarId] = useState(driver?.car_id ?? '');
  const [notes, setNotes] = useState(driver?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addCarOpen, setAddCarOpen] = useState(false);
  const [carPanelOpen, setCarPanelOpen] = useState(false);

  // Kept as separate editable fields (not just a read-out of `selectedCar`)
  // so the call center agent doing the actual phone survey - owner or not,
  // branded, willing to brand - can answer it right here while on the call
  // with the driver, instead of hanging up, opening the Vehicles tab, and
  // hunting the same car down again there.
  const [carPlate, setCarPlate] = useState(driver?.car?.plate_number ?? '');
  const [carMake, setCarMake] = useState(driver?.car?.make ?? '');
  const [carModel, setCarModel] = useState(driver?.car?.model ?? '');
  const [carColor, setCarColor] = useState(driver?.car?.color ?? '');
  const [carIsBranded, setCarIsBranded] = useState<boolean | null>(driver?.car?.is_branded ?? null);
  const [carAllowsBranding, setCarAllowsBranding] = useState<boolean | null>(driver?.car?.allows_branding ?? null);
  const [carNotes, setCarNotes] = useState(driver?.car?.notes ?? '');

  const selectedCar = cars.find((c) => c.id === carId);

  const syncCarFields = (c: PlatformCar) => {
    setCarPlate(c.plate_number);
    setCarMake(c.make ?? '');
    setCarModel(c.model ?? '');
    setCarColor(c.color ?? '');
    setCarIsBranded(c.is_branded);
    setCarAllowsBranding(c.allows_branding);
    setCarNotes(c.notes ?? '');
  };

  const clearCarFields = () => {
    setCarPlate('');
    setCarMake('');
    setCarModel('');
    setCarColor('');
    setCarIsBranded(null);
    setCarAllowsBranding(null);
    setCarNotes('');
  };

  const handleCarChange = (id: string) => {
    setCarId(id);
    const c = cars.find((x) => x.id === id);
    if (c) syncCarFields(c);
    else clearCarFields();
  };

  const save = async () => {
    if (!fullName.trim() || !phone.trim()) return;
    if (carId && !carPlate.trim()) {
      setError("Enter the assigned car's plate number.");
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      is_owner: isOwner,
      car_id: carId || null,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = driver
      ? await supabase.from('platform_drivers').update(payload).eq('id', driver.id)
      : await supabase.from('platform_drivers').insert({ ...payload, created_by: profile!.id });
    if (err) {
      setSaving(false);
      setError(err.message);
      return;
    }

    if (carId) {
      const { error: carErr } = await supabase
        .from('platform_cars')
        .update({
          plate_number: carPlate.trim().toUpperCase(),
          make: carMake.trim() || null,
          model: carModel.trim() || null,
          color: carColor.trim() || null,
          is_branded: carIsBranded,
          allows_branding: carAllowsBranding,
          notes: carNotes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', carId);
      if (carErr) {
        setSaving(false);
        setError(carErr.message);
        return;
      }
    }

    setSaving(false);
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!driver) return;
    setSaving(true);
    await supabase.from('platform_drivers').delete().eq('id', driver.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={driver ? driver.full_name : 'Add Non-Insider Driver'} subtitle={driver ? timeAgo(driver.updated_at) + ' updated' : 'Onboarded on the platform, car not managed by us'} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Full Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!editing} className="input" placeholder="Jean Baptiste" autoFocus />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} className="input" placeholder="+250 7XX XXX XXX" />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} className="input" placeholder="jean@example.com" />
        </div>

        <TriStateToggle label="Is the driver the car owner?" value={isOwner} onChange={setIsOwner} disabled={!editing} />

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><CarFront size={11} /> Assigned Car</label>
          <select value={carId} onChange={(e) => handleCarChange(e.target.value)} disabled={!editing} className="input">
            <option value="">No car assigned</option>
            {cars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.plate_number}{c.make || c.model ? ` — ${[c.make, c.model].filter(Boolean).join(' ')}` : ''}
              </option>
            ))}
          </select>
          {editing && (
            <button type="button" onClick={() => setAddCarOpen(true)} className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline mt-1.5">
              + Add a new car
            </button>
          )}
          <p className="text-[11px] text-gray-400 mt-1.5">
            Changing or clearing this doesn't touch the driver's login - it's how a swapped or repossessed car gets reflected here without re-onboarding anyone.
          </p>

          {selectedCar && (
            <div className="mt-2 rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setCarPanelOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 p-2.5 bg-gray-50 dark:bg-white/5 text-left"
              >
                <span className="text-[12px] font-medium truncate">
                  {selectedCar.plate_number}
                  {(selectedCar.make || selectedCar.model) && (
                    <span className="text-gray-400 font-normal"> · {[selectedCar.make, selectedCar.model].filter(Boolean).join(' ')}</span>
                  )}
                </span>
                <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform ${carPanelOpen ? 'rotate-180' : ''}`} />
              </button>

              {carPanelOpen && (
                <div className="p-3 space-y-3 border-t border-gray-200 dark:border-white/10">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-gray-500">Plate Number</label>
                      <input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} disabled={!editing} className="input" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-gray-500">Color</label>
                      <input value={carColor} onChange={(e) => setCarColor(e.target.value)} disabled={!editing} className="input" placeholder="White" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-gray-500">Make</label>
                      <input value={carMake} onChange={(e) => setCarMake(e.target.value)} disabled={!editing} className="input" placeholder="Toyota" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-gray-500">Model</label>
                      <input value={carModel} onChange={(e) => setCarModel(e.target.value)} disabled={!editing} className="input" placeholder="Corolla" />
                    </div>
                  </div>

                  <TriStateToggle label="Currently branded" value={carIsBranded} onChange={setCarIsBranded} disabled={!editing} />
                  <TriStateToggle label="Allows branding" value={carAllowsBranding} onChange={setCarAllowsBranding} disabled={!editing} />

                  <div>
                    <label className="block text-[11px] font-medium mb-1 text-gray-500">Vehicle Notes</label>
                    <textarea value={carNotes} onChange={(e) => setCarNotes(e.target.value)} disabled={!editing} rows={2} className="input resize-none" placeholder="Condition, anything worth remembering…" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="How they were onboarded, survey findings…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {driver ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (driver ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !fullName.trim() || !phone.trim() || (!!carId && !carPlate.trim())} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : driver ? 'Save Changes' : 'Add Driver'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>

      {addCarOpen && (
        <PlatformCarDrawer
          car={null}
          startEditing
          canEdit={canEdit}
          onClose={() => setAddCarOpen(false)}
          onSaved={() => {}}
          onCreated={(c) => { setCarId(c.id); syncCarFields(c); setCarPanelOpen(true); }}
        />
      )}
    </Modal>
  );
}
