import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Tone } from '../ui/kit';

// Company plan, phase 4 (migration 20261025100000): the monthly partners'
// review and the company decisions log.

export interface MonthFacts {
  own_income_by_type: Record<string, number>; spent_by_type: Record<string, number>; budget_spent: number; managed_cars: number;
  trips: { requested: number; completed: number; no_driver: number; fares: number };
  it: { issues_done: number; bugs_fixed: number; releases: { name: string; status: string }[]; milestones_completed: string[]; milestones_active: { name: string; end: string; done: number; total: number }[] };
}
export interface MonthlyReview {
  month: string; highlights: string | null; problems: string | null; next_focus: string | null; notes: string | null; attendees: string[];
  held_at: string | null; held_by: string | null; snapshot: MonthSnapshot | null; updated_by: string | null; updated_at: string;
}
export type DecisionStatus = 'proposed' | 'decided' | 'superseded' | 'reversed';
export interface CompanyDecision {
  id: string; number: number; title: string; context: string | null; decision: string | null; options: string | null; consequences: string | null; departments: string[];
  status: DecisionStatus; decided_by: string | null; decided_at: string | null; priority_id: string | null; budget_id: string | null; funding_id: string | null; stage_id: string | null;
  superseded_by: string | null; created_by: string | null; created_at: string;
}
export const DECISION_STATUS: Record<DecisionStatus, { label: string; tone: Tone }> = {
  proposed: { label: 'To decide', tone: 'attention' }, decided: { label: 'Decided', tone: 'success' }, superseded: { label: 'Replaced', tone: 'neutral' }, reversed: { label: 'Reversed', tone: 'danger' },
};
export const SPENT_LABEL: Record<string, string> = {
  vehicle_owner_payment: 'Car owners paid', driver_payroll: 'Driver payroll', payroll: 'Staff payroll', supplier_payment: 'Suppliers', expense: 'Expenses', refund: 'Refunds',
};

export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const monthEnd = (m: string) => { const d = new Date(`${m.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
export const shiftMonth = (m: string, n: number) => { const d = new Date(`${m.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return `${d.toISOString().slice(0, 7)}-01`; };
export const monthTitle = (m: string) => new Date(`${m.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// The numbers of a month, as the review shows them (and freezes them).
export interface MonthSnapshot {
  month: string; days: number; requested: number; completed: number; perDay: number; completionPct: number | null; noDriverPct: number | null;
  ownIncome: number; ownRecurring: number; commission: number; managedMargin: number; spentTotal: number; budgetSpent: number; managedCars: number;
  itDone: number; releases: number;
}
export function snapshotOf(month: string, f: MonthFacts, commissionPct: number, today: string): MonthSnapshot {
  const end = monthEnd(month);
  const days = today < month ? 0 : today >= end ? Number(end.slice(8, 10)) : Number(today.slice(8, 10));
  const t = f.trips;
  const commission = Math.round(Number(t.fares) * (commissionPct / 100));
  const by = f.own_income_by_type ?? {};
  const managedMargin = Number(by.management_margin ?? 0);
  const recurring = managedMargin + Number(by.revenue ?? 0);
  return {
    month, days, requested: Number(t.requested), completed: Number(t.completed), perDay: days ? Math.round((Number(t.completed) / days) * 10) / 10 : 0,
    completionPct: t.requested ? Math.round((Number(t.completed) / Number(t.requested)) * 100) : null, noDriverPct: t.requested ? Math.round((Number(t.no_driver) / Number(t.requested)) * 100) : null,
    ownIncome: recurring + Number(by.onboarding_fee ?? 0) + commission, ownRecurring: recurring + commission, commission, managedMargin,
    spentTotal: Object.values(f.spent_by_type ?? {}).reduce((s, n) => s + Number(n), 0), budgetSpent: Number(f.budget_spent ?? 0), managedCars: Number(f.managed_cars ?? 0),
    itDone: Number(f.it?.issues_done ?? 0), releases: (f.it?.releases ?? []).length,
  };
}

export async function loadFacts(month: string): Promise<MonthFacts | null> {
  const { data } = await supabase.rpc('company_month_facts', { p_from: month, p_to: monthEnd(month) });
  return (data as MonthFacts | null) ?? null;
}

let seq = 0;
export function useReview(month: string) {
  const [review, setReview] = useState<MonthlyReview | null>(null);
  const [reviews, setReviews] = useState<MonthlyReview[]>([]);
  const [facts, setFacts] = useState<MonthFacts | null>(null);
  const [prev, setPrev] = useState<MonthFacts | null>(null);
  const [decisions, setDecisions] = useState<CompanyDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const [r, f, p, d] = await Promise.all([
      supabase.from('company_monthly_reviews').select('*').order('month', { ascending: false }),
      loadFacts(month), loadFacts(shiftMonth(month, -1)),
      supabase.from('company_decisions').select('*').order('number', { ascending: false }),
    ]);
    const list = (r.data as MonthlyReview[]) ?? [];
    setReviews(list); setReview(list.find((x) => x.month === month) ?? null);
    setFacts(f); setPrev(p);
    setDecisions((d.data as CompanyDecision[]) ?? []);
    setLoading(false);
  }, [month]);
  useEffect(() => {
    setLoading(true); load();
    const ch = supabase.channel(`company-review-${++seq}`).on('postgres_changes', { event: '*', schema: 'public', table: 'company_monthly_reviews' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { review, reviews, facts, prev, decisions, loading, reload: load };
}

export function useDecisions() {
  const [decisions, setDecisions] = useState<CompanyDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from('company_decisions').select('*').order('number', { ascending: false });
    setDecisions((data as CompanyDecision[]) ?? []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { decisions, loading, reload: load };
}
