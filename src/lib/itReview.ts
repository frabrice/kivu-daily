import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { ACTIVE, ItCheckin, ItData, ItIssue, ItMilestone, MilestoneStats, addDays, daysSince, isOpen, kigaliToday, milestoneStats, pointsOf } from './it';
import { ItInitiative, ItSpend } from './itPlan';
import type { Tone } from '../ui/kit';

// IT & Product phase 3 (migration 20261019100000): releases, the decisions
// log and the weekly review (Monday-Sunday, Kigali time).

export type Platform = 'app' | 'dashboard' | 'backend' | 'admin' | 'website';
export type ReleaseStatus = 'planned' | 'testing' | 'released' | 'rolled_back' | 'cancelled';
export interface CheckItem { text: string; done: boolean }
export interface ItRelease {
  id: string; number: number; version: string; platform: Platform; name: string | null; milestone_id: string | null; status: ReleaseStatus;
  planned_date: string | null; released_at: string | null; released_by: string | null; notes: string | null; checklist: CheckItem[];
  rollback_reason: string | null; owner_id: string | null; created_by: string | null; created_at: string; updated_at: string;
}
export type DecisionStatus = 'proposed' | 'decided' | 'superseded' | 'reversed';
export interface ItDecision {
  id: string; number: number; title: string; context: string | null; decision: string | null; options: string | null; consequences: string | null;
  areas: string[]; status: DecisionStatus; decided_by: string | null; decided_at: string | null; issue_id: number | null; initiative_id: string | null;
  release_id: string | null; superseded_by: string | null; created_by: string | null; created_at: string; updated_at: string;
}
export interface ItWeeklyReview {
  week_start: string; highlights: string | null; risks: string | null; next_focus: string | null; notes: string | null; attendees: string[];
  held_at: string | null; held_by: string | null; snapshot: WeekSnapshot | null; updated_by: string | null; updated_at: string;
}

