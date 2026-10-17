import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Tone } from '../ui/kit';

// Company plan, phase 3 (migration 20261024100000): expansion stages with
// gates and needs, and the marketing plan grouped by what we need.

export type StageStatus = 'planned' | 'preparing' | 'live' | 'paused' | 'dropped';
export interface Stage { id: string; number: number; name: string; summary: string | null; places: string[]; status: StageStatus; target_date: string | null; owner_id: string | null; budget_id: string | null; sort: number }
export type GateSource = 'manual' | 'check' | 'completed_per_day' | 'requests_per_day' | 'completion_pct' | 'no_driver_pct' | 'monthly_surplus' | 'managed_cars';
export interface Gate { id: string; stage_id: string; title: string; source: GateSource; comparator: '>=' | '<='; target: number | null; current_value: number | null; done: boolean; sort: number }
export type NeedKind = 'cars' | 'drivers' | 'charging' | 'people' | 'office' | 'marketing' | 'money' | 'legal' | 'tech' | 'other';
export interface StageNeed { id: string; stage_id: string; kind: NeedKind; description: string; quantity: number | null; cost: number | null; status: 'todo' | 'doing' | 'done'; owner_id: string | null; due_date: string | null; sort: number }
export type MarketingNeed = 'drivers' | 'riders' | 'companies' | 'launch' | 'brand';
export interface Activity {
  id: string; need: MarketingNeed; title: string; channel: string; description: string | null; start_month: string; months: number; planned_cost: number; actual_cost: number | null;
  budget_id: string | null; expected_value: number | null; expected_unit: string | null; actual_value: number | null; status: 'planned' | 'running' | 'done' | 'stopped';
  owner_id: string | null; departments: string[]; campaign_id: string | null; stage_id: string | null; notes: string | null; sort: number;
}
export interface CampaignResult { id: string; name: string; status: string; contacts: number; contacted: number; negotiating: number; won: number }

export const STAGE_STATUS: Record<StageStatus, { label: string; tone: Tone }> = {
  planned: { label: 'Planned', tone: 'neutral' }, preparing: { label: 'Preparing', tone: 'attention' }, live: { label: 'Live', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' }, dropped: { label: 'Dropped', tone: 'danger' },
};
export const GATE_SOURCES: { key: GateSource; label: string; unit: string }[] = [
  { key: 'check', label: 'Yes / no — ticked when true', unit: '' },
  { key: 'manual', label: 'A number updated by hand', unit: '' },
  { key: 'completion_pct', label: 'Live: % of requests completed (7 days)', unit: '%' },
  { key: 'no_driver_pct', label: 'Live: % of requests with no driver (7 days)', unit: '%' },
  { key: 'completed_per_day', label: 'Live: completed trips per day (7 days)', unit: 'trips' },
  { key: 'requests_per_day', label: 'Live: ride requests per day (7 days)', unit: 'requests' },
  { key: 'monthly_surplus', label: 'Live: own income minus running costs, per month', unit: 'RWF' },
  { key: 'managed_cars', label: 'Live: managed cars on the road', unit: 'cars' },
];
export const NEED_KIND: Record<NeedKind, string> = {
  cars: 'Cars', drivers: 'Drivers', charging: 'Charging', people: 'People', office: 'Office', marketing: 'Marketing', money: 'Money', legal: 'Licences & legal', tech: 'Tech & devices', other: 'Other',
};
export const MARKETING_NEEDS: { key: MarketingNeed; label: string; why: string }[] = [
  { key: 'drivers', label: 'More drivers', why: 'Riders who find no driver are lost trips — supply comes first.' },
  { key: 'riders', label: 'More riders', why: 'Once a car is always there, bring people to try it and come back.' },
  { key: 'companies', label: 'Companies', why: 'Steady weekday trips, paid by invoice.' },
  { key: 'launch', label: 'New towns', why: 'Launching Kivu Ride where we are not yet.' },
  { key: 'brand', label: 'Brand', why: 'Being known and trusted (clean, safe, electric).' },
];
export const CHANNELS: { key: string; label: string }[] = [
  { key: 'driver_recruitment', label: 'Driver recruitment' }, { key: 'incentives', label: 'Driver incentives' }, { key: 'promotions', label: 'Offers & referrals' },
  { key: 'social_ads', label: 'Social media ads' }, { key: 'content', label: 'Content' }, { key: 'influencers', label: 'Influencers' }, { key: 'corporate_sales', label: 'Corporate sales' },
  { key: 'partnerships', label: 'Partnerships (hotels, venues…)' }, { key: 'events', label: 'Events & stands' }, { key: 'radio_tv', label: 'Radio / TV' }, { key: 'print', label: 'Print & outdoor' },
  { key: 'pr', label: 'Press' }, { key: 'local_launch', label: 'Local launch' }, { key: 'other', label: 'Other' },
];
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<string, string>;
export const ACTIVITY_STATUS: Record<Activity['status'], { label: string; tone: Tone }> = {
  planned: { label: 'Planned', tone: 'neutral' }, running: { label: 'Running', tone: 'accent' }, done: { label: 'Done', tone: 'success' }, stopped: { label: 'Stopped', tone: 'danger' },
};

export type LiveNumbers = Partial<Record<Exclude<GateSource, 'manual' | 'check'>, number | null>>;
export function gateValue(g: Gate, live: LiveNumbers): number | null {
  if (g.source === 'check') return null;
  if (g.source === 'manual') return g.current_value === null ? null : Number(g.current_value);
  return live[g.source] ?? null;
}
export function gateMet(g: Gate, live: LiveNumbers): boolean | null {
  if (g.source === 'check') return g.done;
  const v = gateValue(g, live);
  if (v === null || g.target === null) return null;
  return g.comparator === '>=' ? v >= Number(g.target) : v <= Number(g.target);
}

let seq = 0;
export function useGrowth() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [needs, setNeeds] = useState<StageNeed[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignResult[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const [s, g, n, a, c] = await Promise.all([
      supabase.from('company_expansion_stages').select('*').order('sort').order('number'),
      supabase.from('company_expansion_gates').select('*').order('sort'),
      supabase.from('company_expansion_needs').select('*').order('sort'),
      supabase.from('company_marketing_activities').select('*').order('start_month').order('sort'),
      supabase.rpc('company_campaign_results'),
    ]);
    setStages((s.data as Stage[]) ?? []);
    setGates((g.data as Gate[]) ?? []);
    setNeeds((n.data as StageNeed[]) ?? []);
    setActivities((a.data as Activity[]) ?? []);
    setCampaigns(((c.data ?? []) as CampaignResult[]).map((x) => ({ ...x, contacts: Number(x.contacts), contacted: Number(x.contacted), negotiating: Number(x.negotiating), won: Number(x.won) })));
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`company-growth-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_expansion_stages' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_marketing_activities' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { stages, gates, needs, activities, campaigns, loading, reload: load };
}
export type GrowthData = ReturnType<typeof useGrowth>;
