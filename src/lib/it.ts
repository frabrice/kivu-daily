import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import type { Tone } from '../ui/kit';

// The IT workspace (migration 20261017100000): milestones, issues, the
// inbox where requests land first, and who is working on what.

export type IssueStatus = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done' | 'wont_do';
export type IssueType = 'feature' | 'bug' | 'improvement' | 'tech_debt' | 'research' | 'chore';
export type Priority = 'p0' | 'p1' | 'p2' | 'p3';
export type Size = 'xs' | 's' | 'm' | 'l' | 'xl';

export interface ItMember { profile_id: string; role: 'md' | 'head' | 'member'; title: string | null; checks_in: boolean; name: string }
export interface ItArea { key: string; label: string; hint: string | null; sort: number }
export interface ItMilestone {
  id: string; number: number; name: string; goal: string | null; start_date: string; end_date: string;
  status: 'planned' | 'active' | 'completed' | 'cancelled'; owner_id: string | null; created_at: string; completed_at: string | null;
  initiative_id: string | null;
}
export interface ItIssue {
  id: number; title: string; description: string | null; type: IssueType; areas: string[]; priority: Priority; size: Size | null; status: IssueStatus;
  assignee_id: string | null; milestone_id: string | null; milestone_added_at: string | null; parent_id: number | null; due_date: string | null;
  source: 'md' | 'head' | 'it' | 'department' | 'incident' | 'migrated'; planned: boolean; labels: string[]; acceptance_criteria: { text: string; done: boolean }[];
  blocked: boolean; blocked_reason: string | null; github_url: string | null; inbox_id: string | null; release_id?: string | null;
  created_by: string | null; created_at: string; updated_at: string; started_at: string | null; completed_at: string | null; last_activity_at: string;
}
export interface ItInboxItem {
  id: string; title: string; details: string | null; persona: string | null; entity_type: string | null; entity_label: string | null;
  submitted_by: string | null; submitted_at: string; status: 'new' | 'accepted' | 'merged' | 'parked' | 'declined';
  decision_note: string | null; decided_by: string | null; decided_at: string | null; issue_id: number | null;
}
export interface ItCheckin { id: number; profile_id: string; day: string; slot: 'morning' | 'afternoon' | 'self'; asked_at: string | null; confirmed_at: string | null; issue_id: number | null; note: string | null }
export interface ItEvent { id: number; issue_id: number; actor: string | null; kind: string; from_value: string | null; to_value: string | null; body: string | null; at: string }

export const keyOf = (id: number) => `KR-${id}`;
export const STATUSES: { key: IssueStatus; label: string; tone: Tone; open: boolean }[] = [
  { key: 'backlog', label: 'Backlog', tone: 'neutral', open: true },
  { key: 'ready', label: 'Ready', tone: 'info', open: true },
  { key: 'in_progress', label: 'In progress', tone: 'accent', open: true },
  { key: 'in_review', label: 'In review', tone: 'done', open: true },
  { key: 'testing', label: 'Testing', tone: 'attention', open: true },
  { key: 'done', label: 'Done', tone: 'success', open: false },
  { key: 'wont_do', label: "Won't do", tone: 'neutral', open: false },
];
export const STATUS_OF = Object.fromEntries(STATUSES.map((s) => [s.key, s])) as Record<IssueStatus, (typeof STATUSES)[number]>;
export const ACTIVE: IssueStatus[] = ['in_progress', 'in_review', 'testing'];
export const isOpen = (i: ItIssue) => STATUS_OF[i.status].open;

export const TYPES: { key: IssueType; label: string }[] = [
  { key: 'feature', label: 'Feature' }, { key: 'bug', label: 'Bug' }, { key: 'improvement', label: 'Improvement' },
  { key: 'tech_debt', label: 'Tech debt' }, { key: 'research', label: 'Research' }, { key: 'chore', label: 'Chore' },
];
export const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.key, t.label])) as Record<IssueType, string>;
export const PRIORITIES: { key: Priority; label: string; help: string; tone: Tone }[] = [
  { key: 'p0', label: 'P0 · Urgent', help: 'Something is broken for riders, drivers or money — drop everything', tone: 'danger' },
  { key: 'p1', label: 'P1 · High', help: 'Needed this milestone', tone: 'attention' },
  { key: 'p2', label: 'P2 · Normal', help: 'Planned work', tone: 'info' },
  { key: 'p3', label: 'P3 · Low', help: 'Nice to have', tone: 'neutral' },
];
export const PRIORITY_OF = Object.fromEntries(PRIORITIES.map((p) => [p.key, p])) as Record<Priority, (typeof PRIORITIES)[number]>;
export const SIZES: { key: Size; label: string; points: number }[] = [
  { key: 'xs', label: 'XS · hours', points: 1 }, { key: 's', label: 'S · a day', points: 2 }, { key: 'm', label: 'M · 2–3 days', points: 3 },
  { key: 'l', label: 'L · a week', points: 5 }, { key: 'xl', label: 'XL · more — split it', points: 8 },
];
export const pointsOf = (i: ItIssue) => SIZES.find((s) => s.key === i.size)?.points ?? 2;
export const SOURCE_LABEL: Record<ItIssue['source'], string> = { md: 'MD', head: 'Head of IT', it: 'Developer (own)', department: 'Request', incident: 'Incident', migrated: 'Earlier backlog' };

