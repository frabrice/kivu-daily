import { useEffect, useState, useCallback } from 'react';
import { Megaphone, Trash2 } from 'lucide-react';
import { supabase, Announcement } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/utils';
import Avatar from '../components/Avatar';
import CreateAnnouncementModal from '../components/CreateAnnouncementModal';

export default function AnnouncementsPage() {
  const { profile } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*, author:profiles(*)')
      .order('created_at', { ascending: false });
    setAnnouncements((data as Announcement[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('announcements-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const remove = async (id: string) => {
    await supabase.from('announcements').delete().eq('id', id);
  };

  const isMD = profile?.role === 'managing_director';

  return (
    <div className="space-y-4">
      {isMD && (
        <button onClick={() => setCreateOpen(true)} className="btn-primary flex items-center justify-center gap-2 py-3 w-full">
          <Megaphone size={18} />
          <span>Broadcast an Announcement</span>
        </button>
      )}

      {loading && (
        <div className="space-y-3">
          {[0, 1].map((i) => <div key={i} className="h-24 skeleton rounded-2xl" />)}
        </div>
      )}

      {!loading && announcements.length === 0 && (
        <div className="card p-10 text-center">
          <Megaphone size={28} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No announcements yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {announcements.map((a) => (
          <div key={a.id} className="card p-5 animate-fade-in">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 mb-2">
                <Avatar name={a.author?.full_name ?? 'MD'} url={a.author?.avatar_url} size="sm" />
                <div>
                  <p className="text-sm font-medium">{a.author?.full_name ?? 'Managing Director'}</p>
                  <p className="text-xs text-gray-400">{timeAgo(a.created_at)}</p>
                </div>
              </div>
              {isMD && (
                <button onClick={() => remove(a.id)} className="text-gray-300 hover:text-red-500 transition-colors p-1">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <h3 className="font-semibold text-base mb-1">{a.title}</h3>
            {a.body && <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{a.body}</p>}
          </div>
        ))}
      </div>

      <CreateAnnouncementModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
    </div>
  );
}
