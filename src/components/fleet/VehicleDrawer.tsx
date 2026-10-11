import { useState } from 'react';
import { Plus, Trash2, Pencil, X } from 'lucide-react';
import { supabase, Vehicle, RuraLicenseStatus } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo, dateStr, addDays } from '../../lib/utils';
import Modal from '../Modal';
import DateInput from '../DateInput';

export default function VehicleDrawer({
  vehicle,
  startEditing,
  canEdit,
  onClose,
  onSaved,
  onCreated,
}: {
  vehicle: Vehicle | null;
  startEditing: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCreated?: (vehicle: Vehicle) => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [plateNumber, setPlateNumber] = useState(vehicle?.plate_number ?? '');
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  const [deviceLabel, setDeviceLabel] = useState(vehicle?.device_label ?? '');
  const [documents, setDocuments] = useState<string[]>(vehicle?.documents ?? []);
  const [notes, setNotes] = useState(vehicle?.notes ?? '');
  const [givenDate, setGivenDate] = useState(vehicle?.given_date ?? '');
  const [operationStartDate, setOperationStartDate] = useState(vehicle?.operation_start_date ?? '');
  const [ruraStatus, setRuraStatus] = useState<RuraLicenseStatus>(vehicle?.rura_license_status ?? 'pending');
  const [ruraIssuedDate, setRuraIssuedDate] = useState(vehicle?.rura_license_issued_date ?? '');
  const [ruraExpiryDate, setRuraExpiryDate] = useState(vehicle?.rura_license_expiry_date ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addDoc = () => setDocuments((d) => [...d, '']);
  const updateDoc = (i: number, text: string) => setDocuments((d) => d.map((v, idx) => (idx === i ? text : v)));
  const removeDoc = (i: number) => setDocuments((d) => d.filter((_, idx) => idx !== i));

  const handleIssuedDateChange = (value: string) => {
    setRuraIssuedDate(value);
    if (value && !ruraExpiryDate) {
      const issued = new Date(value + 'T00:00:00');
      setRuraExpiryDate(dateStr(addDays(issued, 730)));
    }
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
      device_label: deviceLabel.trim() || null,
      documents: documents.map((d) => d.trim()).filter(Boolean),
      notes: notes.trim() || null,
      given_date: givenDate || null,
      operation_start_date: operationStartDate || null,
      rura_license_status: ruraStatus,
      rura_license_issued_date: ruraIssuedDate || null,
      rura_license_expiry_date: ruraExpiryDate || null,
      updated_at: new Date().toISOString(),
    };
    if (vehicle) {
      const { error: err } = await supabase.from('vehicles').update(payload).eq('id', vehicle.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else {
      const { data, error: err } = await supabase.from('vehicles').insert({ ...payload, created_by: profile!.id }).select().single();
      setSaving(false);
      if (err) { setError(err.message); return; }
      if (data) onCreated?.(data as Vehicle);
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!vehicle) return;
    setSaving(true);
    await supabase.from('vehicles').delete().eq('id', vehicle.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={vehicle ? vehicle.plate_number : 'Add Vehicle'} subtitle={vehicle ? timeAgo(vehicle.updated_at) + ' updated' : 'Plate, device and documents handed over with it'} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Plate Number</label>
          <input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} disabled={!editing} className="input" placeholder="RAD 123 A" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Make</label>
            <input value={make} onChange={(e) => setMake(e.target.value)} disabled={!editing} className="input" placeholder="Toyota" />
          </div>
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} disabled={!editing} className="input" placeholder="Corolla" />
          </div>
        </div>
        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Color</label>
          <input value={color} onChange={(e) => setColor(e.target.value)} disabled={!editing} className="input" placeholder="White" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Given To Us</label>
            <DateInput value={givenDate} onChange={setGivenDate} disabled={!editing} />
          </div>
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Operation Start</label>
            <DateInput value={operationStartDate} onChange={setOperationStartDate} disabled={!editing} />
          </div>
        </div>

        <div className="p-3 rounded-lg border border-line-muted space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-caption font-medium text-fg-muted">RURA License</p>
            <div className="flex gap-1 p-0.5 bg-inset rounded-lg">
              {(['pending', 'provided'] as RuraLicenseStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!editing}
                  onClick={() => setRuraStatus(s)}
                  className={`px-2.5 py-1 rounded-md text-micro font-medium transition-all ${ruraStatus === s ? 'bg-surface-2 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-fg-muted'}`}
                >
                  {s === 'pending' ? 'Pending' : 'Provided'}
                </button>
              ))}
            </div>
          </div>
          {ruraStatus === 'provided' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-micro font-medium mb-1 text-fg-muted">Issued</label>
                <DateInput value={ruraIssuedDate} onChange={handleIssuedDateChange} disabled={!editing} />
              </div>
              <div>
                <label className="block text-micro font-medium mb-1 text-fg-muted">Expires</label>
                <DateInput value={ruraExpiryDate} onChange={setRuraExpiryDate} disabled={!editing} />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Device Given</label>
          <input value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} disabled={!editing} className="input" placeholder="e.g. Tracker unit #114 / Android tablet" />
        </div>

        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Documents Given</label>
          <div className="space-y-1.5">
            {documents.map((doc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={doc}
                  onChange={(e) => updateDoc(i, e.target.value)}
                  disabled={!editing}
                  className="input flex-1 py-1.5"
                  placeholder="e.g. Logbook, Insurance Certificate"
                />
                {editing && (
                  <button type="button" onClick={() => removeDoc(i)} className="shrink-0 text-fg-subtle hover:text-red-500">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            {editing && (
              <button type="button" onClick={addDoc} className="text-caption text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 pt-0.5">
                <Plus size={12} /> Add document
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Condition, mileage, anything worth remembering…" />
        </div>

        {error && <div className="text-caption text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-line-muted ">
            {vehicle ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (vehicle ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !plateNumber.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : vehicle ? 'Save Changes' : 'Add Vehicle'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-line-muted ">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
