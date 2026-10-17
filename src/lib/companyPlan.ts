import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { addDays, kigaliToday } from './it';
import type { Tone } from '../ui/kit';

// The company plan (migration 20261022100000): vision and North Star,
// company objectives, the priorities board and budgets.

export interface PlanMember { profile_id: string; access: 'full' | 'department'; department_slug: string | null }
export interface Vision {
  vision: string | null; mission: string | null; ambition: string | null; north_star_name: string; north_star_target: number | null;
  north_star_target_date: string | null; break_even_per_day: number; updated_by: string | null; updated_at: string;
}
export type KrSource = 'manual' | 'completed_per_day' | 'requests_per_day' | 'completion_pct' | 'no_driver_pct';
export interface CompanyObjective { id: string; period: string; title: string; why: string | null; owner_id: string | null; departments: string[]; status: 'draft' | 'active' | 'achieved' | 'missed' | 'dropped'; sort: number }
export interface CompanyKr { id: string; objective_id: string; title: string; unit: string | null; source: KrSource; start_value: number; target_value: number; current_value: number; lower_is_better: boolean; sort: number }
export type Horizon = 'now' | 'next' | 'later' | 'not_doing';
export interface Priority {
  id: string; number: number; title: string; problem: string | null; expected_impact: string | null; departments: string[]; owner_id: string | null; objective_id: string | null;
  horizon: Horizon; status: 'proposed' | 'active' | 'done' | 'dropped'; impact_score: number | null; confidence_score: number | null; ease_score: number | null; urgency_score: number | null;
  start_date: string | null; target_date: string | null; it_initiative_id: string | null; notes: string | null; sort: number; created_by: string | null;
}
export type BudgetKind = 'marketing' | 'operations' | 'people' | 'fleet' | 'it' | 'expansion' | 'other';
export type BudgetStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'closed';
export interface Budget {
  id: string; number: number; name: string; kind: BudgetKind; department_slug: string | null; owner_id: string | null; start_month: string; months: number;
  goal: string | null; expected_result: string | null; target_value: number | null; target_unit: string | null; priority_id: string | null; objective_id: string | null;
  answers: Record<string, unknown>; status: BudgetStatus; approved_amount: number | null; approved_by: string | null; approved_at: string | null; decision_note: string | null;
  submitted_at: string | null; created_by: string | null; created_at: string;
}
export interface BudgetLine { id: string; budget_id: string; category: string; description: string; amount: number; recurrence: 'one_off' | 'monthly'; months: number; notes: string | null; sort: number }
export interface BudgetSpend { id: string; company_budget_id: string; amount: number; transaction_date: string; status: string; description: string | null; counterparty: string | null; reference: string | null }
export interface TripDay { day: string; requested: number; completed: number; no_driver: number }

export const DEPARTMENTS: { slug: string; label: string }[] = [
  { slug: 'fleet', label: 'Fleet' }, { slug: 'call_center', label: 'Call Center' }, { slug: 'marketing_sales_bd', label: 'Marketing / Sales / BD' },
  { slug: 'social_media', label: 'Social Media' }, { slug: 'finance', label: 'Finance' }, { slug: 'it', label: 'IT' }, { slug: 'admin', label: 'Admin' },
];
export const DEPT_LABEL = Object.fromEntries(DEPARTMENTS.map((d) => [d.slug, d.label])) as Record<string, string>;
export const HORIZONS: { key: Horizon; label: string; help: string }[] = [
  { key: 'now', label: 'Now', help: 'What we put people and money on this quarter — keep it to 3–5' },
  { key: 'next', label: 'Next', help: 'Starts when something in Now finishes' },
  { key: 'later', label: 'Later', help: 'Good ideas, not yet' },
  { key: 'not_doing', label: 'Not doing', help: 'Decided against — so nobody spends time on it' },
];
export const OBJECTIVE_STATUS: Record<CompanyObjective['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, active: { label: 'Active', tone: 'accent' }, achieved: { label: 'Achieved', tone: 'success' }, missed: { label: 'Missed', tone: 'danger' }, dropped: { label: 'Dropped', tone: 'neutral' },
};
export const PRIORITY_STATUS: Record<Priority['status'], { label: string; tone: Tone }> = {
  proposed: { label: 'Proposed', tone: 'attention' }, active: { label: 'Active', tone: 'accent' }, done: { label: 'Done', tone: 'success' }, dropped: { label: 'Dropped', tone: 'neutral' },
};
export const BUDGET_STATUS: Record<BudgetStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, submitted: { label: 'Waiting for approval', tone: 'attention' }, approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' }, closed: { label: 'Closed', tone: 'neutral' },
};
export const KR_SOURCES: { key: KrSource; label: string; unit: string; lowerIsBetter?: boolean }[] = [
  { key: 'manual', label: 'Updated by hand', unit: '' },
  { key: 'completed_per_day', label: 'Live: completed trips per day (7-day average)', unit: 'trips' },
  { key: 'requests_per_day', label: 'Live: ride requests per day (7-day average)', unit: 'requests' },
  { key: 'completion_pct', label: 'Live: % of requests completed (7 days)', unit: '%' },
  { key: 'no_driver_pct', label: 'Live: % of requests with no driver (7 days)', unit: '%', lowerIsBetter: true },
];

