import { useMemo } from 'react';
import { Radio, Loader2 } from 'lucide-react';
import { Profile } from '../lib/supabase';
import { useActivityLog } from '../lib/activity';
import { dateStr, todayStr, addDays, timeAgo } from '../lib/utils';
import Avatar from '../components/Avatar';

function dayLabel(iso: string): string {
  const ds = dateStr(new Date(iso));
  if (ds === todayStr()) return 'Today';
  if (ds === dateStr(addDays(new Date(), -1))) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function ActivityLogPage({ profiles }: { profiles: Profile[] }) {
  const { entries, loading, loadingMore, hasMore, loadMore, actorId, setActorId } = useActivityLog(30);

  const groups = useMemo(() => {
    const map = new Map<string, typeof entries>();
    for (const entry of entries) {
      const label = dayLabel(entry.created_at);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(entry);
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h3 className="section-title">Activity Log</h3>
          <p className="text-micro text-fg-subtle mt-0.5">Every tracked action, always attributed by name.</p>
        </div>
        <select
          value={actorId ?? ''}
          onChange={(e) => setActorId(e.target.value || null)}
          className="input w-52"
        >
          <option value="">Everyone</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 skeleton rounded-xl" />)}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div className="card p-12 text-center">
          <Radio size={26} className="text-fg-subtle mx-auto mb-2" />
          <p className="text-small text-fg-subtle">
            {actorId ? 'No activity from this person yet.' : 'No activity yet.'}
          </p>
        </div>
      )}

      {!loading && groups.map(([label, dayEntries]) => (
        <div key={label} className="card p-4">
          <p className="text-micro font-semibold text-fg-subtle uppercase tracking-wide mb-2">{label}</p>
          <div className="space-y-1">
            {dayEntries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 py-2 px-1">
                <Avatar name={entry.actor?.full_name ?? '?'} url={entry.actor?.avatar_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{entry.actor?.full_name ?? 'Someone'}</span>{' '}
                    <span className="text-fg-muted ">{entry.action}</span>{' '}
                    {entry.entity_label && (
                      <span className="text-fg-muted ">"{entry.entity_label}"</span>
                    )}
                  </p>
                  <p className="text-xs text-fg-subtle mt-0.5">{timeAgo(entry.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {!loading && hasMore && (
        <div className="flex justify-center pt-1">
          <button onClick={loadMore} disabled={loadingMore} className="btn-ghost flex items-center gap-1.5 disabled:opacity-50">
            {loadingMore && <Loader2 size={13} className="animate-spin" />}
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
