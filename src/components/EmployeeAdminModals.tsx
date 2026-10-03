import { useState, ReactNode } from 'react';
import { Loader2, Mail, Shield, UserCog } from 'lucide-react';
import { supabase, Profile, Department } from '../lib/supabase';
import { edgeFunctionError } from '../lib/edgeFunctions';
import Modal from './Modal';

function FormSection({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5 mb-3">
        <Icon size={13} className="text-gray-400" />
        <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// Creating an employee now always happens from inside a specific
// department (Departments page) - lockedDepartmentId fixes both the
// department and the role to 'employee', since a Managing Director
// account has no department to be "under" in the first place. Kept as
// a general modal (not baked into DepartmentsView) so it stays reusable
// if MD-level account creation gets its own place later.
export function CreateUserModal({
  departments,
  lockedDepartmentId,
  onCreated,
  onClose,
}: {
  departments: Department[];
  lockedDepartmentId?: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Profile['role']>('employee');
  const [deptId, setDeptId] = useState(lockedDepartmentId ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [replaced, setReplaced] = useState<string | null>(null);
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
      if (fnError) throw new Error(await edgeFunctionError(fnError));
      if (data?.error) throw new Error(data.error);
      onCreated();
      setReplaced(data?.replaced_account ?? null);
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
              <p className="text-[12px] font-medium text-orange-600 dark:text-orange-400">Created, but the invite didn't send</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">{warning}</p>
            </>
          ) : (
            <>
              <p className="text-[12px] font-medium">Invite sent to {email}</p>
              <p className="text-[11px] text-gray-400 mt-1">They'll get an email with a link to sign in and set their own password.</p>
            </>
          )}
          {replaced && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 max-w-sm mx-auto">
              This email belonged to {replaced}'s former account. That account stays deactivated with its history kept, and this is a brand-new account.
            </p>
          )}
          <button onClick={onClose} className="btn-primary mt-4">Done</button>
        </div>
      </Modal>
    );
  }

  const deptName = lockedDepartmentId ? departments.find((d) => d.id === lockedDepartmentId)?.name : undefined;

  return (
    <Modal open onClose={onClose} title="Create New Employee" subtitle={deptName ? `Under ${deptName}` : "They'll get an email to sign in and set their own password"} maxWidth="max-w-lg">
      <form onSubmit={submit}>
        <FormSection icon={UserCog} title="Identity">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Full Name</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" className="input" autoFocus />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@kivuride.com" className="input" />
            <p className="text-[10px] text-gray-400 mt-1">They'll receive an invite email here to set their own password.</p>
          </div>
        </FormSection>

        {!lockedDepartmentId && (
          <FormSection icon={Shield} title="Access">
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Profile['role'])} className="input">
                <option value="employee">Employee</option>
                <option value="managing_director">Managing Director</option>
              </select>
            </div>
            {role === 'employee' && (
              <div>
                <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Department</label>
                <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="input">
                  <option value="">Select a department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">Determines which workspace pages this employee sees.</p>
              </div>
            )}
          </FormSection>
        )}

        {error && (
          <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 mb-4">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-white/5">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50 flex items-center gap-1.5">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Creating…' : 'Create Employee'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EditUserModal({
  user,
  departments,
  onSave,
  onClose,
  allowMDRole = true,
}: {
  user: Profile;
  departments: Department[];
  onSave: (u: Partial<Profile>) => void;
  onClose: () => void;
  // Finance can edit regular employees but must never be offered a path
  // to grant the Managing Director role - the server-side RPC already
  // rejects it regardless, this just keeps the option from ever showing.
  allowMDRole?: boolean;
}) {
  const [role, setRole] = useState(user.role);
  const [deptId, setDeptId] = useState(user.department_id ?? '');
  const [inChargeOf, setInChargeOf] = useState(user.responsibility_label ?? '');
  const [error, setError] = useState('');

  const save = () => {
    if (role === 'employee' && !deptId) {
      setError('A department is required for employees');
      return;
    }
    onSave({ role, department_id: role === 'employee' ? deptId : null, responsibility_label: inChargeOf.trim() || null });
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${user.full_name}`} maxWidth="max-w-lg">
      <FormSection icon={Shield} title="Access">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Profile['role'])} className="input" disabled={!allowMDRole}>
            <option value="employee">Employee</option>
            {allowMDRole && <option value="managing_director">Managing Director</option>}
          </select>
        </div>
        {role === 'employee' && (
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Department</label>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="input">
              <option value="">Select a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500" htmlFor="in-charge-of">In charge of</label>
          <input id="in-charge-of" value={inChargeOf} onChange={(e) => setInChargeOf(e.target.value)} className="input" placeholder="e.g. Head of IT, Finance, Operations Manager" />
          <p className="text-[10px] text-gray-400 mt-1">Shown to the Call Center when they assign a caller's issue: "{user.full_name.trim()} ({inChargeOf.trim() || 'In charge of…'})".</p>
        </div>
      </FormSection>
      {error && (
        <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 mb-4">{error}</div>
      )}
      <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-white/5">
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={save} className="btn-primary">Save</button>
      </div>
    </Modal>
  );
}
