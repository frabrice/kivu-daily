import { useEffect, useState, useCallback } from 'react';
import { Calendar, Lock, Users2, Globe2, Shield, Plus, ListPlus, Pencil } from 'lucide-react';
import { supabase, Meeting, MeetingVisibility, Profile } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatDateLabel, todayStr } from '../lib/utils';
import Avatar from '../components/Avatar';
import Modal from '../components/Modal';
import CreateMeetingModal from '../components/CreateMeetingModal';
import ViewToggle, { ViewMode } from '../components/ViewToggle';
import DataTable from '../components/DataTable';
import EntryActions from '../components/EntryActions';

const VISIBILITY_META: Record<MeetingVisibility, { label: string; icon: typeof Lock }> = {
  private: { label: 'Only me', icon: Lock },
  md: { label: 'Shared with MD', icon: Shield },
  department: { label: 'Department', icon: Users2 },
  company: { label: 'Company-wide', icon: Globe2 },
};

export default function MeetingsPage() {
  const { profile } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [view, setView] = useState<ViewMode>('cards');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('meetings')
      .select('*, author:profiles(*)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    setMeetings((data as Meeting[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('meetings-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const canEditMeeting = (m: Meeting) => profile?.id === m.author_id || profile?.role === 'managing_director';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold">Meeting Notes</h2>
          <p className="text-xs text-gray-400 mt-0.5">{meetings.length} note{meetings.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button onClick={() => setCreateOpen(true)} className="btn-primary flex items-center gap-1.5">
            <Plus size={15} />
            <span>New Note</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-[60px] skeleton rounded-xl" />)}
        </div>
      )}

      {!loading && meetings.length === 0 && (
        <div className="card p-12 text-center">
          <Calendar size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No meeting notes yet — start one after your next call.</p>
        </div>
      )}

      {!loading && meetings.length > 0 && view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {meetings.map((m) => {
            const Meta = VISIBILITY_META[m.visibility];
            return (
              <div
                key={m.id}
                onClick={() => setSelected(m)}
                className="card p-3.5 flex items-start gap-3 text-left cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all animate-fade-in"
              >
                <Avatar name={m.author?.full_name ?? 'User'} url={m.author?.avatar_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1.5">
                    <p className="text-[12px] font-medium truncate">{m.title}</p>
                    <EntryActions
                      onView={() => setSelected(m)}
                      onEdit={() => setEditMeeting(m)}
                      canEdit={canEditMeeting(m)}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{m.author?.full_name} · {formatDateLabel(m.date)}</p>
                  <span className="inline-flex items-center gap-1 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full mt-1.5">
                    <Meta.icon size={10} /> {Meta.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && meetings.length > 0 && view === 'table' && (
        <DataTable
          rows={meetings}
          keyFn={(m) => m.id}
          onRowClick={(m) => setSelected(m)}
          columns={[
            { header: 'Title', render: (m) => <span className="font-medium">{m.title}</span> },
            { header: 'Author', render: (m) => m.author?.full_name ?? 'Unknown' },
            { header: 'Date', render: (m) => formatDateLabel(m.date) },
            {
              header: 'Visibility',
              render: (m) => {
                const Meta = VISIBILITY_META[m.visibility];
                return (
                  <span className="inline-flex items-center gap-1 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                    <Meta.icon size={10} /> {Meta.label}
                  </span>
                );
              },
            },
            {
              header: '',
              className: 'text-right',
              render: (m) => (
                <EntryActions onView={() => setSelected(m)} onEdit={() => setEditMeeting(m)} canEdit={canEditMeeting(m)} />
              ),
            },
          ]}
        />
      )}

      <CreateMeetingModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
      <CreateMeetingModal open={!!editMeeting} meeting={editMeeting} onClose={() => setEditMeeting(null)} onCreated={load} />

      {selected && (
        <MeetingDetailDrawer
          meeting={selected}
          canEdit={canEditMeeting(selected)}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditMeeting(selected); setSelected(null); }}
        />
      )}
    </div>
  );
}

function MeetingDetailDrawer({ meeting, canEdit, onClose, onEdit }: { meeting: Meeting; canEdit: boolean; onClose: () => void; onEdit: () => void }) {
  const { profile } = useAuth();
  const Meta = VISIBILITY_META[meeting.visibility];
  const [addingTask, setAddingTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(profile?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [assignableEmployees, setAssignableEmployees] = useState<Profile[]>([]);

  const isMD = profile?.role === 'managing_director';

  useEffect(() => {
    if (!isMD) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('role', 'employee')
      .eq('is_active', true)
      .then(({ data }) => setAssignableEmployees((data as Profile[]) ?? []));
  }, [isMD]);

  const addTask = async () => {
    if (!taskTitle.trim() || !profile) return;
    setSaving(true);
    const targetUser = isMD ? assigneeId || profile.id : profile.id;
    await supabase.from('tasks').insert({
      user_id: targetUser,
      title: taskTitle.trim(),
      date: todayStr(),
      source_meeting_id: meeting.id,
      assigned_by: targetUser !== profile.id ? profile.id : null,
    });
    if (targetUser !== profile.id) {
      await supabase.from('notifications').insert({
        user_id: targetUser,
        type: 'task_assigned',
        message: `A task was created from the meeting "${meeting.title}": "${taskTitle.trim()}"`,
      });
    }
    setSaving(false);
    setSaved(true);
    setTaskTitle('');
    setAddingTask(false);
  };

  return (
    <Modal open onClose={onClose} title={meeting.title} subtitle={`${meeting.author?.full_name ?? ''} · ${formatDateLabel(meeting.date)}`} maxWidth="max-w-lg">
      <div className="flex items-center justify-between mb-4">
        <span className="inline-flex items-center gap-1 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-1 rounded-full">
          <Meta.icon size={11} /> {Meta.label}
        </span>
        {canEdit && (
          <button onClick={onEdit} className="btn-ghost flex items-center gap-1.5 text-brand-600 dark:text-brand-300">
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-gray-700 dark:text-gray-200 whitespace-pre-wrap mb-6">
        {meeting.notes || <span className="text-gray-400">No notes written.</span>}
      </p>

      {!addingTask && !saved && (
        <button onClick={() => setAddingTask(true)} className="btn-ghost flex items-center gap-1.5 text-brand-600 dark:text-brand-300">
          <ListPlus size={14} /> Create a task from this meeting
        </button>
      )}

      {saved && <p className="text-[12px] text-positive font-medium">Task created.</p>}

      {addingTask && (
        <div className="p-3 rounded-lg border border-gray-200 dark:border-white/10 space-y-2">
          <input
            autoFocus
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title"
            className="input"
          />
          {isMD && (
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="input">
              <option value={profile?.id}>Assign to myself</option>
              {assignableEmployees.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </select>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddingTask(false)} className="btn-ghost">Cancel</button>
            <button onClick={addTask} disabled={saving || !taskTitle.trim()} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Task'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
