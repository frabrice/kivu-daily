import { useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { supabase, PlatformCar } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo } from '../../lib/utils';
import Modal from '../Modal';
import TriStateToggle from './TriStateToggle';

export default function PlatformCarDrawer({
  car,
  startEditing,
  canEdit,
  canSetInterest = false,
  onClose,
  onSaved,
  onCreated,
}: {
  car: PlatformCar | null;
  startEditing: boolean;
  canEdit: boolean;
  // Call Center: may set only branded / allows branding / device + a note.
  canSetInterest?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCreated?: (car: PlatformCar) => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [interestEditing, setInterestEditing] = useState(startEditing && !canEdit && canSetInterest && !!car);
  const [interestNote, setInterestNote] = useState('');
  const [plateNumber, setPlateNumber] = useState(car?.plate_number ?? '');
  const [make, setMake] = useState(car?.make ?? '');
  const [model, setModel] = useState(car?.model ?? '');
  const [color, setColor] = useState(car?.color ?? '');
  const [isBranded, setIsBranded] = useState<boolean | null>(car?.is_branded ?? null);
  const [allowsBranding, setAllowsBranding] = useState<boolean | null>(car?.allows_branding ?? null);
  const [willingToBuyDevice, setWillingToBuyDevice] = useState<boolean | null>(car?.willing_to_buy_device ?? null);
  const [notes, setNotes] = useState(car?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const saveInterest = async () => {
    if (!car) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.rpc('set_platform_car_interest', {
      p_car_id: car.id, p_is_branded: isBranded, p_allows_branding: allowsBranding,
      p_willing_to_buy_device: willingToBuyDevice, p_note: interestNote.trim() || null,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const save = async () => {
    if (!plateNumber.trim()) return;
    setSaving(true);
    setError('');
    const payload = {
      plate_number: plateNumber.trim().toUpperCase(),
      make: make.trim() || null,
      model: model.trim() || null,
      color: color.trim() || null,
      is_branded: isBranded,
      allows_branding: allowsBranding,
      willing_to_buy_device: willingToBuyDevice,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (car) {
      const { error: err } = await supabase.from('platform_cars').update(payload).eq('id', car.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else {
      const { data, error: err } = await supabase.from('platform_cars').insert({ ...payload, created_by: profile!.id }).select().single();
      setSaving(false);
      if (err) { setError(err.message); return; }
      if (data) onCreated?.(data as PlatformCar);
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!car) return;
    setSaving(true);
    await supabase.from('platform_cars').delete().eq('id', car.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={car ? car.plate_number : 'Add Car'} subtitle={car ? timeAgo(car.updated_at) + ' updated' : 'Not part of the managed fleet'} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Plate Number</label>
          <input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} disabled={!editing} className="input" placeholder="RAD 123 A" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Make</label>
            <input value={make} onChange={(e) => setMake(e.target.value)} disabled={!editing} className="input" placeholder="Toyota" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} disabled={!editing} className="input" placeholder="Corolla" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Color</label>
          <input value={color} onChange={(e) => setColor(e.target.value)} disabled={!editing} className="input" placeholder="White" />
        </div>

        <div className="p-3 rounded-lg border border-gray-100 dark:border-white/5 space-y-3">
          <p className="text-[10px] text-gray-400">Filled in during the survey — leave as Unknown until then.</p>
          <TriStateToggle label="Currently branded" value={isBranded} onChange={setIsBranded} disabled={!editing && !interestEditing} />
          <TriStateToggle label="Allows branding" value={allowsBranding} onChange={setAllowsBranding} disabled={!editing && !interestEditing} />
          <TriStateToggle label="Willing to buy the app's device" value={willingToBuyDevice} onChange={setWillingToBuyDevice} disabled={!editing && !interestEditing} />
          {interestEditing && (
            <p className="text-[10px] text-brand-700 dark:text-brand-300">Saying Yes to branding or the device sends this car to the Fleet Manager to follow up.</p>
          )}
        </div>

        {interestEditing && (
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500" htmlFor="interest-note">Add a note (optional)</label>
            <input id="interest-note" value={interestNote} onChange={(e) => setInterestNote(e.target.value)} className="input" placeholder="e.g. Owner happy to brand from next week" />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Condition, anything worth remembering…" />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {interestEditing ? (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={() => setInterestEditing(false)} className="btn-ghost">Cancel</button>
            <button onClick={saveInterest} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        ) : editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {car ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (car ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !plateNumber.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : car ? 'Save Changes' : 'Add Car'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit ? (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            ) : canSetInterest && car ? (
              <button onClick={() => setInterestEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Update branding / device
              </button>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}
