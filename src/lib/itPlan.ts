import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { ItIssue, ItMilestone, kigaliToday, pointsOf } from './it';
import type { Tone } from '../ui/kit';

// IT & Product phase 2 (migration 20261018100000): objectives with key
// results, initiatives (big projects) with budgets, and the roadmap.

export interface ItObjective { id: string; title: string; why: string | null; period: string; owner_id: string | null; status: 'draft' | 'active' | 'achieved' | 'missed' | 'dropped'; sort: number; created_at: string }
export interface ItKeyResult { id: string; objective_id: string; title: string; unit: string | null; start_value: number; target_value: number; current_value: number; lower_is_better: boolean; sort: number; updated_at: string; updated_by: string | null }
export type InitiativeStatus = 'idea' | 'proposed' | 'approved' | 'in_progress' | 'on_hold' | 'done' | 'declined' | 'cancelled';
export interface ItInitiative {
  id: string; number: number; name: string; problem: string | null; outcome: string | null; objective_id: string | null; owner_id: string | null; areas: string[];
  priority: 'p0' | 'p1' | 'p2' | 'p3'; start_date: string | null; target_date: string | null; status: InitiativeStatus; horizon: 'now' | 'next' | 'later';
  approved_budget: number | null; approved_by: string | null; approved_at: string | null; decision_note: string | null; proposed_at: string | null; created_at: string;
}
export type BudgetCategory = 'people' | 'tools' | 'cloud' | 'ai' | 'devices' | 'contractors' | 'other';
export interface ItBudgetLine { id: string; initiative_id: string; category: BudgetCategory; description: string; amount: number; recurrence: 'one_off' | 'monthly'; months: number; committed: boolean; notes: string | null }
export interface ItSpend { id: string; it_initiative_id: string; amount: number; transaction_date: string; status: string; type: string; description: string | null; counterparty: string | null; reference: string | null }

export const INITIATIVE_STATUS: Record<InitiativeStatus, { label: string; tone: Tone }> = {
  idea: { label: 'Idea', tone: 'neutral' }, proposed: { label: 'Waiting for MD approval', tone: 'attention' }, approved: { label: 'Approved', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'accent' }, on_hold: { label: 'On hold', tone: 'neutral' }, done: { label: 'Done', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const HORIZONS = [
  { key: 'now', label: 'Now', help: 'Being built this quarter' },
  { key: 'next', label: 'Next', help: 'Starts when capacity frees up' },
  { key: 'later', label: 'Later', help: 'Ideas and bets for later' },
] as const;
export const BUDGET_CATEGORIES: { key: BudgetCategory; label: string }[] = [
  { key: 'people', label: 'People & time' }, { key: 'tools', label: 'Tools & subscriptions' }, { key: 'cloud', label: 'Cloud & hosting' },
  { key: 'ai', label: 'AI services' }, { key: 'devices', label: 'Devices & hardware' }, { key: 'contractors', label: 'Contractors' }, { key: 'other', label: 'Other' },
];
export const CATEGORY_LABEL = Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c.key, c.label])) as Record<BudgetCategory, string>;
export const OBJECTIVE_STATUS: Record<ItObjective['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, active: { label: 'Active', tone: 'accent' }, achieved: { label: 'Achieved', tone: 'success' }, missed: { label: 'Missed', tone: 'danger' }, dropped: { label: 'Dropped', tone: 'neutral' },
};

export const lineTotal = (l: ItBudgetLine) => Number(l.amount) * (l.recurrence === 'monthly' ? l.months : 1);
export const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
export const rwfShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

