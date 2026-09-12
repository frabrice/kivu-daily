import { Activity } from 'lucide-react';
import { ActivityLogEntry } from '../lib/supabase';
import { timeAgo } from '../lib/utils';
import Avatar from './Avatar';

interface ActivityFeedProps {
  entries: ActivityLogEntry[];
  loading?: boolean;
  emptyLabel?: string;
}

export default function ActivityFeed({ entries, loading, emptyLabel = 'No activity yet.' }: ActivityFeedProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 skeleton rounded-xl" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Activity size={24} className="text-gray-300 dark:text-white/20 mb-2" />
        <p className="text-sm text-gray-400">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 py-2.5 px-1 animate-fade-in">
          <Avatar name={entry.actor?.full_name ?? '?'} url={entry.actor?.avatar_url} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm">
              <span className="font-medium">{entry.actor?.full_name ?? 'Someone'}</span>{' '}
              <span className="text-gray-500 dark:text-gray-400">{entry.action}</span>{' '}
              {entry.entity_label && (
                <span className="text-gray-700 dark:text-gray-200">"{entry.entity_label}"</span>
              )}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{timeAgo(entry.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
