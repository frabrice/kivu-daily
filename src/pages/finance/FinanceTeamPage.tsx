import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users2, UserPlus, Pencil, UserX, Send, Loader2, Check } from 'lucide-react';
import { supabase, Profile, Department } from '../../lib/supabase';
import { edgeFunctionError } from '../../lib/edgeFunctions';
import { formatDateLabelSafe } from '../../lib/fleet';
import Avatar from '../../components/Avatar';
import { CreateUserModal, EditUserModal } from '../../components/EmployeeAdminModals';
import TerminateEmployeeModal from '../../components/TerminateEmployeeModal';

// Finance's own employee-management page - the same add/edit/terminate
// rights the MD has from the Departments view, minus the task-
// completion stats (Finance's own RLS on tasks only ever returns their
// own rows, not the whole company's, so a stats view here would just
// silently show zeros for everyone else) and minus "Add Department",
// which stays a structural, MD-only action. Edits and terminations go
// through admin_update_employee / admin_deactivate_employee, which
// enforce server-side that Finance can manage any regular employee but
// can never touch a Managing Director's account or grant that role -
// the UI mirrors that by simply not offering Edit/Terminate on an MD
// row, but the real enforcement lives in the RPCs, not here.
export default function FinanceTeamPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [terminating, setTerminating] = useState<Profile | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{ id: string; error: string | null } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [{ data: profs }, { data: depts }] = await Promise.all([
      supabase.from('profiles').select('*, department:departments(*)').order('full_name'),
      supabase.from('departments').select('*').order('name'),
    ]);
    setProfiles((profs as Profile[]) ?? []);
    setDepartments((depts as Department[]) ?? []);
    setLoading(false);
  }, []);

  const activeProfiles = useMemo(() => profiles.filter((p) => p.is_active), [profiles]);
  const terminatedProfiles = useMemo(
    () => profiles.filter((p) => !p.is_active).sort((a, b) => (b.terminated_at ?? '').localeCompare(a.terminated_at ?? '')),
    [profiles]
  );

  useEffect(() => {
    load();
    const channel = supabase
      .channel('finance-team-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const saveEdit = async (updates: Partial<Profile>) => {
    if (!editUser) return;
    setError('');
    const { error: err } = await supabase.rpc('admin_update_employee', {
      p_user_id: editUser.id,
      p_role: updates.role,
      p_department_id: updates.department_id ?? null,
      p_responsibility_label: updates.responsibility_label ?? '',
    });
    if (err) { setError(err.message); return; }
    setEditUser(null);
    load();
  };

  const resendInvite = async (id: string) => {
    setResendingId(id);
    setResendResult(null);
    const { data, error: err } = await supabase.functions.invoke('resend-invite', { body: { user_id: id } });
    setResendingId(null);
    if (err || !data?.success) {
      setResendResult({ id, error: data?.email_error || (err ? await edgeFunctionError(err) : 'Failed to resend invite') });
    } else {
      setResendResult({ id, error: null });
    }
  };

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Users2 size={16} className="text-amber-600 dark:text-amber-300" /> Team</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Add, edit or terminate an employee in any department.</p>
      </div>

      {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="space-y-2.5">
        {departments.map((d) => {
          const deptEmployees = activeProfiles.filter((p) => p.department_id === d.id);
          return (
            <div key={d.id} className="card p-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <p className="text-[12px] font-medium">{d.name}</p>
                  <p className="text-[10px] text-gray-400">{deptEmployees.length} employee{deptEmployees.length === 1 ? '' : 's'}</p>
                </div>
                <button onClick={() => setCreatingFor(d.id)} className="btn-ghost flex items-center gap-1.5 text-[11px]">
                  <UserPlus size={13} /> Add Employee
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {deptEmployees.map((e) => (
                  <div key={e.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100 dark:border-white/5">
                    <Avatar name={e.full_name} url={e.avatar_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate">{e.full_name}</p>
                      {e.force_password_change && (
                        <p className="text-[9px] font-medium text-orange-600 dark:text-orange-400">Pending setup</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {e.force_password_change && (
                        <button
                          onClick={() => resendInvite(e.id)}
                          disabled={resendingId === e.id}
                          title="Send them an email to set their password and activate the account"
                          className="btn-ghost p-1.5 text-brand-600 dark:text-brand-300 disabled:opacity-50"
                        >
                          {resendingId === e.id ? <Loader2 size={13} className="animate-spin" /> : resendResult?.id === e.id && !resendResult.error ? <Check size={13} className="text-positive" /> : <Send size={13} />}
                        </button>
                      )}
                      <button onClick={() => setEditUser(e)} className="btn-ghost p-1.5">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setTerminating(e)} title="Terminate" className="btn-ghost p-1.5 text-red-500">
                        <UserX size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {deptEmployees.length === 0 && <p className="text-[11px] text-gray-400 col-span-full">No employees in this department.</p>}
              </div>
            </div>
          );
        })}
      </div>

      {terminatedProfiles.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Terminated</p>
          <div className="card divide-y divide-gray-50 dark:divide-white/5">
            {terminatedProfiles.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 p-2.5">
                <Avatar name={p.full_name} url={p.avatar_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">{p.full_name}</p>
                  <p className="text-[10px] text-gray-400">{p.department?.name ?? '—'}</p>
                </div>
                <p className="text-[10px] text-red-500 shrink-0">
                  Terminated {p.terminated_at ? formatDateLabelSafe(p.terminated_at) : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {creatingFor && (
        <CreateUserModal
          departments={departments}
          lockedDepartmentId={creatingFor}
          onCreated={load}
          onClose={() => setCreatingFor(null)}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          departments={departments}
          allowMDRole={false}
          onSave={saveEdit}
          onClose={() => setEditUser(null)}
        />
      )}

      {terminating && (
        <TerminateEmployeeModal
          employeeId={terminating.id}
          employeeName={terminating.full_name}
          onClose={() => setTerminating(null)}
          onTerminated={() => { setTerminating(null); load(); }}
        />
      )}
    </div>
  );
}
