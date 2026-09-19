import { useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { supabase, VehicleOwner, PaymentDay } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo } from '../../lib/utils';
import Modal from '../Modal';

export default function VehicleOwnerDrawer({
  owner,
  startEditing,
  canEdit,
  onClose,
  onSaved,
  onCreated,
}: {
  owner: VehicleOwner | null;
  startEditing: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCreated?: (owner: VehicleOwner) => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [fullName, setFullName] = useState(owner?.full_name ?? '');
  const [phone, setPhone] = useState(owner?.phone ?? '');
  const [email, setEmail] = useState(owner?.email ?? '');
  const [bankName, setBankName] = useState(owner?.bank_name ?? '');
  const [accountNumber, setAccountNumber] = useState(owner?.account_number ?? '');
  const [paymentDay, setPaymentDay] = useState<PaymentDay | ''>(owner?.payment_day ?? '');
  const [notes, setNotes] = useState(owner?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = fullName.trim() && phone.trim();

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const payload = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      bank_name: bankName.trim() || null,
      account_number: accountNumber.trim() || null,
      payment_day: paymentDay || null,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (owner) {
      const { error: err } = await supabase.from('vehicle_owners').update(payload).eq('id', owner.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else {
      const { data, error: err } = await supabase.from('vehicle_owners').insert({ ...payload, created_by: profile!.id }).select().single();
      setSaving(false);
      if (err) { setError(err.message); return; }
      if (data) onCreated?.(data as VehicleOwner);
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!owner) return;
    setSaving(true);
    await supabase.from('vehicle_owners').delete().eq('id', owner.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={owner ? owner.full_name : 'Add Vehicle Owner'} subtitle={owner ? timeAgo(owner.updated_at) + ' updated' : 'Bank details used for their weekly payout'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Full Name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!editing} className="input" placeholder="e.g. Jean Bosco Habimana" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} className="input" placeholder="078xxxxxxx" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} className="input" placeholder="Optional" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Bank Name</label>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} disabled={!editing} className="input" placeholder="e.g. Bank of Kigali" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Account Number</label>
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} disabled={!editing} className="input" placeholder="Account number" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Payment Day</label>
          <select value={paymentDay} onChange={(e) => setPaymentDay(e.target.value as PaymentDay | '')} disabled={!editing} className="input">
            <option value="">Not set</option>
            {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as PaymentDay[]).map((d) => (
              <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">Reference only — the weekly payout schedule itself still follows each car's own operation start date.</p>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={2} className="input resize-none" placeholder="Contract terms, anything worth remembering…" />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {owner ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (owner ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : owner ? 'Save Changes' : 'Add Owner'}
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
    </Modal>
  );
}
