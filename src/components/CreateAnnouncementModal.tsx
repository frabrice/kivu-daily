import { useEffect, useState } from 'react';
import Modal from './Modal';
import { supabase, Announcement } from '../lib/supabase';

interface CreateAnnouncementModalProps {
  open: boolean;
  announcement?: Announcement | null;
  onClose: () => void;
  onCreated?: () => void;
}

export default function CreateAnnouncementModal({ open, announcement, onClose, onCreated }: CreateAnnouncementModalProps) {
  const [title, setTitle] = useState(announcement?.title ?? '');
  const [body, setBody] = useState(announcement?.body ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTitle(announcement?.title ?? '');
      setBody(announcement?.body ?? '');
      setError('');
    }
  }, [open, announcement]);

  const reset = () => {
    setTitle('');
    setBody('');
    setError('');
  };

  const save = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError('');
    if (announcement) {
      const { error: updateError } = await supabase
        .from('announcements')
        .update({ title: title.trim(), body: body.trim() })
        .eq('id', announcement.id);
      setLoading(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from('announcements').insert({
        author_id: user?.id,
        title: title.trim(),
        body: body.trim(),
      });
      setLoading(false);
      if (insertError) {
        setError(insertError.message);
        return;
      }
    }
    reset();
    onCreated?.();
    onClose();
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={announcement ? 'Edit Announcement' : 'Broadcast an Announcement'}>
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
          placeholder="What's this about"
          className="input mb-3"
          required
        />

        <label className="block text-sm font-medium mb-1.5">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Everyone in the company will see this"
          className="input resize-none mb-4"
        />

        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 mb-3">{error}</div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => { reset(); onClose(); }} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={loading || !title.trim()} className="btn-primary disabled:opacity-50">
            {loading ? 'Saving…' : announcement ? 'Save Changes' : 'Post Announcement'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
