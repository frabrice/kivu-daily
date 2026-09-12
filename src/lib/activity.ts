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

// Full, paginated, filterable activity log - the MD's actual audit trail
// (the dashboard's useActivityFeed above is just a 15-row preview of this
// same table). Every row already carries a real actor via a DB trigger -
// this hook adds server-side paging and an optional "only this person"
// filter so the full history stays browsable instead of an endless list.
export function useActivityLog(pageSize = 30) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [actorId, setActorId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (page: number, filterActorId: string | null) => {
      let query = supabase
        .from('activity_log')
        .select('*, actor:profiles(*)')
        .order('created_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (filterActorId) query = query.eq('actor_id', filterActorId);
      const { data } = await query;
      return (data as ActivityLogEntry[]) ?? [];
    },
    [pageSize]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await fetchPage(0, actorId);
    setEntries(rows);
    setHasMore(rows.length === pageSize);
    setLoading(false);
  }, [fetchPage, actorId, pageSize]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const nextPage = Math.floor(entries.length / pageSize);
    const rows = await fetchPage(nextPage, actorId);
    setEntries((prev) => [...prev, ...rows]);
    setHasMore(rows.length === pageSize);
    setLoadingMore(false);
  }, [fetchPage, actorId, pageSize, entries.length]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);

  useEffect(() => {
    const channel = supabase
      .channel('activity-log-full')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);

  return { entries, loading, loadingMore, hasMore, loadMore, actorId, setActorId };
}