// ------------------------------------------------------------ budget questions
export interface TemplateItem { category: string; description: string; recurrence: 'one_off' | 'monthly'; amount?: number; hint?: string }
export interface KindDef { key: BudgetKind; label: string; dept: string | null; blurb: string; goals: string[]; units: string[]; items: TemplateItem[] }
export const BUDGET_KINDS: KindDef[] = [
  { key: 'marketing', label: 'Marketing', dept: 'marketing_sales_bd', blurb: 'Getting riders, companies and drivers: ads, content, events, promotions.',
    goals: ['Get new riders', 'More app downloads', 'Sign corporate accounts', 'Recruit drivers', 'Brand awareness', 'Launch in a new city'],
    units: ['new riders', 'downloads', 'corporate accounts', 'drivers', 'completed trips'],
    items: [
      { category: 'Ads', description: 'Social media boosting (Instagram, Facebook, X)', recurrence: 'monthly', amount: 100000, hint: 'current: 100,000/month' },
      { category: 'Content', description: 'Content creation (photos, videos)', recurrence: 'monthly', amount: 100000, hint: 'current: 100,000/month' },
      { category: 'Influencers', description: 'Influencer posts', recurrence: 'monthly' },
      { category: 'Promotions', description: 'First-ride discounts and referral bonuses', recurrence: 'monthly' },
      { category: 'Print', description: 'Flyers, posters, stickers', recurrence: 'one_off' },
      { category: 'Events', description: 'Stands, events and activations', recurrence: 'one_off' },
      { category: 'Media', description: 'Radio / TV / billboards', recurrence: 'one_off' },
      { category: 'Sales', description: 'Corporate sales visits and materials', recurrence: 'monthly' },
    ] },
  { key: 'operations', label: 'Office & operations', dept: 'admin', blurb: 'Running the company day to day.',
    goals: ['Keep the office running', 'Open a new office', 'Reduce running costs'], units: [],
    items: [
      { category: 'Office', description: 'Rent', recurrence: 'monthly' },
      { category: 'Office', description: 'Electricity, water and internet', recurrence: 'monthly', amount: 100000, hint: 'current: 100,000/month' },
      { category: 'Office', description: 'Cleaning and housekeeping', recurrence: 'monthly' },
      { category: 'Office', description: 'Office supplies', recurrence: 'monthly' },
      { category: 'Transport', description: 'Staff transport and fuel', recurrence: 'monthly' },
      { category: 'Communication', description: 'Phones and airtime (Call Center lines)', recurrence: 'monthly' },
      { category: 'Legal', description: 'Legal, accounting and licences', recurrence: 'one_off' },
    ] },
  { key: 'people', label: 'People', dept: 'admin', blurb: 'Salaries, new hires, interns and training.',
    goals: ['Pay the current team', 'Hire for a new role', 'Train the team'], units: ['people'],
    items: [
      { category: 'Salaries', description: 'Current team salaries', recurrence: 'monthly' },
      { category: 'Hiring', description: 'New role', recurrence: 'monthly' },
      { category: 'Interns', description: 'Intern allowances', recurrence: 'monthly' },
      { category: 'Training', description: 'Training', recurrence: 'one_off' },
      { category: 'Hiring', description: 'Recruitment costs', recurrence: 'one_off' },
    ] },
  { key: 'fleet', label: 'Fleet', dept: 'fleet', blurb: 'Cars and drivers: deposits, branding, devices, insurance, charging.',
    goals: ['Launch new cars', 'Keep the fleet running', 'Recruit and train drivers'], units: ['cars', 'drivers'],
    items: [
      { category: 'Cars', description: 'Vehicle deposits', recurrence: 'one_off' },
      { category: 'Cars', description: 'Insurance', recurrence: 'monthly' },
      { category: 'Branding', description: 'Car branding', recurrence: 'one_off' },
      { category: 'Devices', description: 'In-car terminals / GPS', recurrence: 'one_off' },
      { category: 'Drivers', description: 'Driver onboarding, training and uniforms', recurrence: 'one_off' },
      { category: 'Charging', description: 'Charging', recurrence: 'monthly' },
      { category: 'Maintenance', description: 'Maintenance reserve', recurrence: 'monthly' },
    ] },
  { key: 'it', label: 'IT running costs', dept: 'it', blurb: 'What keeps the apps running. (Big IT projects have their own budgets on the IT roadmap.)',
    goals: ['Keep the apps running', 'Add a service'], units: [],
    items: [
      { category: 'Hosting', description: 'App hosting', recurrence: 'monthly', amount: 461000, hint: 'current: 461,000/month' },
      { category: 'Services', description: 'SMS, maps and other services', recurrence: 'monthly' },
      { category: 'Services', description: 'Payment gateway fees', recurrence: 'monthly' },
      { category: 'Devices', description: 'Laptops and phones', recurrence: 'one_off' },
      { category: 'Tools', description: 'Software subscriptions', recurrence: 'monthly' },
    ] },
  { key: 'expansion', label: 'Expansion', dept: 'fleet', blurb: 'Launching Kivu Ride in a new city or province.',
    goals: ['Launch in a new city', 'Test a new city'], units: ['completed trips', 'drivers', 'cars'],
    items: [
      { category: 'People', description: 'Local agent / coordinator', recurrence: 'monthly' },
      { category: 'Drivers', description: 'Driver recruitment and training in the city', recurrence: 'one_off' },
      { category: 'Marketing', description: 'Local launch marketing', recurrence: 'one_off' },
      { category: 'Charging', description: 'Charging access', recurrence: 'one_off' },
      { category: 'Travel', description: 'Team travel and accommodation', recurrence: 'one_off' },
      { category: 'Office', description: 'Local office or desk', recurrence: 'monthly' },
    ] },
  { key: 'other', label: 'Something else', dept: null, blurb: 'Any other budget.', goals: [], units: [], items: [] },
];
export const KIND = Object.fromEntries(BUDGET_KINDS.map((k) => [k.key, k])) as Record<BudgetKind, KindDef>;

