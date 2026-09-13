import { useState } from 'react';
import { Trash2, Flag, Pencil, CalendarDays, Sun, Moon } from 'lucide-react';
import { supabase, Driver, DriverStage, Vehicle, DriverShift } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo, todayStr } from '../../lib/utils';
import { STAGES } from '../../lib/fleet';
import Modal from '../Modal';
import FlagToITDrawer from '../FlagToITDrawer';
import VehicleDrawer from './VehicleDrawer';

export default function DriverDrawer({
  driver,
  startEditing,
  vehicles,
  drivers,
  canEdit,
  onClose,
  onSaved,
}: {
  driver: Driver | null;
  startEditing: boolean;
  vehicles: Vehicle[];
  drivers: Driver[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [fullName, setFullName] = useState(driver?.full_name ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [email, setEmail] = useState(driver?.email ?? '');
  const [joinDate, setJoinDate] = useState(driver?.join_date ?? todayStr());
  const [initialDepositPaid, setInitialDepositPaid] = useState(driver?.initial_deposit_paid ?? false);
  const [stage, setStage] = useState<DriverStage>(driver?.stage ?? 'applying');
  const [notes, setNotes] = useState(driver?.notes ?? '');
  const [vehicleId, setVehicleId] = useState(driver?.vehicle_id ?? '');
  const [shift, setShift] = useState<DriverShift | ''>(driver?.shift ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const shiftTakenBy = (s: DriverShift) => drivers.find((d) => d.vehicle_id === vehicleId && d.id !== driver?.id && d.shift === s);
  const vehicleFull = !!selectedVehicle && drivers.filter((d) => d.vehicle_id === vehicleId && d.id !== driver?.id).length >= 2;

  const save = async () => {
    if (!fullName.trim() || !phone.trim()) return;
    if (vehicleId && !shift) {
      setError('Pick a shift for this driver on the assigned vehicle.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      join_date: joinDate || null,
      initial_deposit_paid: initialDepositPaid,
      stage,
      notes: notes.trim() || null,
      vehicle_id: vehicleId || null,
      shift: vehicleId ? shift || null : null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = driver
      ? await supabase.from('drivers').update(payload).eq('id', driver.id)
      : await supabase.from('drivers').insert({ ...payload, created_by: profile!.id });
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
    await supabase.from('drivers').delete().eq('id', driver.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={driver ? driver.full_name : 'Add Driver'} subtitle={driver ? timeAgo(driver.updated_at) + ' updated' : undefined} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Full Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!editing} className="input" placeholder="Jean Baptiste" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} className="input" placeholder="+250 7XX XXX XXX" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} className="input" placeholder="jean@example.com" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><CalendarDays size={11} /> Join Date</label>
            <input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} disabled={!editing} className="input" />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value as DriverStage)} disabled={!editing} className="input">
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <label className={`flex items-center gap-2.5 p-2.5 rounded-lg border ${initialDepositPaid ? 'border-brand/30 bg-brand/5' : 'border-gray-200 dark:border-white/10'}`}>
          <input type="checkbox" checked={initialDepositPaid} onChange={(e) => setInitialDepositPaid(e.target.checked)} disabled={!editing} className="w-4 h-4 accent-brand" />
          <span className="text-[12px] font-medium">Initial deposit paid</span>
        </label>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Assigned Vehicle</label>
          <select value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setShift(''); }} disabled={!editing} className="input">
            <option value="">No vehicle assigned</option>
            {vehicles.map((v) => {
              const others = drivers.filter((d) => d.vehicle_id === v.id && d.id !== driver?.id);
              const full = others.length >= 2 && v.id !== driver?.vehicle_id;
              return (
                <option key={v.id} value={v.id} disabled={full}>
                  {v.plate_number}{v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}
                  {others.length > 0 ? ` (${others.map((d) => `${d.full_name}: ${d.shift === 'day' ? 'Day' : 'Night'}`).join(', ')})` : ''}
                  {full ? ' — full' : ''}
                </option>
              );
            })}
          </select>
          {editing && (
            <button type="button" onClick={() => setAddVehicleOpen(true)} className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline mt-1.5">
              + Add a new vehicle
            </button>
          )}

          {selectedVehicle && (
            <div className="mt-2 p-2.5 rounded-lg bg-gray-50 dark:bg-white/5 space-y-2">
              {(selectedVehicle.make || selectedVehicle.model || selectedVehicle.color) && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {[selectedVehicle.make, selectedVehicle.model, selectedVehicle.color].filter(Boolean).join(' · ')}
                </p>
              )}
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-1">Shift</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['day', 'night'] as DriverShift[]).map((s) => {
                    const taken = shiftTakenBy(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={!editing || !!taken}
                        onClick={() => setShift(s)}
                        className={`p-2 rounded-lg border text-left text-[12px] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                          shift === s ? 'border-brand bg-brand/10' : 'border-gray-200 dark:border-white/10'
                        }`}
                      >
                        {s === 'day' ? <Sun size={12} /> : <Moon size={12} />}
                        {s === 'day' ? 'Day' : 'Night'}
                        {taken && <span className="text-[10px] text-gray-400">· {taken.full_name}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Onboarding progress, issues, follow-ups…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {driver ? (
              <div className="flex gap-2">
                <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                  <Trash2 size={13} /> Remove
                </button>
                <button onClick={() => setFlagOpen(true)} disabled={saving} className="btn-ghost text-gray-500 flex items-center gap-1.5">
                  <Flag size={13} /> Flag to IT
                </button>
              </div>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (driver ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !fullName.trim() || !phone.trim() || vehicleFull} className="btn-primary disabled:opacity-50">
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

      {flagOpen && driver && (
        <FlagToITDrawer
          entityType="driver"
          entityId={driver.id}
          entityLabel={`Driver: ${driver.full_name}`}
          onClose={() => setFlagOpen(false)}
        />
      )}

      {addVehicleOpen && (
        <VehicleDrawer
          vehicle={null}
          startEditing
          canEdit={canEdit}
          onClose={() => setAddVehicleOpen(false)}
          onSaved={() => {}}
          onCreated={(v) => setVehicleId(v.id)}
        />
      )}
    </Modal>
  );
}
