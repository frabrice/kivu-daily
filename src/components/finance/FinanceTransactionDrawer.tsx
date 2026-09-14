import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  supabase, FinanceAccount, FinanceTransaction, FinanceTransactionType, FinanceDirection,
  FinanceTransactionStatus, Driver, Vehicle, Document as Doc,
} from '../../lib/supabase';
import { TYPE_META, STATUS_META } from '../../lib/finance';
import { useAuth } from '../../lib/auth';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';

interface FinanceTransactionDrawerProps {
  tx: FinanceTransaction | null;
  startEditing: boolean;
  fixedType?: FinanceTransactionType;
  accounts: FinanceAccount[];
  drivers: Driver[];
  vehicles: Vehicle[];
  documents: Doc[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function FinanceTransactionDrawer({
  tx,
  startEditing,
  fixedType,
  accounts,
  drivers,
  vehicles,
  documents,
  canEdit,
  onClose,
  onSaved,
}: FinanceTransactionDrawerProps) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [type, setType] = useState<FinanceTransactionType>(tx?.type ?? fixedType ?? 'revenue');
  const [direction, setDirection] = useState<FinanceDirection>(tx?.direction ?? TYPE_META[tx?.type ?? fixedType ?? 'revenue'].defaultDirection);
  const [accountId, setAccountId] = useState(tx?.account_id ?? '');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  const [date, setDate] = useState(tx?.transaction_date ?? todayStr());
  const [counterparty, setCounterparty] = useState(tx?.counterparty ?? '');
  const [description, setDescription] = useState(tx?.description ?? '');
  const [linkedVehicleId, setLinkedVehicleId] = useState(tx?.linked_vehicle_id ?? '');
  const [linkedDriverId, setLinkedDriverId] = useState(tx?.linked_driver_id ?? '');
  const [supportingDocId, setSupportingDocId] = useState(tx?.supporting_document_id ?? '');
  const [status, setStatus] = useState<FinanceTransactionStatus>(tx?.status ?? 'pending');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const typeLocked = !!fixedType && !tx;
  const isTransfer = type === 'transfer';

  const save = async () => {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0 || !date) return;
    if (isTransfer && (!accountId || !toAccountId || accountId === toAccountId)) return;
    if (!isTransfer && !accountId) return;

    setSaving(true);
    setError('');

    const basePayload = {
      transaction_date: date,
      description: description.trim() || null,
      counterparty: counterparty.trim() || null,
      linked_vehicle_id: linkedVehicleId || null,
      linked_driver_id: linkedDriverId || null,
      supporting_document_id: supportingDocId || null,
      status,
      updated_at: new Date().toISOString(),
      ...(status === 'checked' && tx?.status !== 'checked' ? { checked_by: profile!.id, checked_at: new Date().toISOString() } : {}),
      ...(status === 'approved' && tx?.status !== 'approved' ? { approved_by: profile!.id, approved_at: new Date().toISOString() } : {}),
    };

    if (tx) {
      const { error: err } = await supabase.from('finance_transactions').update({
        ...basePayload, type, account_id: accountId, direction, amount: numAmount,
      }).eq('id', tx.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else if (isTransfer) {
      const groupId = crypto.randomUUID();
      const { error: err } = await supabase.from('finance_transactions').insert([
        { ...basePayload, type: 'transfer', account_id: accountId, direction: 'out', amount: numAmount, transfer_group_id: groupId, prepared_by: profile!.id, created_by: profile!.id },
        { ...basePayload, type: 'transfer', account_id: toAccountId, direction: 'in', amount: numAmount, transfer_group_id: groupId, prepared_by: profile!.id, created_by: profile!.id },
      ]);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else {
      const { error: err } = await supabase.from('finance_transactions').insert({
        ...basePayload, type, account_id: accountId, direction, amount: numAmount, prepared_by: profile!.id, created_by: profile!.id,
      });
      setSaving(false);
      if (err) { setError(err.message); return; }
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!tx) return;
    setSaving(true);
    if (tx.transfer_group_id) {
      await supabase.from('finance_transactions').delete().eq('transfer_group_id', tx.transfer_group_id);
    } else {
      await supabase.from('finance_transactions').delete().eq('id', tx.id);
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={tx ? tx.reference : `New ${TYPE_META[type].label}`} subtitle={tx ? TYPE_META[tx.type].label : 'Every ledger row needs a real account and a purpose'} maxWidth="max-w-lg">
      <div className="space-y-3">
        {!typeLocked && (
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Type</label>
            <select
              value={type}
              onChange={(e) => { const t = e.target.value as FinanceTransactionType; setType(t); setDirection(TYPE_META[t].defaultDirection); }}
              disabled={!editing || !!tx}
              className="input"
            >
              {(Object.keys(TYPE_META) as FinanceTransactionType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            </select>
          </div>
        )}

        {isTransfer ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">From Account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!editing || !!tx} className="input">
                <option value="">Select</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">To Account</label>
              <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} disabled={!editing || !!tx} className="input">
                <option value="">Select</option>
                {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!editing} className="input">
                <option value="">Select</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Direction</label>
              <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg">
                {(['in', 'out'] as FinanceDirection[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={!editing}
                    onClick={() => setDirection(d)}
                    className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all ${direction === d ? 'bg-white dark:bg-navy-800 shadow-sm' : 'text-gray-500'} ${d === 'in' ? 'text-positive' : 'text-red-500'}`}
                  >
                    {d === 'in' ? 'Cash In' : 'Cash Out'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Amount (RWF)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editing} className="input" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!editing} className="input" />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Counterparty</label>
          <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} disabled={!editing} className="input" placeholder="Vehicle owner, supplier, employee…" />
        </div>

        {(type === 'vehicle_owner_payment' || type === 'fleet_collection') && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Vehicle</label>
              <select value={linkedVehicleId} onChange={(e) => setLinkedVehicleId(e.target.value)} disabled={!editing} className="input">
                <option value="">None</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Driver</label>
              <select value={linkedDriverId} onChange={(e) => setLinkedDriverId(e.target.value)} disabled={!editing} className="input">
                <option value="">None</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editing} rows={2} className="input resize-none" placeholder="Purpose of this transaction…" />
        </div>

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Supporting Document</label>
          <select value={supportingDocId} onChange={(e) => setSupportingDocId(e.target.value)} disabled={!editing} className="input">
            <option value="">None linked</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as FinanceTransactionStatus)} disabled={!editing} className="input">
            {(Object.keys(STATUS_META) as FinanceTransactionStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>

        {tx && (
          <div className="text-[10px] text-gray-400 space-y-0.5 pt-1">
            {tx.preparer && <p>Prepared by {tx.preparer.full_name}</p>}
            {tx.checker && <p>Checked by {tx.checker.full_name}</p>}
            {tx.approver && <p>Approved by {tx.approver.full_name}</p>}
            {tx.system_generated && <p className="text-brand-600 dark:text-brand-300">Auto-posted from Fleet</p>}
          </div>
        )}

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {tx ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (tx ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !amount || !date} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : tx ? 'Save Changes' : 'Create Transaction'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && !tx?.system_generated && (
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
