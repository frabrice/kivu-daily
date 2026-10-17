import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { edgeFunctionError } from './edgeFunctions';
import { addDays, kigaliToday } from './it';

// IT & Product phase 4 (migration 20261020100000): product health - trips
// from the synced platform data, Sentry errors and GitHub activity read by
// the it-health function - and AI help (it-ai function).

export interface HealthSettings {
  id: number; sentry_base_url: string; sentry_org: string | null; sentry_projects: string[]; github_repos: string[];
  min_completion_pct: number; max_no_driver_pct: number; max_accept_seconds: number; max_pickup_minutes: number; min_crash_free_pct: number;
  updated_by: string | null; updated_at: string;
}
export interface TripDay { day: string; requested: number; completed: number; no_driver: number; cancelled_after_accept: number; accept_median_s: number | null; pickup_avg_min: number | null; rejections: number; fares: number }
export interface TripHour { hour: number; requested: number; completed: number; no_driver: number }
export interface TripTotals { requested: number; completed: number; no_driver: number; cancelled_after_accept: number; accept_median_s: number | null; pickup_avg_min: number | null }
export interface TripHealth { days: TripDay[]; hours: TripHour[]; totals: TripTotals }

export interface SentryIssue { id: string; shortId: string; title: string; culprit: string | null; level: string; count: number; users: number; firstSeen: string; lastSeen: string; url: string }
export interface SentryProject {
  slug: string; name?: string; platform?: string; ok: boolean; error?: string; unresolved?: number; new24h?: number; top?: SentryIssue[];
  sessions?: { days: string[]; crashFreeSessions: (number | null)[]; crashFreeUsers: (number | null)[]; sessions: number[]; totals: { crashFreeSessions: number | null; crashFreeUsers: number | null; sessions: number } } | null;
}
export interface PullRequest { number: number; title: string; author: string | null; url: string; created_at: string; updated_at: string; merged_at: string | null; draft: boolean }
export interface RepoHealth { repo: string; ok: boolean; error?: string; commits14?: number; withIssue?: number; open?: PullRequest[]; merged?: PullRequest[] }
export interface Snapshot<T> { id: number; source: 'sentry' | 'github'; taken_at: string; ok: boolean; error: string | null; data: T }
export interface ItCommit { repo: string; sha: string; author_login: string | null; author_name: string | null; profile_id: string | null; message: string | null; committed_at: string; url: string | null; issue_ids: number[] }

export const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

async function latest<T>(source: 'sentry' | 'github') {
  const { data } = await supabase.from('it_health_snapshots').select('*').eq('source', source).order('taken_at', { ascending: false }).limit(1).maybeSingle();
  return (data as Snapshot<T> | null) ?? null;
}

export function useHealth(days: number) {
  const [settings, setSettings] = useState<HealthSettings | null>(null);
  const [trips, setTrips] = useState<TripHealth | null>(null);
  const [sentry, setSentry] = useState<Snapshot<{ projects: SentryProject[] }> | null>(null);
  const [github, setGithub] = useState<Snapshot<{ repos: RepoHealth[] }> | null>(null);
  const [commits, setCommits] = useState<ItCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const to = kigaliToday(), from = addDays(to, -(days - 1));
    const [s, t, se, gh, c] = await Promise.all([
      supabase.from('it_health_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.rpc('it_trip_health', { p_from: from, p_to: to }),
      latest<{ projects: SentryProject[] }>('sentry'),
      latest<{ repos: RepoHealth[] }>('github'),
      supabase.from('it_commits').select('*').gte('committed_at', new Date(Date.now() - 14 * 86400_000).toISOString()).order('committed_at', { ascending: false }).limit(500),
    ]);
    setSettings((s.data as HealthSettings | null) ?? null);
    setTrips((t.data as TripHealth | null) ?? null);
    setSentry(se); setGithub(gh);
    setCommits((c.data as ItCommit[]) ?? []);
    setLoading(false);
  }, [days]);
  useEffect(() => { load(); }, [load]);
  return { settings, trips, sentry, github, commits, loading, reload: load };
}
export type Health = ReturnType<typeof useHealth>;

export async function refreshHealth(): Promise<string | null> {
  const { error } = await supabase.functions.invoke('it-health', { body: {} });
  return error ? edgeFunctionError(error) : null;
}

// ------------------------------------------------------------ AI help
export function useAiStatus() {
  return useQuery({
    queryKey: ['it-ai-status'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('it-ai', { body: { action: 'status' } });
      if (error) return { configured: false, providers: [] as string[] };
      return data as { configured: boolean; providers: string[] };
    },
  });
}
export interface DraftIssue { title: string; description: string; type: string; priority: string; size: string; areas: string[]; acceptance_criteria: string[] }
export interface WeekDraft { highlights: string; risks: string; next_focus: string }
export interface ErrorExplained { explanation: string; likely_area: string; suggested_title: string; first_steps: string[] }
export async function askAi<T>(action: 'draft_issue' | 'week_summary' | 'explain_error', payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('it-ai', { body: { action, ...payload } });
  if (error) throw new Error(await edgeFunctionError(error));
  return data as T;
}
