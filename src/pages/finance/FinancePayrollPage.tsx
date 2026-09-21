import { useMemo, useState } from 'react';
import { Users2, Plus, Pencil, Trash2, ShieldCheck, Wallet, CalendarClock, ExternalLink, CheckCircle2 } from 'lucide-react';
import { supabase, PayrollRun, PayrollEmployee } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useFinanceData, fmt, nextInternalPaymentDate, daysUntil } from '../../lib/finance';
import { todayStr, dateStr } from '../../lib/utils';
import { formatDateLabelSafe } from '../../lib/fleet';
import Modal from '../../components/Modal';
import EntryActions from '../../components/EntryActions';
import KpiTile from '../../components/KpiTile';
import DataTable from '../../components/DataTable';
import PayrollEmployeeDrawer from '../../components/finance/PayrollEmployeeDrawer';

type Tab = 'employees' | 'runs';

// Internal Payroll covers everyone Kivu pays a fixed monthly salary,
// independent of whether they use the app - Finance creates each
// employee directly (position, start date, salary, ID), and they're
// all paid on the same shared day of the month (payroll_settings).
// Payroll Runs is the existing month-by-month batch mechanism, kept as-
// is - a new run just pre-fills its lines from each active employee's
// current salary instead of starting empty, still fully editable.
export default function FinancePayrollPage() {
  const { profile } = useAuth();
  const { accounts, payrollRuns, payrollEmployees, payrollSettings, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const [tab, setTab] = useState<Tab>('employees');
  const [runDrawer, setRunDrawer] = useState<PayrollRun | 'new' | null>(null);
  const [employeeDrawer, setEmployeeDrawer] = useState<{ employee: PayrollEmployee | null; startEditing: boolean } | null>(null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Users2 size={16} className="text-amber-600 dark:text-amber-300" /> Internal Payroll</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Funded Equity → I&M, paid from I&M. Every employee is paid on the same shared date each month.</p>
        </div>
        {canEdit && tab === 'employees' && (
          <button onClick={() => setEmployeeDrawer({ employee: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> Add Employee
          </button>
        )}
        {canEdit && tab === 'runs' && (
          <button onClick={() => setRunDrawer('new')} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> New Payroll Run
          </button>
        )}
      </div>

      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
        <button onClick={() => setTab('employees')} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${tab === 'employees' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
          Employees
        </button>
        <button onClick={() => setTab('runs')} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${tab === 'runs' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
          Payroll Runs
        </button>
      </div>

      {tab === 'employees' && (
        <EmployeesTab
          employees={payrollEmployees}
          paymentDay={payrollSettings?.internal_payment_day ?? 28}
          canEdit={canEdit}
          reload={reload}
          onOpen={(e) => setEmployeeDrawer({ employee: e, startEditing: false })}
        />
      )}

      {tab === 'runs' && (
        <RunsTab
          payrollRuns={payrollRuns}
          onOpen={setRunDrawer}
        />
      )}

      {employeeDrawer && (
        <PayrollEmployeeDrawer
          employee={employeeDrawer.employee}
          startEditing={employeeDrawer.startEditing}
          canEdit={canEdit}
          onClose={() => setEmployeeDrawer(null)}
          onSaved={reload}
        />
      )}

      {runDrawer && (
        <PayrollDrawer
          run={runDrawer === 'new' ? null : runDrawer}
          employees={payrollEmployees}
          accounts={accounts}
          canEdit={canEdit}
          onClose={() => setRunDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function EmployeesTab({
  employees, paymentDay, canEdit, reload, onOpen,
}: {
  employees: PayrollEmployee[];
  paymentDay: number;
  canEdit: boolean;
  reload: () => void;
  onOpen: (e: PayrollEmployee) => void;
}) {
  const [editingDay, setEditingDay] = useState(false);
  const [dayInput, setDayInput] = useState(String(paymentDay));
  const [savingDay, setSavingDay] = useState(false);

  const activeEmployees = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);
  const totalMonthlySalary = activeEmployees.reduce((s, e) => s + e.monthly_salary, 0);
  const nextPayment = nextInternalPaymentDate(paymentDay);
  const daysLeft = daysUntil(nextPayment);

  const savePaymentDay = async () => {
    const day = Number(dayInput);
    if (!day || day < 1 || day > 28) return;
    setSavingDay(true);
    await supabase.from('payroll_settings').update({ internal_payment_day: day, updated_at: new Date().toISOString() }).eq('id', true);
    setSavingDay(false);
    setEditingDay(false);
    reload();
  };

  const viewId = async (e: PayrollEmployee) => {
    if (!e.id_document_url) return;
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(e.id_document_url, 3600);
    if (!error && data) window.open(data.signedUrl, '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiTile icon={CalendarClock} label="Next Payment" value={`${daysLeft}d`} tone={daysLeft <= 3 ? 'negative' : undefined} color="amber" />
        <KpiTile icon={Users2} label="Active Employees" value={String(activeEmployees.length)} color="amber" />
        <KpiTile icon={Wallet} label="Total Monthly Salary" value={fmt(totalMonthlySalary)} color="amber" />
      </div>

      <div className="card p-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[12px] font-medium">Shared Payment Date: day {paymentDay} of every month</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Next payment {formatDateLabelSafe(dateStr(nextPayment))} — {daysLeft} day{daysLeft === 1 ? '' : 's'} away.</p>
        </div>
        {canEdit && (
          editingDay ? (
            <div className="flex items-center gap-1.5">
              <input type="number" min={1} max={28} value={dayInput} onChange={(e) => setDayInput(e.target.value)} className="input w-20" />
              <button onClick={savePaymentDay} disabled={savingDay} className="btn-primary text-[11px] px-2.5 py-1.5 disabled:opacity-50">{savingDay ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditingDay(false); setDayInput(String(paymentDay)); }} className="btn-ghost text-[11px] px-2.5 py-1.5">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setEditingDay(true)} className="btn-ghost flex items-center gap-1.5 text-[11px]"><Pencil size={12} /> Change Date</button>
          )
        )}
      </div>

      <DataTable
        rows={employees}
        keyFn={(e) => e.id}
        emptyLabel="No employees on file yet."
        onRowClick={onOpen}
        columns={[
          { header: 'Name', render: (e) => e.full_name },
          { header: 'Position', render: (e) => e.position ?? '—' },
          { header: 'Start Date', render: (e) => (e.start_date ? formatDateLabelSafe(e.start_date) : '—') },
          { header: 'Monthly Salary', render: (e) => fmt(e.monthly_salary) },
          {
            header: 'ID',
            render: (e) => e.id_document_url ? (
              <button onClick={(ev) => { ev.stopPropagation(); viewId(e); }} className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-300 hover:underline">
                <CheckCircle2 size={11} /> <ExternalLink size={10} />
              </button>
            ) : <span className="text-gray-400">Not uploaded</span>,
          },
          {
            header: 'Status',
            render: (e) => (
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${e.status === 'active' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-white/5'}`}>
                {e.status === 'active' ? 'Active' : 'Inactive'}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

function RunsTab({
  payrollRuns, onOpen,
}: {
  payrollRuns: PayrollRun[];
  onOpen: (r: PayrollRun) => void;
}) {
  return (
    <div className="space-y-2">
      {payrollRuns.length === 0 ? (
        <div className="card p-12 text-center">
          <Users2 size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No payroll runs yet.</p>
        </div>
      ) : (
        payrollRuns.map((r) => (
          <div key={r.id} onClick={() => onOpen(r)} className="card p-3.5 flex items-center gap-3 cursor-pointer hover:shadow-md hover:border-brand/30 transition-all">
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium">{r.period}</p>
              <p className="text-[10px] text-gray-400">{r.lines?.length ?? 0} employee{(r.lines?.length ?? 0) === 1 ? '' : 's'}</p>
            </div>
            <p className="text-[12px] font-semibold">{fmt(r.total_amount)}</p>
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-gray-500 capitalize">{r.status}</span>
            <EntryActions onView={() => onOpen(r)} onEdit={() => onOpen(r)} canEdit />
          </div>
        ))
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
  employees: PayrollEmployee[];
  accounts: ReturnType<typeof useFinanceData>['accounts'];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(!run);
  const [period, setPeriod] = useState(run?.period ?? todayStr().slice(0, 7));
  const activeEmployees = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);
  // A brand new run pre-fills one line per active employee at their
  // current salary - a smart default, not a hard rule, so Finance can
  // still edit or remove any line before saving.
  const [lines, setLines] = useState<{ employee_id: string; gross_amount: string; deductions: string }[]>(
    run?.lines?.map((l) => ({ employee_id: l.employee_id, gross_amount: String(l.gross_amount), deductions: String(l.deductions) }))
      ?? activeEmployees.map((e) => ({ employee_id: e.id, gross_amount: String(e.monthly_salary), deductions: '0' }))
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
