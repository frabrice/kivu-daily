import { useState } from 'react';
import { Trash2, Pencil, CarFront } from 'lucide-react';
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
  const [editCarOpen, setEditCarOpen] = useState(false);

  const selectedCar = cars.find((c) => c.id === carId);

  const save = async () => {
    if (!fullName.trim() || !phone.trim()) return;
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
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
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
          <select value={carId} onChange={(e) => setCarId(e.target.value)} disabled={!editing} className="input">
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
            <div className="mt-2 p-2.5 rounded-lg bg-gray-50 dark:bg-white/5">
              {(selectedCar.make || selectedCar.model || selectedCar.color) && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {[selectedCar.make, selectedCar.model, selectedCar.color].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">
                Branded: {selectedCar.is_branded === null ? 'Unknown' : selectedCar.is_branded ? 'Yes' : 'No'}
                {' · '}Allows branding: {selectedCar.allows_branding === null ? 'Unknown' : selectedCar.allows_branding ? 'Yes' : 'No'}
              </p>
              {editing && (
                <button type="button" onClick={() => setEditCarOpen(true)} className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline mt-1.5">
                  Edit this car's details
                </button>
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
              <button onClick={save} disabled={saving || !fullName.trim() || !phone.trim()} className="btn-primary disabled:opacity-50">
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
          onCreated={(c) => setCarId(c.id)}
        />
      )}

      {editCarOpen && selectedCar && (
        <PlatformCarDrawer
          car={selectedCar}
          startEditing
          canEdit={canEdit}
          onClose={() => setEditCarOpen(false)}
          onSaved={() => {}}
        />
      )}
    </Modal>
  );
}
