import { useState } from 'react';
import Modal from './Modal';
import DateInput from './DateInput';
import { supabase, Profile } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { todayStr } from '../lib/utils';

interface AssignTaskModalProps {
  open: boolean;
  onClose: () => void;
  employees: Profile[];
  onAssigned?: () => void;
}

export default function AssignTaskModal({ open, onClose, employees, onAssigned }: AssignTaskModalProps) {
  const { profile } = useAuth();
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setUserId('');
    setTitle('');
    setDescription('');
    setDate(todayStr());
    setError('');
  };

  const save = async () => {
    if (!title.trim() || !userId) return;
    setLoading(true);
    setError('');
    const { error: insertError } = await supabase.from('tasks').insert({
      user_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      date,
      assigned_by: profile!.id,
    });
    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'task_assigned',
      message: `${profile?.full_name ?? 'The MD'} assigned you a task: "${title.trim()}"`,
    });
    setLoading(false);
    reset();
    onAssigned?.();
    onClose();
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Assign a Task">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="block text-sm font-medium mb-1.5">Assign to</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input mb-3" required>
          <option value="">Select an employee</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.full_name}{e.department?.name ? ` · ${e.department.name}` : ''}</option>
          ))}
        </select>

        <label className="block text-sm font-medium mb-1.5">Task title</label>
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done"
          className="input mb-3"
          required
        />

        <label className="block text-sm font-medium mb-1.5">Details (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="input resize-none mb-3"
        />

        <label className="block text-sm font-medium mb-1.5">Date</label>
        <DateInput value={date} onChange={setDate} wrapperClassName="mb-4" />

        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 mb-3">{error}</div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => { reset(); onClose(); }} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={loading || !title.trim() || !userId} className="btn-primary disabled:opacity-50">
            {loading ? 'Assigning…' : 'Assign Task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