// ------------------------------------------------------------ helpers
export const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
export const rwfShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const lineTotal = (l: Pick<BudgetLine, 'amount' | 'recurrence' | 'months'>) => Number(l.amount) * (l.recurrence === 'monthly' ? l.months : 1);
export const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
export const quarterLabel = (q: string) => `Q${q.slice(-1)} ${q.slice(0, 4)}`;
export const nextQuarters = (n = 4) => { const out: string[] = []; let q = quarterOf(kigaliToday()); for (let i = 0; i < n; i++) { out.push(q); const y = Number(q.slice(0, 4)), k = Number(q.slice(-1)); q = k === 4 ? `${y + 1}-Q1` : `${y}-Q${k + 1}`; } return out; };
export const monthLabel = (d: string) => new Date(`${d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
export const monthsOf = (start: string, n: number) => Array.from({ length: n }, (_, k) => { const d = new Date(`${start.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 7); });
export const endMonth = (b: Pick<Budget, 'start_month' | 'months'>) => monthsOf(b.start_month, b.months).slice(-1)[0];

// Score out of 100: impact × confidence × ease × urgency (each 1–5).
export function scoreOf(p: Priority): number | null {
  const s = [p.impact_score, p.confidence_score, p.ease_score, p.urgency_score];
  if (s.some((x) => !x)) return null;
  return Math.round((s.reduce((a, b) => a! * b!, 1)! / 625) * 100);
}