// Quarters: "2026-Q4"
export const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
export const quarterRange = (q: string) => { const y = Number(q.slice(0, 4)), n = Number(q.slice(-1)); const m = (n - 1) * 3 + 1; const end = new Date(Date.UTC(y, m + 2, 0)).toISOString().slice(0, 10); return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: end }; };
export const nextQuarters = (count = 4) => { const out: string[] = []; let q = quarterOf(kigaliToday()); for (let i = 0; i < count; i++) { out.push(q); const y = Number(q.slice(0, 4)), n = Number(q.slice(-1)); q = n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}`; } return out; };
export const quarterLabel = (q: string) => `Q${q.slice(-1)} ${q.slice(0, 4)}`;

export function krProgress(k: ItKeyResult) {
  const span = Number(k.target_value) - Number(k.start_value);
  if (!span) return Number(k.current_value) === Number(k.target_value) ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((Number(k.current_value) - Number(k.start_value)) / span) * 100)));
}
export const objectiveProgress = (krs: ItKeyResult[]) => (krs.length ? Math.round(krs.reduce((s, k) => s + krProgress(k), 0) / krs.length) : 0);

// Delivery progress of an initiative: points done across its milestones.
export function initiativeDelivery(i: ItInitiative, milestones: ItMilestone[], issues: ItIssue[]) {
  const ms = milestones.filter((m) => m.initiative_id === i.id && m.status !== 'cancelled');
  const list = issues.filter((x) => ms.some((m) => m.id === x.milestone_id) && x.status !== 'wont_do');
  const points = list.reduce((s, x) => s + pointsOf(x), 0);
  const done = list.filter((x) => x.status === 'done');
  return { milestones: ms, issues: list.length, done: done.length, pct: points ? Math.round((done.reduce((s, x) => s + pointsOf(x), 0) / points) * 100) : 0 };
}

export interface Money { planned: number; committed: number; spent: number; approved: number | null; over: boolean }
export function moneyOf(i: ItInitiative, lines: ItBudgetLine[], spend: ItSpend[]): Money {
  const mine = lines.filter((l) => l.initiative_id === i.id);
  const planned = mine.reduce((s, l) => s + lineTotal(l), 0);
  return {
    planned, committed: mine.filter((l) => l.committed).reduce((s, l) => s + lineTotal(l), 0),
    spent: spend.filter((x) => x.it_initiative_id === i.id).reduce((s, x) => s + Number(x.amount), 0),
    approved: i.approved_budget === null ? null : Number(i.approved_budget),
    over: i.approved_budget !== null && planned > Number(i.approved_budget),
  };
}

// Waiting for the MD: a new project proposed, or a bigger budget asked for
// on a project that was already approved (proposed again after approval).
export const askedBiggerBudget = (i: ItInitiative, m: Money) => m.over && !!i.proposed_at && (!i.approved_at || i.proposed_at > i.approved_at);
export const waitingForMd = (i: ItInitiative, m: Money) => i.status === 'proposed' || askedBiggerBudget(i, m);

let seq = 0;
export function usePlanData() {
  const [objectives, setObjectives] = useState<ItObjective[]>([]);
  const [keyResults, setKeyResults] = useState<ItKeyResult[]>([]);
  const [initiatives, setInitiatives] = useState<ItInitiative[]>([]);
  const [lines, setLines] = useState<ItBudgetLine[]>([]);
  const [spend, setSpend] = useState<ItSpend[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const [o, k, i, l, s] = await Promise.all([
      supabase.from('it_objectives').select('*').order('period').order('sort'),
      supabase.from('it_key_results').select('*').order('sort'),
      supabase.from('it_initiatives').select('*').order('number'),
      supabase.from('it_budget_lines').select('*').order('created_at'),
      supabase.rpc('it_initiative_spending'),
    ]);
    setObjectives((o.data as ItObjective[]) ?? []);
    setKeyResults((k.data as ItKeyResult[]) ?? []);
    setInitiatives((i.data as ItInitiative[]) ?? []);
    setLines((l.data as ItBudgetLine[]) ?? []);
    setSpend((s.data as ItSpend[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`it-plan-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'it_initiatives' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { objectives, keyResults, initiatives, lines, spend, loading, reload: load };
}
export type PlanData = ReturnType<typeof usePlanData>;
