import { useEffect, useState, useCallback } from 'react';
import { supabase, ActivityLogEntry } from './supabase';

export function useActivityFeed(limit = 20) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('activity_log')
      .select('*, actor:profiles(*)')
      .order('created_at', { ascending: false })
      .limit(limit);
    setEntries((data as ActivityLogEntry[]) ?? []);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('activity-log-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { entries, loading, reload: load };
}