export const kigaliToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const dayLabel = (d: string | null, year = false) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }) : '—');
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Kigali', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
export const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : 0);

// ------------------------------------------------------------ loading
let seq = 0;
export function useItData() {
  const [members, setMembers] = useState<ItMember[]>([]);
  const [areas, setAreas] = useState<ItArea[]>([]);
  const [milestones, setMilestones] = useState<ItMilestone[]>([]);
  const [issues, setIssues] = useState<ItIssue[]>([]);
  const [inbox, setInbox] = useState<ItInboxItem[]>([]);
  const [checkins, setCheckins] = useState<ItCheckin[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    const since = addDays(kigaliToday(), -14);
    const [m, a, ms, is, inb, ch, ppl] = await Promise.all([
      supabase.from('it_members').select('*'),
      supabase.from('it_areas').select('*').order('sort'),
      supabase.from('it_milestones').select('*').order('start_date', { ascending: false }),
      fetchAll<ItIssue>(() => supabase.from('it_issues').select('*').order('id')),
      fetchAll<ItInboxItem>(() => supabase.from('it_inbox').select('*').order('submitted_at', { ascending: false }).order('id')),
      supabase.from('it_checkins').select('*').gte('day', since).order('day', { ascending: false }),
      supabase.from('profiles').select('id, full_name'),
    ]);
    const nm = Object.fromEntries(((ppl.data as { id: string; full_name: string }[]) ?? []).map((p) => [p.id, p.full_name.trim()]));
    setNames(nm);
    const order = { md: 0, head: 1, member: 2 } as const;
    setMembers((((m.data as Omit<ItMember, 'name'>[]) ?? []).map((x) => ({ ...x, name: nm[x.profile_id] ?? 'Someone' }))).sort((x, y) => order[x.role] - order[y.role] || x.name.localeCompare(y.name)));
    setAreas((a.data as ItArea[]) ?? []);
    setMilestones((ms.data as ItMilestone[]) ?? []);
    setIssues(is.data ?? []);
    setInbox(inb.data ?? []);
    setCheckins((ch.data as ItCheckin[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const soon = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(load, 500); };
    const ch = supabase.channel(`it-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'it_issues' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'it_inbox' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'it_checkins' }, soon)
      .subscribe();
    return () => { supabase.removeChannel(ch); if (timer.current) clearTimeout(timer.current); };
  }, [load]);
  const nameOf = useCallback((id: string | null | undefined) => (id ? names[id] ?? 'Someone' : 'Nobody'), [names]);
  const areaLabel = useCallback((k: string) => areas.find((a) => a.key === k)?.label ?? k, [areas]);
  return { members, areas, milestones, issues, inbox, checkins, loading, reload: load, nameOf, areaLabel };
}
export type ItData = ReturnType<typeof useItData>;

export async function loadIssueEvents(id: number): Promise<ItEvent[]> {
  const { data } = await supabase.from('it_issue_events').select('*').eq('issue_id', id).order('at').order('id');
  return (data as ItEvent[]) ?? [];
}

// ------------------------------------------------------------ milestone numbers
export interface MilestoneStats {
  total: number; done: number; open: number; points: number; pointsDone: number; pct: number;
  byStatus: Record<IssueStatus, number>; byArea: { key: string; total: number; done: number }[]; byType: Record<IssueType, number>;
  addedAfterStart: number; unplanned: number; blocked: number; unassigned: number;
  daysTotal: number; daysGone: number; timePct: number; forecast: 'on_track' | 'at_risk' | 'late' | 'done' | 'not_started';
  burn: { day: string; scope: number; done: number; ideal: number }[];
}
export function milestoneStats(m: ItMilestone, all: ItIssue[], areas: ItArea[]): MilestoneStats {
  const list = all.filter((i) => i.milestone_id === m.id && i.status !== 'wont_do');
  const done = list.filter((i) => i.status === 'done');
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s.key, list.filter((i) => i.status === s.key).length])) as Record<IssueStatus, number>;
  const byType = Object.fromEntries(TYPES.map((t) => [t.key, list.filter((i) => i.type === t.key).length])) as Record<IssueType, number>;
  const areaKeys = [...areas.map((a) => a.key), ...new Set(list.flatMap((i) => i.areas).filter((k) => !areas.some((a) => a.key === k)))];
  const byArea = areaKeys.map((k) => ({ key: k, total: list.filter((i) => i.areas.includes(k)).length, done: done.filter((i) => i.areas.includes(k)).length })).filter((x) => x.total);
  const noArea = list.filter((i) => !i.areas.length);
  if (noArea.length) byArea.push({ key: '', total: noArea.length, done: noArea.filter((i) => i.status === 'done').length });
  const points = list.reduce((s, i) => s + pointsOf(i), 0);
  const pointsDone = done.reduce((s, i) => s + pointsOf(i), 0);
  const today = kigaliToday();
  const daysTotal = Math.max(1, Math.round((Date.parse(m.end_date) - Date.parse(m.start_date)) / 86400000) + 1);
  const daysGone = today < m.start_date ? 0 : Math.min(daysTotal, Math.round((Date.parse(today) - Date.parse(m.start_date)) / 86400000) + 1);
  const pct = points ? Math.round((pointsDone / points) * 100) : 0;
  const timePct = Math.round((daysGone / daysTotal) * 100);
  const forecast = list.length && done.length === list.length ? 'done' : daysGone === 0 ? 'not_started' : today > m.end_date ? 'late' : pct + 10 >= timePct ? 'on_track' : 'at_risk';
  const burn: MilestoneStats['burn'] = [];
  for (let d = 0; d < daysTotal; d++) {
    const day = addDays(m.start_date, d);
    if (day > today) break;
    const end = new Date(`${day}T23:59:59+02:00`).toISOString();
    const scope = list.filter((i) => (i.milestone_added_at ?? i.created_at) <= end || (i.milestone_added_at ?? i.created_at).slice(0, 10) <= m.start_date).reduce((s, i) => s + pointsOf(i), 0);
    burn.push({ day, scope, done: done.filter((i) => (i.completed_at ?? '') <= end && i.completed_at).reduce((s, i) => s + pointsOf(i), 0), ideal: Math.round((points * (d + 1)) / daysTotal) });
  }
  return {
    total: list.length, done: done.length, open: list.length - done.length, points, pointsDone, pct, byStatus, byArea, byType,
    addedAfterStart: list.filter((i) => i.milestone_added_at && i.milestone_added_at.slice(0, 10) > m.start_date).length,
    unplanned: list.filter((i) => !i.planned).length, blocked: list.filter((i) => i.blocked && isOpen(i)).length,
    unassigned: list.filter((i) => !i.assignee_id && isOpen(i)).length, daysTotal, daysGone, timePct, forecast, burn,
  };
}
export const FORECAST: Record<MilestoneStats['forecast'], { label: string; tone: Tone }> = {
  on_track: { label: 'On track', tone: 'success' }, at_risk: { label: 'At risk', tone: 'attention' }, late: { label: 'Late', tone: 'danger' },
  done: { label: 'Complete', tone: 'success' }, not_started: { label: 'Not started', tone: 'neutral' },
};

// What a person is on right now.
export function workOf(profileId: string, issues: ItIssue[]) {
  const mine = issues.filter((i) => i.assignee_id === profileId);
  return {
    active: mine.filter((i) => ACTIVE.includes(i.status)).sort((a, b) => (b.last_activity_at).localeCompare(a.last_activity_at)),
    next: mine.filter((i) => i.status === 'ready' || i.status === 'backlog').sort((a, b) => a.priority.localeCompare(b.priority)),
    doneWeek: mine.filter((i) => i.status === 'done' && i.completed_at && daysSince(i.completed_at) < 7),
    unplannedOpen: mine.filter((i) => !i.planned && isOpen(i)),
  };
}
export function useMyIt(data: ItData, me: string | undefined) {
  return useMemo(() => {
    const today = kigaliToday();
    const pending = data.checkins.filter((c) => c.profile_id === me && c.day === today && c.asked_at && !c.confirmed_at);
    return { pendingCheckin: pending[0] ?? null, member: data.members.find((m) => m.profile_id === me) ?? null };
  }, [data.checkins, data.members, me]);
}
