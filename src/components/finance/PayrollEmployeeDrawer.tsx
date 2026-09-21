import { useState } from 'react';
import { Trash2, Pencil, CheckCircle2, ExternalLink } from 'lucide-react';
import { supabase, PayrollEmployee, PayrollEmployeeStatus } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { todayStr, timeAgo } from '../../lib/utils';
import Modal from '../Modal';
import DateInput from '../DateInput';

// A payroll employee is a standalone record - it doesn't need a Kivu
// Daily login, since payroll covers everyone Kivu pays, not just people
// who use the app. The ID document uploads straight to the shared
// 'documents' bucket the moment a file is picked, same convention as
// driver documents, independent of the rest of the form's Save.
export default function PayrollEmployeeDrawer({
  employee,
  startEditing,
  canEdit,
  onClose,
  onSaved,
}: {
  employee: PayrollEmployee | null;
  startEditing: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [fullName, setFullName] = useState(employee?.full_name ?? '');
  const [position, setPosition] = useState(employee?.position ?? '');
  const [startDate, setStartDate] = useState(employee?.start_date ?? todayStr());
  const [monthlySalary, setMonthlySalary] = useState(employee ? String(employee.monthly_salary) : '');
  const [status, setStatus] = useState<PayrollEmployeeStatus>(employee?.status ?? 'active');
  const [notes, setNotes] = useState(employee?.notes ?? '');
  const [idDocUrl, setIdDocUrl] = useState(employee?.id_document_url ?? '');
  const [idDocName, setIdDocName] = useState(employee?.id_document_name ?? '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = fullName.trim() && position.trim() && startDate && Number(monthlySalary) > 0;

  const uploadId = async (file: File) => {
    setUploading(true);
    setError('');
    const path = `payroll/${employee?.id ?? 'new-' + crypto.randomUUID()}/id-${crypto.randomUUID()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage.from('documents').upload(path, file);
    setUploading(false);
    if (uploadErr) { setError(uploadErr.message); return; }
    setIdDocUrl(path);
    setIdDocName(file.name);
  };

  const viewId = async () => {
    if (!idDocUrl) return;
    setError('');
    const { data, error: err } = await supabase.storage.from('documents').createSignedUrl(idDocUrl, 3600);
    if (err || !data) { setError(err?.message ?? 'Could not open this file.'); return; }
    window.open(data.signedUrl, '_blank');
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const payload = {
      full_name: fullName.trim(),
      position: position.trim(),
      start_date: startDate,
      monthly_salary: Number(monthlySalary),
      status,
      end_date: status === 'inactive' ? (employee?.end_date ?? todayStr()) : null,
      notes: notes.trim() || null,
      id_document_url: idDocUrl || null,
      id_document_name: idDocName || null,
      updated_at: new Date().toISOString(),
    };
    if (employee) {
      const { error: err } = await supabase.from('payroll_employees').update(payload).eq('id', employee.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else {
      const { error: err } = await supabase.from('payroll_employees').insert({ ...payload, created_by: profile!.id });
      setSaving(false);
      if (err) { setError(err.message); return; }
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!employee) return;
    setSaving(true);
    await supabase.from('payroll_employees').delete().eq('id', employee.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={employee ? employee.full_name : 'Add Employee'} subtitle={employee ? timeAgo(employee.updated_at) + ' updated' : 'Position, start date, salary and their ID'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Full Name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!editing} className="input" placeholder="e.g. Jean Bosco Habimana" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Position</label>
            <input value={position} onChange={(e) => setPosition(e.target.value)} disabled={!editing} className="input" placeholder="e.g. Call Center Agent" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Start Date</label>
            <DateInput value={startDate} onChange={setStartDate} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Monthly Salary</label>
            <input type="number" value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} disabled={!editing} className="input" placeholder="e.g. 300000" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as PayrollEmployeeStatus)} disabled={!editing} className="input">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">ID Document</label>
          <div className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 dark:border-white/10">
            <div className="flex-1 min-w-0">
              {idDocUrl ? (
                <button type="button" onClick={viewId} className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 truncate">
                  <ExternalLink size={11} className="shrink-0" /> <span className="truncate">{idDocName}</span>
                </button>
              ) : (
                <p className="text-[11px] text-gray-400">Not uploaded</p>
              )}
            </div>
            {idDocUrl && <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />}
            {editing && (
              <label className={`shrink-0 text-center whitespace-nowrap cursor-pointer ${idDocUrl ? 'btn-ghost' : 'btn-primary'} ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploading ? 'Uploading…' : idDocUrl ? 'Replace' : 'Upload'}
                <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadId(f); e.target.value = ''; }} />
              </label>
            )}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={2} className="input resize-none" placeholder="Anything worth remembering…" />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {employee ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (employee ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : employee ? 'Save Changes' : 'Add Employee'}
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
