import { useEffect, useState } from 'react';
import { supabase, Profile, Department } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import Avatar from '../components/Avatar';
import Modal from '../components/Modal';
import { UserCog, Building2, Trash2, UserPlus, Loader2, Mail, Shield, Send, Check } from 'lucide-react';

export default function AdminPanel() {
  const { profile } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'employees' | 'departments'>('employees');
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newDept, setNewDept] = useState('');
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{ id: string; error: string | null } | null>(null);

  const load = async () => {
    const [p, d] = await Promise.all([
      supabase.from('profiles').select('*, department:departments(*)').order('created_at', { ascending: false }),
      supabase.from('departments').select('*').order('name'),
    ]);
    setProfiles((p.data as Profile[]) ?? []);
    setDepartments((d.data as Department[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const addDepartment = async () => {
    if (!newDept.trim()) return;
    await supabase.from('departments').insert({ name: newDept.trim() });
    setNewDept('');
    load();
  };

  const updateProfile = async (id: string, updates: Partial<Profile>) => {
    await supabase.from('profiles').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
    load();
    setEditUser(null);
  };

  const deactivate = async (id: string) => {
    await supabase.from('profiles').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
    load();
  };

  const resendInvite = async (id: string) => {
    setResendingId(id);
    setResendResult(null);
    const { data, error } = await supabase.functions.invoke('resend-invite', { body: { user_id: id } });
    setResendingId(null);
    if (error || !data?.success) {
      setResendResult({ id, error: data?.email_error || error?.message || 'Failed to resend invite' });
    } else {
      setResendResult({ id, error: null });
    }
  };

  if (profile?.role !== 'managing_director') {
    return <div className="text-center text-gray-400 py-12 text-[13px]">Access denied. Managing Director only.</div>;
  }

  if (loading) return <div className="text-gray-400 text-[13px]">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
          <button onClick={() => setTab('employees')} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${tab === 'employees' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
            <UserCog size={14} /> Employees
          </button>
          <button onClick={() => setTab('departments')} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${tab === 'departments' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
            <Building2 size={14} /> Departments
          </button>
        </div>
        {tab === 'employees' && (
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5">
            <UserPlus size={14} /> Create User
          </button>
        )}
      </div>

      {tab === 'employees' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {profiles.map((p) => (
            <div key={p.id} className="card p-3.5">
              <div className="flex items-center gap-3">
                <Avatar name={p.full_name} url={p.avatar_url} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{p.full_name}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {p.role === 'managing_director' ? 'Managing Director' : p.department?.name ?? 'No department'}
                  </p>
                  {p.force_password_change && (
                    <p className="text-[10px] font-medium text-orange-600 dark:text-orange-400 mt-0.5">Pending setup</p>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {p.force_password_change && (
                    <button
                      onClick={() => resendInvite(p.id)}
                      disabled={resendingId === p.id}
                      title="Send them an email to set their password and activate the account"
                      className="btn-ghost flex items-center gap-1.5 text-brand-600 dark:text-brand-300 disabled:opacity-50"
                    >
                      {resendingId === p.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : resendResult?.id === p.id && !resendResult.error ? (
                        <Check size={14} className="text-positive" />
                      ) : (
                        <Send size={14} />
                      )}
                      Activate
                    </button>
                  )}
                  <button onClick={() => setEditUser(p)} className="btn-ghost">Edit</button>
                  {p.role !== 'managing_director' && (
                    <button onClick={() => deactivate(p.id)} className="btn-ghost text-red-500 p-1.5">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              {resendResult?.id === p.id && resendResult.error && (
                <p className="text-[11px] text-red-500 mt-2">{resendResult.error}</p>
              )}
              {resendResult?.id === p.id && !resendResult.error && (
                <p className="text-[11px] text-positive mt-2">Activation email sent to {p.email}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'departments' && (
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="section-title mb-3">Add Department</h3>
            <div className="flex gap-2">
              <input value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="Department name" className="input" />
              <button onClick={addDepartment} className="btn-primary whitespace-nowrap">Add</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {departments.map((d) => {
              const count = profiles.filter((p) => p.department_id === d.id).length;
              return (
                <div key={d.id} className="card p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium">{d.name}</p>
                    <p className="text-[11px] text-gray-400">{count} employee{count === 1 ? '' : 's'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          departments={departments}
          onSave={(updates) => updateProfile(editUser.id, updates)}
          onClose={() => setEditUser(null)}
        />
      )}

      {showCreate && (
        <CreateUserModal
          departments={departments}
          onCreated={() => { load(); setShowCreate(false); }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function FormSection({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5 mb-3">
        <Icon size={13} className="text-gray-400" />
        <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function CreateUserModal({
  departments,
  onCreated,
  onClose,
}: {
  departments: Department[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Profile['role']>('employee');
  const [deptId, setDeptId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (role === 'employee' && !deptId) {
      setError('A department is required for employees');
      return;
    }
    setLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-user', {
        body: {
          email,
          full_name: fullName,
          role,
          department_id: role === 'employee' ? deptId : null,
        },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      onCreated();
      if (!data?.email_sent) {
        setWarning(
          data?.email_error
            ? `The account was created, but the invite email failed to send: ${data.email_error}`
            : 'The account was created, but the invite email failed to send.'
        );
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Modal open onClose={onClose} title="User Created" maxWidth="max-w-lg">
        <div className="text-center py-6">
          {warning ? (
            <>
              <p className="text-[13px] font-medium text-orange-600 dark:text-orange-400">Created, but the invite didn't send</p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-2">{warning}</p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium">Invite sent to {email}</p>
              <p className="text-[12px] text-gray-400 mt-1">They'll get an email with a link to sign in and set their own password.</p>
            </>
          )}
          <button onClick={onClose} className="btn-primary mt-4">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Create New User" subtitle="They'll get an email to sign in and set their own password" maxWidth="max-w-lg">
      <form onSubmit={submit}>
        <FormSection icon={UserCog} title="Identity">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Full Name</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" className="input" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@kivuride.com" className="input" />
            <p className="text-[11px] text-gray-400 mt-1">They'll receive an invite email here to set their own password.</p>
          </div>
        </FormSection>

        <FormSection icon={Shield} title="Access">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Profile['role'])} className="input">
              <option value="employee">Employee</option>
              <option value="managing_director">Managing Director</option>
            </select>
          </div>
          {role === 'employee' && (
            <div>
              <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Department</label>
              <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="input">
                <option value="">Select a department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Determines which workspace pages this employee sees.</p>
            </div>
          )}
        </FormSection>

        {error && (
          <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 mb-4">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-white/5">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50 flex items-center gap-1.5">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  user,
  departments,
  onSave,
  onClose,
}: {
  user: Profile;
  departments: Department[];
  onSave: (u: Partial<Profile>) => void;
  onClose: () => void;
}) {
  const [role, setRole] = useState(user.role);
  const [deptId, setDeptId] = useState(user.department_id ?? '');
  const [error, setError] = useState('');

  const save = () => {
    if (role === 'employee' && !deptId) {
      setError('A department is required for employees');
      return;
    }
    onSave({ role, department_id: role === 'employee' ? deptId : null });
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${user.full_name}`} maxWidth="max-w-lg">
      <FormSection icon={Shield} title="Access">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Profile['role'])} className="input">
            <option value="employee">Employee</option>
            <option value="managing_director">Managing Director</option>
          </select>
        </div>
        {role === 'employee' && (
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Department</label>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="input">
              <option value="">Select a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
      </FormSection>
      {error && (
        <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 mb-4">{error}</div>
      )}
      <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-white/5">
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={save} className="btn-primary">Save</button>
      </div>
    </Modal>
  );
}
