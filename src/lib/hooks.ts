import { useEffect, useState, useCallback } from 'react';
import { supabase, Task, Profile } from './supabase';
import { todayStr, dateStr, addDays } from './utils';

export function useTasks(userId: string | undefined) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: true });
    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`tasks-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  return { tasks, loading, reload: load };
}

export function useUnreadComments(profile: Profile | null) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!profile) return;

    const load = async () => {
      // Get the last time user saw comments
      const lastSeen = profile.last_comment_seen_at;

      // Count comments addressed to this user that are newer than last seen
      let query = supabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('target_user_id', profile.id);

      if (lastSeen) {
        query = query.gt('created_at', lastSeen);
      }

      const { count } = await query;
      setUnreadCount(count ?? 0);
    };

    load();

    const channel = supabase
      .channel('unread-comments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, (payload) => {
        if (payload.new && 'target_user_id' in payload.new) {
          const newComment = payload.new as { target_user_id: string; created_at: string };
          if (newComment.target_user_id === profile.id) {
            const lastSeen = profile.last_comment_seen_at;
            if (!lastSeen || newComment.created_at > lastSeen) {
              setUnreadCount((prev) => prev + 1);
            }
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  return unreadCount;
}

export function tasksForDate(tasks: Task[], date: string): Task[] {
  return tasks.filter((t) => t.date === date);
}

export function completionPct(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  return (tasks.filter((t) => t.completed).length / tasks.length) * 100;
}

export function computeStreak(tasks: Task[]): number {
  // streak: consecutive days (ending today or yesterday) with >=1 completed task
  const completedDates = new Set(
    tasks.filter((t) => t.completed).map((t) => t.date)
  );
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  // allow streak to count from today or yesterday
  if (!completedDates.has(dateStr(cursor))) {
    cursor = addDays(cursor, -1);
    if (!completedDates.has(dateStr(cursor))) return 0;
  }
  while (completedDates.has(dateStr(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function longestStreak(tasks: Task[]): number {
  const completedDates = Array.from(new Set(tasks.filter((t) => t.completed).map((t) => t.date))).sort();
  if (completedDates.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < completedDates.length; i++) {
    const prev = new Date(completedDates[i - 1] + 'T00:00:00');
    const curr = new Date(completedDates[i] + 'T00:00:00');
    const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

export function dailyCompletionMap(tasks: Task[]): Record<string, { total: number; completed: number; pct: number }> {
  const map: Record<string, { total: number; completed: number; pct: number }> = {};
  for (const t of tasks) {
    if (!map[t.date]) map[t.date] = { total: 0, completed: 0, pct: 0 };
    map[t.date].total++;
    if (t.completed) map[t.date].completed++;
  }
  for (const d of Object.keys(map)) {
    map[d].pct = map[d].total === 0 ? 0 : (map[d].completed / map[d].total) * 100;
  }
  return map;
}

export { todayStr, dateStr, addDays };