// Live numbers from the last 7 full days.
export function liveValues(days: TripDay[]) {
  const to = addDays(kigaliToday(), -1), from = addDays(to, -6);
  const w = days.filter((d) => d.day >= from && d.day <= to);
  const sum = (k: keyof TripDay) => w.reduce((s, d) => s + Number(d[k]), 0);
  const req = sum('requested'), done = sum('completed'), lost = sum('no_driver');
  return {
    completed_per_day: Math.round((done / 7) * 10) / 10, requests_per_day: Math.round((req / 7) * 10) / 10,
    completion_pct: req ? Math.round((done / req) * 100) : 0, no_driver_pct: req ? Math.round((lost / req) * 100) : 0,
  } as Record<Exclude<KrSource, 'manual'>, number>;
}
export const krValue = (k: CompanyKr, live: ReturnType<typeof liveValues>) => (k.source === 'manual' ? Number(k.current_value) : live[k.source]);
export function krProgress(k: CompanyKr, value: number) {
  const span = Number(k.target_value) - Number(k.start_value);
  if (!span) return value === Number(k.target_value) ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((value - Number(k.start_value)) / span) * 100)));
}

export function budgetMoney(b: Budget, lines: BudgetLine[], spend: BudgetSpend[]) {
  const mine = lines.filter((l) => l.budget_id === b.id);
  const planned = mine.reduce((s, l) => s + lineTotal(l), 0);
  const spent = spend.filter((x) => x.company_budget_id === b.id).reduce((s, x) => s + Number(x.amount), 0);
  const approved = b.approved_amount === null ? null : Number(b.approved_amount);
  return { planned, spent, approved, over: approved !== null && planned > approved, left: (approved ?? planned) - spent };
}

// ------------------------------------------------------------ loading
let seq = 0;
export function usePlan() {
  const [vision, setVision] = useState<Vision | null>(null);
  const [objectives, setObjectives] = useState<CompanyObjective[]>([]);
  const [krs, setKrs] = useState<CompanyKr[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [spend, setSpend] = useState<BudgetSpend[]>([]);
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [trips, setTrips] = useState<TripDay[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<{ id: string; name: string; dept: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const to = kigaliToday();
    const [v, o, k, p, b, l, s, m, t, ppl] = await Promise.all([
      supabase.from('company_vision').select('*').eq('id', 1).maybeSingle(),
      supabase.from('company_objectives').select('*').order('period', { ascending: false }).order('sort'),
      supabase.from('company_key_results').select('*').order('sort'),
      supabase.from('company_priorities').select('*').order('sort').order('number'),
      supabase.from('company_budgets').select('*').order('number', { ascending: false }),
      supabase.from('company_budget_lines').select('*').order('sort').order('created_at'),
      supabase.rpc('company_budget_spending'),
      supabase.from('company_plan_members').select('*'),
      supabase.rpc('company_trips_daily', { p_from: addDays(to, -89), p_to: to }),
      supabase.from('profiles').select('id, full_name, is_active, department:departments(slug)'),
    ]);
    setVision((v.data as Vision | null) ?? null);
    setObjectives((o.data as CompanyObjective[]) ?? []);
    setKrs((k.data as CompanyKr[]) ?? []);
    setPriorities((p.data as Priority[]) ?? []);
    setBudgets((b.data as Budget[]) ?? []);
    setLines((l.data as BudgetLine[]) ?? []);
    setSpend((s.data as BudgetSpend[]) ?? []);
    setMembers((m.data as PlanMember[]) ?? []);
    setTrips(((t.data as TripDay[]) ?? []).map((d) => ({ ...d, requested: Number(d.requested), completed: Number(d.completed), no_driver: Number(d.no_driver) })));
    const list = ((ppl.data ?? []) as unknown as { id: string; full_name: string; is_active: boolean; department: { slug: string } | null }[]);
    setNames(Object.fromEntries(list.map((x) => [x.id, x.full_name.trim()])));
    setPeople(list.filter((x) => x.is_active).map((x) => ({ id: x.id, name: x.full_name.trim(), dept: x.department?.slug ?? null })).sort((a, b) => a.name.localeCompare(b.name)));
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`company-plan-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_budgets' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_priorities' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  const nameOf = useCallback((id: string | null | undefined) => (id ? names[id] ?? 'Someone' : 'Nobody'), [names]);
  return { vision, objectives, krs, priorities, budgets, lines, spend, members, trips, people, loading, reload: load, nameOf };
}
export type PlanData = ReturnType<typeof usePlan>;
