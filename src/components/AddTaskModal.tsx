import { useState } from 'react';
import Modal from './Modal';
import { supabase } from '../lib/supabase';
import { todayStr } from '../lib/utils';

interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  date?: string;
  onAdded?: () => void;
}

export default function AddTaskModal({ open, onClose, userId, date, onAdded }: AddTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('tasks').insert({
      user_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      date: date ?? todayStr(),
    });
    setLoading(false);
    if (error) return;
    setTitle('');
    setDescription('');
    onAdded?.();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Task">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="input mb-3"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a short description (optional)"
          rows={3}
          className="input resize-none mb-4"
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={loading || !title.trim()} className="btn-primary disabled:opacity-50">
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
