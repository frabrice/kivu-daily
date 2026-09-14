import { useState } from 'react';
import { Users2, Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react';
import { supabase, PayrollRun } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useFinanceData, fmt } from '../../lib/finance';
import { todayStr } from '../../lib/utils';
import Modal from '../../components/Modal';
import EntryActions from '../../components/EntryActions';

export default function FinancePayrollPage() {
  const { profile } = useAuth();
  const { accounts, payrollRuns, employees, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const [drawer, setDrawer] = useState<PayrollRun | 'new' | null>(null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Users2 size={16} className="text-amber-600 dark:text-amber-300" /> Payroll</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Funded Equity → I&M, paid from I&M. Each run reconciled against the bank statement.</p>
        </div>
        {canEdit && (
          <button onClick={() => setDrawer('new')} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> New Payroll Run
          </button>
        )}
      </div>

      {payrollRuns.length === 0 ? (
        <div className="card p-12 text-center">
          <Users2 size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No payroll runs yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {payrollRuns.map((r) => (
            <div key={r.id} onClick={() => setDrawer(r)} className="card p-3.5 flex items-center gap-3 cursor-pointer hover:shadow-md hover:border-brand/30 transition-all">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium">{r.period}</p>
                <p className="text-[10px] text-gray-400">{r.lines?.length ?? 0} employee{(r.lines?.length ?? 0) === 1 ? '' : 's'}</p>
              </div>
              <p className="text-[12px] font-semibold">{fmt(r.total_amount)}</p>
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-gray-500 capitalize">{r.status}</span>
              <EntryActions onView={() => setDrawer(r)} onEdit={() => setDrawer(r)} canEdit={canEdit} />
            </div>
          ))}
        </div>
      )}

      {drawer && (
        <PayrollDrawer
          run={drawer === 'new' ? null : drawer}
          employees={employees}
          accounts={accounts}
          canEdit={canEdit}
          onClose={() => setDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function PayrollDrawer({
  run,
  employees,
  accounts,
  canEdit,
  onClose,
  onSaved,
}: {
  run: PayrollRun | null;
  employees: ReturnType<typeof useFinanceData>['employees'];
  accounts: ReturnType<typeof useFinanceData>['accounts'];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(!run);
  const [period, setPeriod] = useState(run?.period ?? todayStr().slice(0, 7));
  const [lines, setLines] = useState<{ employee_id: string; gross_amount: string; deductions: string }[]>(
    run?.lines?.map((l) => ({ employee_id: l.employee_id, gross_amount: String(l.gross_amount), deductions: String(l.deductions) })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = lines.reduce((s, l) => s + (Number(l.gross_amount) - Number(l.deductions || 0)), 0);

  const addLine = () => setLines((prev) => [...prev, { employee_id: '', gross_amount: '', deductions: '0' }]);
  const updateLine = (i: number, patch: Partial<{ employee_id: string; gross_amount: string; deductions: string }>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const saveDraft = async () => {
    setSaving(true);
    setError('');
    const validLines = lines.filter((l) => l.employee_id && Number(l.gross_amount) > 0);
    if (validLines.length === 0) { setSaving(false); setError('Add at least one employee with a gross amount.'); return; }

    let runId = run?.id;
    if (!runId) {
      const { data, error: err } = await supabase.from('payroll_runs').insert({
        period, total_amount: total, prepared_by: profile!.id,
      }).select().single();
      if (err) { setSaving(false); setError(err.message); return; }
      runId = data!.id;
    } else {
      await supabase.from('payroll_runs').update({ total_amount: total, updated_at: new Date().toISOString() }).eq('id', runId);
      await supabase.from('payroll_lines').delete().eq('payroll_run_id', runId);
    }

    const { error: linesErr } = await supabase.from('payroll_lines').insert(
      validLines.map((l) => ({ payroll_run_id: runId, employee_id: l.employee_id, gross_amount: Number(l.gross_amount), deductions: Number(l.deductions || 0) }))
    );
    setSaving(false);
    if (linesErr) { setError(linesErr.message); return; }
    onSaved();
    onClose();
  };

  const approveAndPay = async () => {
    if (!run) return;
    setSaving(true);
    setError('');
    const equity = accounts.find((a) => a.key === 'equity');
    const im = accounts.find((a) => a.key === 'im_bank');
    if (!equity || !im) { setSaving(false); setError('Bank accounts not found.'); return; }

    const groupId = crypto.randomUUID();
    const { error: transferErr } = await supabase.from('finance_transactions').insert([
      { type: 'transfer', account_id: equity.id, direction: 'out', amount: run.total_amount, transaction_date: todayStr(), description: 'Payroll funding — ' + run.period, transfer_group_id: groupId, prepared_by: profile!.id, created_by: profile!.id, status: 'approved', approved_by: profile!.id, approved_at: new Date().toISOString() },
      { type: 'transfer', account_id: im.id, direction: 'in', amount: run.total_amount, transaction_date: todayStr(), description: 'Payroll funding — ' + run.period, transfer_group_id: groupId, prepared_by: profile!.id, created_by: profile!.id, status: 'approved', approved_by: profile!.id, approved_at: new Date().toISOString() },
    ]);
    if (transferErr) { setSaving(false); setError(transferErr.message); return; }

    const { data: payTx, error: payErr } = await supabase.from('finance_transactions').insert({
      type: 'payroll', account_id: im.id, direction: 'out', amount: run.total_amount, transaction_date: todayStr(),
      description: 'Payroll — ' + run.period, prepared_by: profile!.id, created_by: profile!.id,
      status: 'approved', approved_by: profile!.id, approved_at: new Date().toISOString(),
    }).select().single();
    if (payErr) { setSaving(false); setError(payErr.message); return; }

    await supabase.from('payroll_runs').update({
      status: 'paid', approved_by: profile!.id, finance_transaction_id: payTx!.id, updated_at: new Date().toISOString(),
    }).eq('id', run.id);

    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={run ? `Payroll — ${run.period}` : 'New Payroll Run'} subtitle="Funded Equity → I&M, paid from I&M" maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Period</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} disabled={!editing || !!run} className="input" />
        </div>

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Employees</label>
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select value={l.employee_id} onChange={(e) => updateLine(i, { employee_id: e.target.value })} disabled={!editing} className="input flex-1">
                  <option value="">Select employee</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
                <input type="number" value={l.gross_amount} onChange={(e) => updateLine(i, { gross_amount: e.target.value })} disabled={!editing} placeholder="Gross" className="input w-28" />
                <input type="number" value={l.deductions} onChange={(e) => updateLine(i, { deductions: e.target.value })} disabled={!editing} placeholder="Deductions" className="input w-28" />
                {editing && (
                  <button type="button" onClick={() => removeLine(i)} className="shrink-0 text-gray-300 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {editing && (
              <button type="button" onClick={addLine} className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 pt-0.5">
                <Plus size={12} /> Add employee
              </button>
            )}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-white/5 flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Total net payroll</span>
          <span className="text-[13px] font-semibold">{fmt(total)}</span>
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          {run?.status === 'paid' ? (
            <p className="text-[11px] text-positive font-medium flex items-center gap-1.5"><ShieldCheck size={14} /> Paid</p>
          ) : editing ? (
            <div className="flex gap-2 ml-auto">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={saveDraft} disabled={saving} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
            </div>
          ) : (
            <div className="flex gap-2 ml-auto">
              {canEdit && <button onClick={() => setEditing(true)} className="btn-ghost flex items-center gap-1.5"><Pencil size={13} /> Edit</button>}
              {canEdit && (
                <button onClick={approveAndPay} disabled={saving} className="btn-primary disabled:opacity-50">
                  {saving ? 'Processing…' : 'Approve & Pay'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
