import { useState } from 'react';
import { Trash2, Flag, Pencil, CalendarDays, Sun, Moon, Phone, Mail, Car, Wallet, Receipt, Clock, BedDouble } from 'lucide-react';
import { supabase, Driver, DriverStage, Vehicle, DriverShift, DriverRestDay, DriverDeposit, DriverFine, DriverFinePayment } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo, todayStr } from '../../lib/utils';
import { STAGES, REST_DAYS, depositDaysSince, depositTier, DEPOSIT_TIER_STYLE, depositStatusLabel, nextDepositDueDate, formatDateLabelSafe, fineAmountPaid, fineStatus, FINE_STATUS_STYLE, fineStatusLabel } from '../../lib/fleet';
import Modal from '../Modal';
import FlagToITDrawer from '../FlagToITDrawer';
import VehicleDrawer from './VehicleDrawer';

export default function DriverDrawer({
  driver,
  startEditing,
  vehicles,
  drivers,
  deposits,
  fines,
  finePayments,
  canEdit,
  onClose,
  onSaved,
}: {
  driver: Driver | null;
  startEditing: boolean;
  vehicles: Vehicle[];
  drivers: Driver[];
  deposits: DriverDeposit[];
  fines: DriverFine[];
  finePayments: DriverFinePayment[];
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
  const [initialDepositDate, setInitialDepositDate] = useState(driver?.initial_deposit_date ?? '');
  const [stage, setStage] = useState<DriverStage>(driver?.stage ?? 'applying');
  const [notes, setNotes] = useState(driver?.notes ?? '');
  const [vehicleId, setVehicleId] = useState(driver?.vehicle_id ?? '');
  const [shift, setShift] = useState<DriverShift | ''>(driver?.shift ?? '');
  const [restDay, setRestDay] = useState<DriverRestDay | ''>(driver?.rest_day ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const shiftTakenBy = (s: DriverShift) => drivers.find((d) => d.vehicle_id === vehicleId && d.id !== driver?.id && d.shift === s);
  const vehicleFull = !!selectedVehicle && drivers.filter((d) => d.vehicle_id === vehicleId && d.id !== driver?.id).length >= 2;
  const stageMeta = driver ? STAGES.find((s) => s.key === driver.stage) : null;

  const driverDeposits = driver ? deposits.filter((dep) => dep.driver_id === driver.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date)) : [];
  const lastLoggedDeposit = driverDeposits[0]?.paid_date ?? null;
  const daysSinceDeposit = driver ? depositDaysSince(lastLoggedDeposit, driver.initial_deposit_paid, driver.initial_deposit_date) : null;
  const tier = depositTier(daysSinceDeposit);
  const tierStyle = DEPOSIT_TIER_STYLE[tier];
  const nextDue = driver ? nextDepositDueDate(lastLoggedDeposit, driver.initial_deposit_paid, driver.initial_deposit_date) : null;

  const driverFines = driver ? fines.filter((f) => f.driver_id === driver.id).sort((a, b) => b.fine_date.localeCompare(a.fine_date)) : [];
  const restDayLabel = driver?.rest_day ? REST_DAYS.find((d) => d.key === driver.rest_day)?.label : null;

  const save = async () => {
    if (!fullName.trim() || !phone.trim()) return;
    if (vehicleId && !shift) {
      setError('Pick a shift for this driver on the assigned vehicle.');
      return;
    }
    if (initialDepositPaid && !initialDepositDate) {
      setError('Enter the date the initial deposit was paid.');
      return;
    }
    if (!restDay) {
      setError('Every driver must be assigned a weekly rest day.');
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
      initial_deposit_date: initialDepositPaid ? initialDepositDate : null,
      stage,
      notes: notes.trim() || null,
      vehicle_id: vehicleId || null,
      shift: vehicleId ? shift || null : null,
      rest_day: restDay || null,
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
    <Modal
      open
      onClose={onClose}
      title={driver ? driver.full_name : 'Add Driver'}
      subtitle={driver ? timeAgo(driver.updated_at) + ' updated' : undefined}
      maxWidth={!editing && driver ? 'max-w-2xl' : 'max-w-lg'}
    >
      {!editing && driver ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {stageMeta && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${stageMeta.color}20`, color: stageMeta.color }}>
                {stageMeta.label}
              </span>
            )}
            {driver.vehicle ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-600 dark:text-brand-300 bg-brand/10 px-2 py-0.5 rounded-full">
                <Car size={10} /> {driver.vehicle.plate_number}
                {driver.shift && <span>· {driver.shift === 'day' ? 'Day shift' : 'Night shift'}</span>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
                <Car size={10} /> No vehicle assigned
              </span>
            )}
            {restDayLabel ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full">
                <BedDouble size={10} /> Rests on {restDayLabel}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-full">
                <BedDouble size={10} /> No rest day set
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Phone size={10} /> Phone</p>
              <p className="text-[12px] font-medium">{driver.phone}</p>
            </div>
            <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Mail size={10} /> Email</p>
              <p className="text-[12px] font-medium truncate">{driver.email || <span className="text-gray-400 font-normal">Not provided</span>}</p>
            </div>
            <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><CalendarDays size={10} /> Join Date</p>
              <p className="text-[12px] font-medium">{driver.join_date ? formatDateLabelSafe(driver.join_date) : <span className="text-gray-400 font-normal">Not set</span>}</p>
            </div>
            <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Clock size={10} /> Initial Deposit</p>
              <p className="text-[12px] font-medium">
                {driver.initial_deposit_paid
                  ? `Paid${driver.initial_deposit_date ? ' · ' + formatDateLabelSafe(driver.initial_deposit_date) : ''}`
                  : <span className="text-gray-400 font-normal">Not paid</span>}
              </p>
            </div>
          </div>

          <div className="card p-3.5 border border-gray-100 dark:border-white/5">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Wallet size={12} /> Deposits</p>
              <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${tierStyle.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tierStyle.dot}`} /> {depositStatusLabel(daysSinceDeposit)}
              </span>
            </div>
            {nextDue && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2.5">
                Next deposit due <span className="font-medium text-gray-700 dark:text-gray-200">{formatDateLabelSafe(nextDue)}</span>
              </p>
            )}
            {driverDeposits.length === 0 ? (
              <p className="text-[11px] text-gray-400">No deposits logged yet.</p>
            ) : (
              <div className="space-y-1">
                {driverDeposits.map((dep) => (
                  <div key={dep.id} className="flex items-center justify-between text-[11px] py-1 border-b border-gray-50 dark:border-white/5 last:border-0">
                    <span className="text-gray-500 dark:text-gray-400">{formatDateLabelSafe(dep.paid_date)}</span>
                    <span className="font-medium">{dep.amount.toLocaleString()} RWF</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-3.5 border border-gray-100 dark:border-white/5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2.5 flex items-center gap-1.5"><Receipt size={12} /> Fines</p>
            {driverFines.length === 0 ? (
              <p className="text-[11px] text-gray-400">No fine.</p>
            ) : (
              <div className="space-y-2">
                {driverFines.map((f) => {
                  const amountPaid = fineAmountPaid(f.id, finePayments);
                  const status = fineStatus(f.amount, amountPaid);
                  const statusStyle = FINE_STATUS_STYLE[status];
                  return (
                    <div key={f.id} className="py-1 border-b border-gray-50 dark:border-white/5 last:border-0">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="min-w-0">
                          <p className="text-gray-500 dark:text-gray-400">{formatDateLabelSafe(f.fine_date)}</p>
                          {f.reason && <p className="text-gray-400 truncate">{f.reason}</p>}
                        </div>
                        <span className="font-medium shrink-0">{f.amount.toLocaleString()} RWF</span>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 text-[9px] font-medium px-2 py-0.5 rounded-full mt-1 ${statusStyle.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} /> {fineStatusLabel(status, f.amount, amountPaid)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {driver.notes && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Notes</p>
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{driver.notes}</p>
            </div>
          )}

          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {canEdit ? (
              <button onClick={() => setFlagOpen(true)} className="btn-ghost text-gray-500 flex items-center gap-1.5">
                <Flag size={13} /> Flag to IT
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Close</button>
              {canEdit && (
                <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                  <Pencil size={13} /> Edit
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Full Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!editing} className="input" placeholder="Jean Baptiste" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} className="input" placeholder="+250 7XX XXX XXX" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} className="input" placeholder="jean@example.com" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><CalendarDays size={11} /> Join Date</label>
            <input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} disabled={!editing} className="input" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value as DriverStage)} disabled={!editing} className="input">
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <div className={`p-2.5 rounded-lg border space-y-2 ${restDay ? 'border-indigo-300 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-500/5' : 'border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'}`}>
          <label className="block text-[11px] font-medium mb-1.5 flex items-center gap-1"><BedDouble size={11} /> Weekly Rest Day <span className="text-red-500">*</span></label>
          <select value={restDay} onChange={(e) => setRestDay(e.target.value as DriverRestDay)} disabled={!editing} className="input">
            <option value="">Select a day…</option>
            {REST_DAYS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <p className="text-[9px] text-gray-400">Every driver must have one fixed day off each week.</p>
        </div>

        <div className={`p-2.5 rounded-lg border space-y-2 ${initialDepositPaid ? 'border-brand/30 bg-brand/5' : 'border-gray-200 dark:border-white/10'}`}>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={initialDepositPaid}
              onChange={(e) => {
                setInitialDepositPaid(e.target.checked);
                if (e.target.checked && !initialDepositDate) setInitialDepositDate(todayStr());
              }}
              disabled={!editing}
              className="w-4 h-4 accent-brand"
            />
            <span className="text-[11px] font-medium">Initial deposit paid</span>
          </label>
          {initialDepositPaid && (
            <div>
              <label className="block text-[10px] font-medium mb-1 text-gray-500 flex items-center gap-1"><CalendarDays size={10} /> Date Paid</label>
              <input type="date" value={initialDepositDate} onChange={(e) => setInitialDepositDate(e.target.value)} disabled={!editing} className="input" />
              <p className="text-[9px] text-gray-400 mt-1">The weekly deposit cycle in Deposits counts from here until a real deposit is logged.</p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Assigned Vehicle</label>
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
            <button type="button" onClick={() => setAddVehicleOpen(true)} className="text-[10px] text-brand-600 dark:text-brand-300 hover:underline mt-1.5">
              + Add a new vehicle
            </button>
          )}

          {selectedVehicle && (
            <div className="mt-2 p-2.5 rounded-lg bg-gray-50 dark:bg-white/5 space-y-2">
              {(selectedVehicle.make || selectedVehicle.model || selectedVehicle.color) && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  {[selectedVehicle.make, selectedVehicle.model, selectedVehicle.color].filter(Boolean).join(' · ')}
                </p>
              )}
              <div>
                <p className="text-[10px] font-medium text-gray-500 mb-1">Shift</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['day', 'night'] as DriverShift[]).map((s) => {
                    const taken = shiftTakenBy(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={!editing || !!taken}
                        onClick={() => setShift(s)}
                        className={`p-2 rounded-lg border text-left text-[11px] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                          shift === s ? 'border-brand bg-brand/10' : 'border-gray-200 dark:border-white/10'
                        }`}
                      >
                        {s === 'day' ? <Sun size={12} /> : <Moon size={12} />}
                        {s === 'day' ? 'Day' : 'Night'}
                        {taken && <span className="text-[9px] text-gray-400">· {taken.full_name}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Onboarding progress, issues, follow-ups…" />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

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
              <button onClick={save} disabled={saving || !fullName.trim() || !phone.trim() || vehicleFull || (initialDepositPaid && !initialDepositDate) || !restDay} className="btn-primary disabled:opacity-50">
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
      )}

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
