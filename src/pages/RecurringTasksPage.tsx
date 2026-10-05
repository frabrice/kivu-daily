import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Pencil, Repeat, Play, Pause, Zap } from 'lucide-react';
import { supabase, Department, Profile, RecurringFrequency, RecurringTask } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { todayStr, dateStr } from '../lib/utils';
import Modal from '../components/Modal';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function frequencyLabel(r: Pick<RecurringTask, 'frequency' | 'weekdays' | 'month_day'>): string {
  switch (r.frequency) {
    case 'daily': return 'Every day';
    case 'mon_sat': return 'Monday–Saturday';
    case 'weekdays': return 'Monday–Friday';
    case 'weekly': return r.weekdays.length ? `Every ${r.weekdays.slice().sort().map((d) => WEEKDAYS[d - 1]).join(', ')}` : 'Weekly (no day set)';
    case 'monthly': return `Monthly on the ${r.month_day}${r.month_day === 1 || r.month_day === 21 ? 'st' : r.month_day === 2 || r.month_day === 22 ? 'nd' : r.month_day === 3 || r.month_day === 23 ? 'rd' : 'th'}`;
  }
}

interface Duty { key: string; label: string; profile_id: string | null }

// MD Panel -> Recurring tasks: the standing duties that land on people's
// task lists automatically each day. Each targets a duty (follows whoever
// holds it), a whole department, or one person.
export default function RecurringTasksPage({ onBack }: { onBack: () => void }) {
  const [templates, setTemplates] = useState<RecurringTask[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [stats, setStats] = useState<Record<string, { done: number; total: number }>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RecurringTask | 'new' | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const weekAgo = dateStr(new Date(Date.now() - 7 * 86400000));
    const [t, p, d, r, done] = await Promise.all([
      supabase.from('recurring_tasks').select('*').order('sort_order'),
      supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('responsibilities').select('key, label, profile_id'),
      supabase.from('tasks').select('recurring_task_id, completed').not('recurring_task_id', 'is', null).gte('date', weekAgo).lt('date', todayStr()),
    ]);
    setTemplates((t.data as RecurringTask[]) ?? []);
    setProfiles((p.data as Profile[]) ?? []);
    setDepartments((d.data as Department[]) ?? []);
    setDuties((r.data as Duty[]) ?? []);
    const s: Record<string, { done: number; total: number }> = {};
    for (const row of (done.data as { recurring_task_id: string; completed: boolean }[]) ?? []) {
      s[row.recurring_task_id] = s[row.recurring_task_id] ?? { done: 0, total: 0 };
      s[row.recurring_task_id].total++;
      if (row.completed) s[row.recurring_task_id].done++;
    }
    setStats(s);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const personName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name.trim() ?? 'nobody';
  const targetLabel = (r: RecurringTask) => {
    if (r.target_type === 'person') return personName(r.target_profile_id);
    if (r.target_type === 'department') return `Everyone in ${departments.find((d) => d.slug === r.target_department_slug)?.name ?? r.target_department_slug}`;
    const duty = duties.find((d) => d.key === r.target_duty);
    return `${duty?.label ?? r.target_duty} (${personName(duty?.profile_id ?? null)})`;
  };

  const groups = useMemo(() => {
    const m = new Map<string, RecurringTask[]>();
    for (const r of templates) m.set(targetLabel(r), [...(m.get(targetLabel(r)) ?? []), r]);
    return [...m];
  }, [templates, profiles, departments, duties]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (r: RecurringTask) => {
    setTemplates((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)));
    await supabase.from('recurring_tasks').update({ is_active: !r.is_active, updated_at: new Date().toISOString() }).eq('id', r.id);
  };

  const generateNow = async () => {
    const { data, error } = await supabase.rpc('generate_recurring_tasks', { p_date: todayStr() });
    setMessage(error ? error.message : `${data ?? 0} task${data === 1 ? '' : 's'} added to today's lists (anything already there was skipped).`);
  };

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost flex items-center gap-1.5"><ArrowLeft size={14} /> Back to MD Panel</button>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Repeat size={16} className="text-brand-600 dark:text-brand-300" /> Recurring tasks</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Standing duties that land on each person's task list automatically every morning (05:00). They're reminded at 07:00, 13:00 if late, and 17:30 if still open.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={generateNow} className="btn-ghost flex items-center gap-1.5 text-[12px]"><Zap size={13} /> Add today's now</button>
          <button onClick={() => setEditing('new')} className="btn-primary flex items-center gap-1.5"><Plus size={14} /> Add duty</button>
        </div>
      </div>
      {message && <p className="text-[12px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg px-3 py-2">{message}</p>}

      {groups.map(([label, list]) => (
        <section key={label} className="card p-4">
          <h3 className="text-[12px] font-semibold mb-2">{label}</h3>
          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {list.map((r) => {
              const st = stats[r.id];
              const rate = st && st.total ? Math.round((st.done / st.total) * 100) : null;
              return (
                <div key={r.id} className={`py-2.5 flex items-start gap-3 ${r.is_active ? '' : 'opacity-50'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium">{r.title}</p>
                    <p className="text-[11px] text-gray-400">{frequencyLabel(r)}{r.due_time ? ` · by ${r.due_time}` : ''}{!r.is_active ? ' · paused' : ''}</p>
                  </div>
                  {rate !== null && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${rate >= 80 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : rate >= 50 ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' : 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'}`}
                      title="Done in the last 7 days">{rate}% · 7d</span>
                  )}
                  <button onClick={() => toggle(r)} className="btn-ghost p-1.5" aria-label={r.is_active ? `Pause ${r.title}` : `Resume ${r.title}`}>{r.is_active ? <Pause size={13} /> : <Play size={13} />}</button>
                  <button onClick={() => setEditing(r)} className="btn-ghost p-1.5" aria-label={`Edit ${r.title}`}><Pencil size={13} /></button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {editing && (
        <RecurringTaskEditor
          task={editing === 'new' ? null : editing}
          profiles={profiles}
          departments={departments}
          duties={duties}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function RecurringTaskEditor({ task, profiles, departments, duties, onClose, onSaved }: {
  task: RecurringTask | null; profiles: Profile[]; departments: Department[]; duties: Duty[]; onClose: () => void; onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [targetType, setTargetType] = useState<RecurringTask['target_type']>(task?.target_type ?? 'duty');
  const [targetProfile, setTargetProfile] = useState(task?.target_profile_id ?? '');
  const [targetDept, setTargetDept] = useState(task?.target_department_slug ?? '');
  const [targetDuty, setTargetDuty] = useState(task?.target_duty ?? '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(task?.frequency ?? 'mon_sat');
  const [weekdays, setWeekdays] = useState<number[]>(task?.weekdays ?? []);
  const [monthDay, setMonthDay] = useState(task?.month_day ?? 1);
  const [dueTime, setDueTime] = useState(task?.due_time ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim()) { setError('Give the duty a title.'); return; }
    if (targetType === 'person' && !targetProfile) { setError('Choose the person.'); return; }
    if (targetType === 'department' && !targetDept) { setError('Choose the department.'); return; }
    if (targetType === 'duty' && !targetDuty) { setError('Choose the duty.'); return; }
    if (frequency === 'weekly' && weekdays.length === 0) { setError('Pick at least one day.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      title: title.trim(), description: description.trim() || null, target_type: targetType,
      target_profile_id: targetType === 'person' ? targetProfile : null,
      target_department_slug: targetType === 'department' ? targetDept : null,
      target_duty: targetType === 'duty' ? targetDuty : null,
      frequency, weekdays: frequency === 'weekly' ? weekdays : [], month_day: frequency === 'monthly' ? monthDay : null,
      due_time: dueTime || null, updated_at: new Date().toISOString(),
    };
    const { error: err } = task
      ? await supabase.from('recurring_tasks').update(payload).eq('id', task.id)
      : await supabase.from('recurring_tasks').insert({ ...payload, created_by: profile?.id ?? null, sort_order: 999 });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const remove = async () => {
    if (!task) return;
    setSaving(true);
    await supabase.from('recurring_tasks').delete().eq('id', task.id);
    setSaving(false);
    onSaved();
  };

  const label = 'block text-[11px] font-medium mb-1.5 text-gray-500';
  const personOf = (id: string | null) => profiles.find((p) => p.id === id)?.full_name.trim();
  return (
    <Modal open onClose={onClose} title={task ? 'Edit standing duty' : 'New standing duty'} subtitle="It appears on their task list automatically" maxWidth="max-w-lg">
      <div className="space-y-3">
        <div><label className={label} htmlFor="rt-title">Task</label><input id="rt-title" value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="e.g. Confirm every pending driver deposit" /></div>
        <div><label className={label} htmlFor="rt-desc">How / why <span className="font-normal text-gray-400">(optional)</span></label><textarea id="rt-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input resize-none" /></div>
        <div>
          <span className={label}>Who does it</span>
          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-white/5 mb-2" role="radiogroup" aria-label="Who does it">
            {(['duty', 'department', 'person'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={targetType === t} onClick={() => setTargetType(t)}
                className={`py-1.5 rounded-md text-[11px] font-medium ${targetType === t ? 'bg-white dark:bg-navy-800 shadow-sm' : 'text-gray-500'}`}>
                {t === 'duty' ? 'Whoever holds a duty' : t === 'department' ? 'A whole department' : 'One person'}
              </button>
            ))}
          </div>
          {targetType === 'duty' && (
            <select value={targetDuty} onChange={(e) => setTargetDuty(e.target.value)} className="input" aria-label="Duty">
              <option value="">Choose a duty</option>
              {duties.map((d) => <option key={d.key} value={d.key}>{d.label} — {personOf(d.profile_id) ?? 'nobody'}</option>)}
            </select>
          )}
          {targetType === 'department' && (
            <select value={targetDept} onChange={(e) => setTargetDept(e.target.value)} className="input" aria-label="Department">
              <option value="">Choose a department</option>
              {departments.map((d) => <option key={d.id} value={d.slug ?? ''}>{d.name}</option>)}
            </select>
          )}
          {targetType === 'person' && (
            <select value={targetProfile} onChange={(e) => setTargetProfile(e.target.value)} className="input" aria-label="Person">
              <option value="">Choose a person</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name.trim()}</option>)}
            </select>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="rt-freq">How often</label>
            <select id="rt-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)} className="input">
              <option value="daily">Every day</option>
              <option value="mon_sat">Monday–Saturday</option>
              <option value="weekdays">Monday–Friday</option>
              <option value="weekly">On certain days</option>
              <option value="monthly">Once a month</option>
            </select>
          </div>
          <div><label className={label} htmlFor="rt-time">Done by <span className="font-normal text-gray-400">(optional)</span></label><input id="rt-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="input" /></div>
        </div>
        {frequency === 'weekly' && (
          <div className="flex gap-1 flex-wrap" role="group" aria-label="Days">
            {WEEKDAYS.map((d, i) => (
              <button key={d} type="button" aria-pressed={weekdays.includes(i + 1)} onClick={() => setWeekdays((w) => (w.includes(i + 1) ? w.filter((x) => x !== i + 1) : [...w, i + 1]))}
                className={`px-2.5 py-1 rounded-full text-[11px] border ${weekdays.includes(i + 1) ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>{d}</button>
            ))}
          </div>
        )}
        {frequency === 'monthly' && (
          <div><label className={label} htmlFor="rt-day">Day of the month</label><input id="rt-day" type="number" min={1} max={28} value={monthDay} onChange={(e) => setMonthDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} className="input w-24" /></div>
        )}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          {task ? <button onClick={remove} disabled={saving} className="btn-ghost text-red-500">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
