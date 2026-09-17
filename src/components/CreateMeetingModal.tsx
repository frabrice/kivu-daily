import { useEffect, useState } from 'react';
import Modal from './Modal';
import DateInput from './DateInput';
import { supabase, Meeting, MeetingVisibility } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { todayStr } from '../lib/utils';

interface CreateMeetingModalProps {
  open: boolean;
  meeting?: Meeting | null;
  onClose: () => void;
  onCreated?: () => void;
}

export default function CreateMeetingModal({ open, meeting, onClose, onCreated }: CreateMeetingModalProps) {
  const { profile } = useAuth();

  const VISIBILITY_OPTIONS: { value: MeetingVisibility; label: string; hint: string }[] = [
    { value: 'private', label: 'Only me', hint: 'Just your own notes' },
    { value: 'md', label: 'Share with MD', hint: 'You and the Managing Director' },
    { value: 'department', label: 'Share with my department', hint: profile?.department?.name ?? 'Everyone in your department' },
    { value: 'company', label: 'Share with everyone', hint: 'The whole company' },
  ];
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [date, setDate] = useState(meeting?.date ?? todayStr());
  const [notes, setNotes] = useState(meeting?.notes ?? '');
  const [visibility, setVisibility] = useState<MeetingVisibility>(meeting?.visibility ?? 'private');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTitle(meeting?.title ?? '');
      setDate(meeting?.date ?? todayStr());
      setNotes(meeting?.notes ?? '');
      setVisibility(meeting?.visibility ?? 'private');
      setError('');
    }
  }, [open, meeting]);

  const reset = () => {
    setTitle('');
    setDate(todayStr());
    setNotes('');
    setVisibility('private');
    setError('');
  };

  const save = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError('');
    const payload = {
      title: title.trim(),
      date,
      notes: notes.trim(),
      visibility,
      department_id: visibility === 'department' ? profile?.department_id ?? null : null,
    };
    const { error: err } = meeting
      ? await supabase.from('meetings').update(payload).eq('id', meeting.id)
      : await supabase.from('meetings').insert({ ...payload, author_id: profile!.id });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    reset();
    onCreated?.();
    onClose();
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={meeting ? 'Edit Meeting Note' : 'New Meeting Note'} maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="block text-sm font-medium mb-1.5">Title</label>
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Call with Kigali Serena Hotel"
          className="input mb-3"
          required
        />

        <label className="block text-sm font-medium mb-1.5">Date</label>
        <DateInput value={date} onChange={setDate} wrapperClassName="mb-3" />

        <label className="block text-sm font-medium mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="What was discussed, decisions made…"
          className="input resize-none mb-3"
        />

        <label className="block text-sm font-medium mb-1.5">Who can see this</label>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {VISIBILITY_OPTIONS.filter((o) => o.value !== 'department' || profile?.department_id).map((o) => (
            <button
              type="button"
              key={o.value}
              onClick={() => setVisibility(o.value)}
              className={`text-left p-3 rounded-xl border transition-colors ${
                visibility === o.value
                  ? 'border-brand bg-brand/10'
                  : 'border-gray-200 dark:border-white/10 hover:border-brand/40'
              }`}
            >
              <p className="text-sm font-medium">{o.label}</p>
              <p className="text-xs text-gray-400">{o.hint}</p>
            </button>
          ))}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 mb-3">{error}</div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => { reset(); onClose(); }} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={loading || !title.trim()} className="btn-primary disabled:opacity-50">
            {loading ? 'Saving…' : 'Save Meeting Note'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