export const PLATFORMS: { key: Platform; label: string }[] = [
  { key: 'app', label: 'Mobile app (rider + driver)' }, { key: 'dashboard', label: 'Dashboard' }, { key: 'backend', label: 'Backend / API' },
  { key: 'admin', label: 'Admin panel' }, { key: 'website', label: 'Website' },
];
export const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.key, p.label])) as Record<Platform, string>;
export const RELEASE_STATUS: Record<ReleaseStatus, { label: string; tone: Tone }> = {
  planned: { label: 'Planned', tone: 'neutral' }, testing: { label: 'Testing', tone: 'attention' }, released: { label: 'Released', tone: 'success' },
  rolled_back: { label: 'Rolled back', tone: 'danger' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const DECISION_STATUS: Record<DecisionStatus, { label: string; tone: Tone }> = {
  proposed: { label: 'Proposed', tone: 'attention' }, decided: { label: 'Decided', tone: 'success' },
  superseded: { label: 'Superseded', tone: 'neutral' }, reversed: { label: 'Reversed', tone: 'danger' },
};
export const defaultChecklist = (p: Platform): CheckItem[] => (p === 'app' ? [
  'Tested on Android', 'Tested on iPhone', 'Rider side end to end: book → ride → pay', 'Driver side end to end: go online → accept → finish trip',
  'Store listing / version number updated', 'Release notes shared with Call Center', 'No new errors in Sentry 1 hour after release', 'Rollback plan known',
] : [
  'Tested on staging', 'Database changes applied and checked', 'Rider and driver apps still work against it', 'No new errors in Sentry 1 hour after release', 'Rollback plan known',
]).map((text) => ({ text, done: false }));
export const releaseLabel = (r: Pick<ItRelease, 'platform' | 'version'>) => `${PLATFORM_LABEL[r.platform].split(' (')[0]} ${r.version}`;

// Release notes from what it ships (the same grouping the database uses).
export function draftNotes(issues: ItIssue[]) {
  const pick = (t: string[], prefix: string) => issues.filter((i) => t.includes(i.type) && i.status !== 'wont_do').map((i) => `- ${prefix}${i.title}`);
  return [...pick(['feature'], 'New: '), ...pick(['improvement'], 'Better: '), ...pick(['bug'], 'Fixed: '), ...pick(['tech_debt', 'research', 'chore'], '')].join('\n');
}

// ------------------------------------------------------------ weeks
export const kigaliDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
export const mondayOf = (d: string) => { const x = new Date(`${d}T12:00:00Z`); const dow = (x.getUTCDay() + 6) % 7; return addDays(d, -dow); };
export const weekLabel = (monday: string) => {
  const end = addDays(monday, 6);
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  return monday.slice(5, 7) === end.slice(5, 7) ? `${f(monday, { day: 'numeric' })}–${f(end, { day: 'numeric', month: 'short', year: 'numeric' })}` : `${f(monday, { day: 'numeric', month: 'short' })} – ${f(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

export interface PersonWeek { id: string; name: string; done: number; points: number; bugsFixed: number; ownWork: number; activeNow: number; asked: number; answered: number }
export interface WeekSnapshot {
  week: string; done: number; points: number; bugsOpened: number; bugsClosed: number; created: number; unplannedDone: number;
  requestsIn: number; requestsTriaged: number; releases: number; decisions: number; checkinRate: number | null; spent: number;
  people: PersonWeek[];
}
export interface WeekReview extends WeekSnapshot {
  from: string; to: string; current: boolean;
  doneIssues: ItIssue[]; bugsOpenedList: ItIssue[]; releasesList: ItRelease[]; decisionsList: ItDecision[];
  milestones: { m: ItMilestone; s: MilestoneStats; doneThisWeek: number }[];
  byArea: { key: string; n: number }[];
  attention: { urgent: ItIssue[]; blocked: ItIssue[]; stale: ItIssue[] };
  nextWeek: { milestones: ItMilestone[]; ready: number; releases: ItRelease[] };
  projects: { waiting: ItInitiative[]; spentByProject: { i: ItInitiative; n: number }[] };
}

export function weekReview(week: string, data: ItData, releases: ItRelease[], decisions: ItDecision[], checkins: ItCheckin[], initiatives: ItInitiative[], spend: ItSpend[]): WeekReview {
  const from = week, to = addDays(week, 6);
  const today = kigaliToday();
  const current = today >= from && today <= to;
  const inWeek = (iso: string | null | undefined) => !!iso && (() => { const d = iso.length > 10 ? kigaliDay(iso) : iso; return d >= from && d <= to; })();
  const doneIssues = data.issues.filter((i) => i.status === 'done' && inWeek(i.completed_at)).sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? ''));
  const createdList = data.issues.filter((i) => inWeek(i.created_at));
  const bugsOpenedList = createdList.filter((i) => i.type === 'bug');
  const releasesList = releases.filter((r) => inWeek(r.released_at));
  const decisionsList = decisions.filter((d) => d.status !== 'proposed' && inWeek(d.decided_at));
  const weekCheckins = checkins.filter((c) => c.day >= from && c.day <= to && c.slot !== 'self');
  const people: PersonWeek[] = data.members.filter((m) => m.role !== 'md' || data.issues.some((i) => i.assignee_id === m.profile_id)).map((m) => {
    const mine = doneIssues.filter((i) => i.assignee_id === m.profile_id);
    const asked = weekCheckins.filter((c) => c.profile_id === m.profile_id && c.asked_at);
    return {
      id: m.profile_id, name: m.name, done: mine.length, points: mine.reduce((s, i) => s + pointsOf(i), 0), bugsFixed: mine.filter((i) => i.type === 'bug').length,
      ownWork: mine.filter((i) => i.source === 'it' && i.created_by === m.profile_id).length,
      activeNow: data.issues.filter((i) => i.assignee_id === m.profile_id && ACTIVE.includes(i.status)).length,
      asked: asked.length, answered: asked.filter((c) => c.confirmed_at).length,
    };
  });
  const asked = people.reduce((s, p) => s + p.asked, 0), answered = people.reduce((s, p) => s + p.answered, 0);
  const milestones = data.milestones.filter((m) => m.status !== 'cancelled' && m.start_date <= to && m.end_date >= from)
    .map((m) => ({ m, s: milestoneStats(m, data.issues, data.areas), doneThisWeek: doneIssues.filter((i) => i.milestone_id === m.id).length }));
  const areaKeys = [...new Set(doneIssues.flatMap((i) => (i.areas.length ? i.areas : [''])))];
  const byArea = areaKeys.map((k) => ({ key: k, n: doneIssues.filter((i) => (k ? i.areas.includes(k) : !i.areas.length)).length })).sort((a, b) => b.n - a.n);
  const open = data.issues.filter(isOpen);
  const nextFrom = addDays(to, 1), nextTo = addDays(to, 7);
  const weekSpend = spend.filter((s) => s.transaction_date >= from && s.transaction_date <= to);
  return {
    week, from, to, current,
    done: doneIssues.length, points: doneIssues.reduce((s, i) => s + pointsOf(i), 0),
    bugsOpened: bugsOpenedList.length, bugsClosed: doneIssues.filter((i) => i.type === 'bug').length, created: createdList.length,
    unplannedDone: doneIssues.filter((i) => !i.planned).length,
    requestsIn: data.inbox.filter((x) => inWeek(x.submitted_at)).length, requestsTriaged: data.inbox.filter((x) => inWeek(x.decided_at)).length,
    releases: releasesList.length, decisions: decisionsList.length, checkinRate: asked ? Math.round((answered / asked) * 100) : null,
    spent: weekSpend.reduce((s, x) => s + Number(x.amount), 0), people,
    doneIssues, bugsOpenedList, releasesList, decisionsList, milestones, byArea,
    attention: {
      urgent: open.filter((i) => i.priority === 'p0' || i.priority === 'p1').sort((a, b) => a.priority.localeCompare(b.priority)),
      blocked: open.filter((i) => i.blocked),
      stale: open.filter((i) => ACTIVE.includes(i.status) && daysSince(i.last_activity_at) >= 3),
    },
    nextWeek: {
      milestones: data.milestones.filter((m) => m.status !== 'cancelled' && m.status !== 'completed' && m.end_date >= nextFrom && m.end_date <= nextTo),
      ready: open.filter((i) => i.status === 'ready').length,
      releases: releases.filter((r) => ['planned', 'testing'].includes(r.status) && r.planned_date && r.planned_date >= nextFrom && r.planned_date <= nextTo),
    },
    projects: {
      waiting: initiatives.filter((i) => i.status === 'proposed'),
      spentByProject: initiatives.map((i) => ({ i, n: weekSpend.filter((s) => s.it_initiative_id === i.id).reduce((s, x) => s + Number(x.amount), 0) })).filter((x) => x.n),
    },
  };
}
export const snapshotOf = (r: WeekReview): WeekSnapshot => ({
  week: r.week, done: r.done, points: r.points, bugsOpened: r.bugsOpened, bugsClosed: r.bugsClosed, created: r.created, unplannedDone: r.unplannedDone,
  requestsIn: r.requestsIn, requestsTriaged: r.requestsTriaged, releases: r.releases, decisions: r.decisions, checkinRate: r.checkinRate, spent: r.spent, people: r.people,
});

// ------------------------------------------------------------ loading
let seq = 0;
export function useShipData() {
  const [releases, setReleases] = useState<ItRelease[]>([]);
  const [decisions, setDecisions] = useState<ItDecision[]>([]);
  const [reviews, setReviews] = useState<ItWeeklyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const [r, d, w] = await Promise.all([
      supabase.from('it_releases').select('*').order('number', { ascending: false }),
      supabase.from('it_decisions').select('*').order('number', { ascending: false }),
      supabase.from('it_weekly_reviews').select('*').order('week_start', { ascending: false }),
    ]);
    setReleases((r.data as ItRelease[]) ?? []);
    setDecisions((d.data as ItDecision[]) ?? []);
    setReviews((w.data as ItWeeklyReview[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`it-ship-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'it_releases' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'it_weekly_reviews' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { releases, decisions, reviews, loading, reload: load };
}
export type ShipData = ReturnType<typeof useShipData>;

export async function loadCheckins(from: string, to: string): Promise<ItCheckin[]> {
  const { data } = await supabase.from('it_checkins').select('*').gte('day', from).lte('day', to);
  return (data as ItCheckin[]) ?? [];
}
