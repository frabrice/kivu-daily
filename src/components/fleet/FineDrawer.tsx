import { useState } from 'react';
import { Trash2, Pencil, Banknote } from 'lucide-react';
import { supabase, DriverFine, Driver, Vehicle, DriverFinePayment } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo, todayStr } from '../../lib/utils';
import { fineAmountPaid, fineStatus, FINE_STATUS_STYLE, fineStatusLabel, formatDateLabelSafe } from '../../lib/fleet';
import Modal from '../Modal';
import DateInput from '../DateInput';
import LogFinePaymentDrawer from './LogFinePaymentDrawer';

export default function FineDrawer({
  fine,
  startEditing,
  drivers,
  vehicles,
  payments,
  canEdit,
  onClose,
  onSaved,
}: {
  fine: DriverFine | null;
  startEditing: boolean;
  drivers: Driver[];
  vehicles: Vehicle[];
  payments: DriverFinePayment[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [driverId, setDriverId] = useState(fine?.driver_id ?? '');
  const [vehicleId, setVehicleId] = useState(fine?.vehicle_id ?? '');
  const [amount, setAmount] = useState(fine ? String(fine.amount) : '');
  const [fineDate, setFineDate] = useState(fine?.fine_date ?? todayStr());
  const [reason, setReason] = useState(fine?.reason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [logPaymentOpen, setLogPaymentOpen] = useState(false);

  const fineHistory = fine ? payments.filter((p) => p.fine_id === fine.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date)) : [];
  const amountPaid = fine ? fineAmountPaid(fine.id, payments) : 0;
  const status = fine ? fineStatus(fine.amount, amountPaid) : 'unpaid';
  const statusStyle = FINE_STATUS_STYLE[status];
  const remaining = fine ? Math.max(fine.amount - amountPaid, 0) : 0;

  const save = async () => {
    const numAmount = Number(amount);
    if (!driverId || !vehicleId || !numAmount || numAmount <= 0 || !fineDate) return;
    setSaving(true);
    setError('');
    const payload = {
      driver_id: driverId,
      vehicle_id: vehicleId,
      amount: numAmount,
      fine_date: fineDate,
      reason: reason.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = fine
      ? await supabase.from('driver_fines').update(payload).eq('id', fine.id)
      : await supabase.from('driver_fines').insert({ ...payload, created_by: profile!.id });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!fine) return;
    setSaving(true);
    await supabase.from('driver_fines').delete().eq('id', fine.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={fine ? `${fine.amount.toLocaleString()} RWF fine` : 'Add Fine'} subtitle={fine ? timeAgo(fine.updated_at) + ' updated' : 'Amount, date, driver, and the car that was fined'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Amount (RWF)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editing} className="input" placeholder="20000" autoFocus />
          </div>
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Date</label>
            <DateInput value={fineDate} onChange={setFineDate} disabled={!editing} />
          </div>
        </div>
        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Driver</label>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!editing} className="input">
            <option value="">Select a driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Car Fined</label>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!editing} className="input">
            <option value="">Select a car</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate_number}{v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Reason (optional)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={!editing} rows={2} className="input resize-none" placeholder="e.g. speeding, illegal parking…" />
        </div>

        {fine && (
          <div className={`card p-3 border ${statusStyle.border}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-micro font-semibold uppercase tracking-wide text-fg-subtle flex items-center gap-1.5"><Banknote size={12} /> Payment Status</p>
              <span className={`inline-flex items-center gap-1.5 text-micro font-medium px-2 py-0.5 rounded-full ${statusStyle.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} /> {fineStatusLabel(status, fine.amount, amountPaid)}
              </span>
            </div>
            {status !== 'paid' && (
              <p className="text-caption text-fg-muted mb-2">
                <span className="font-medium text-fg-muted ">{remaining.toLocaleString()} RWF</span> still owed
              </p>
            )}
            {fineHistory.length === 0 ? (
              <p className="text-caption text-fg-subtle mb-2">No payments logged yet.</p>
            ) : (
              <div className="space-y-1 mb-2">
                {fineHistory.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-caption py-1 border-b border-line-muted last:border-0">
                    <span className="text-fg-muted ">{formatDateLabelSafe(p.paid_date)}</span>
                    <span className="font-medium">{p.amount.toLocaleString()} RWF</span>
                  </div>
                ))}
              </div>
            )}
            {canEdit && status !== 'paid' && (
              <button type="button" onClick={() => setLogPaymentOpen(true)} className="btn-primary w-full text-center">
                Log Payment
              </button>
            )}
          </div>
        )}

        {error && <div className="text-caption text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-line-muted ">
            {fine ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (fine ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !driverId || !vehicleId || !Number(amount) || !fineDate} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : fine ? 'Save Changes' : 'Add Fine'}
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

      {logPaymentOpen && fine && (
        <LogFinePaymentDrawer
          fine={fine}
          remaining={remaining}
          onClose={() => setLogPaymentOpen(false)}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}
