import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Tone } from '../ui/kit';

// Company plan, phase 2 (migration 20261023100000): cash and runway, the
// funding pipeline, sources & uses and scenarios. Full plan access only.

export interface MoneySettings { monthly_costs: number; commission_pct: number; notes: string | null; updated_by: string | null; updated_at: string }
export interface CashCheck { id: string; checked_on: string; account_key: string; label: string; amount: number; is_own: boolean; note: string | null; created_by: string | null; created_at: string }
export type FundingKind = 'asset_finance' | 'equity' | 'driver_scheme' | 'loan' | 'grant' | 'partner' | 'other';
export type FundingStatus = 'idea' | 'pending' | 'agreed' | 'received' | 'lost';
export interface Funding {
  id: string; number: number; name: string; kind: FundingKind; counterparty: string | null; amount: number | null; status: FundingStatus; probability: number | null;
  expected_date: string | null; received_amount: number; received_date: string | null; cash_to_company: boolean; terms: string | null; next_step: string | null;
  owner_id: string | null; sort: number;
}
export interface FundingUse { id: string; funding_id: string; description: string; amount: number; budget_id: string | null; sort: number }
export interface Scenario { id: string; name: string; inputs: ScenarioInputs; notes: string | null; created_by: string | null; updated_at: string }
export interface MoneyLive {
  own_income_30d: number; own_income_by_type: Record<string, number>; completed_30d: number; fares_30d: number; managed_cars: number; ledger_since: string | null;
}
export interface FinanceAccount { id: string; key: string; name: string; bank_name: string | null; purpose: string | null }

export const FUNDING_KIND: Record<FundingKind, string> = {
  asset_finance: 'Asset finance (cars)', equity: 'Equity investment', driver_scheme: 'Driver ownership scheme', loan: 'Loan', grant: 'Grant / green fund', partner: 'Partner / project investor', other: 'Other',
};
export const FUNDING_STATUS: Record<FundingStatus, { label: string; tone: Tone; help: string }> = {
  idea: { label: 'Idea', tone: 'neutral', help: 'Not approached yet' }, pending: { label: 'In talks', tone: 'attention', help: 'Talking, nothing signed' },
  agreed: { label: 'Agreed', tone: 'info', help: 'Signed or confirmed, not received yet' }, received: { label: 'Received', tone: 'success', help: 'The money is in' },
  lost: { label: 'Lost', tone: 'danger', help: 'Not happening' },
};
// Owners' and drivers' money sits in these accounts: not Kivu Ride's own by default.
export const NOT_OWN_BY_DEFAULT = ['bank_of_kigali', 'momo'];

export const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
export const rwfShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(Math.abs(n) % 1e6 ? 1 : 0)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const addMonthsKey = (key: string, n: number) => { const d = new Date(`${key}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return monthKey(d); };
export const monthName = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

// Latest balance per account.
export function latestCash(checks: CashCheck[]) {
  const seen = new Map<string, CashCheck>();
  for (const c of [...checks].sort((a, b) => b.checked_on.localeCompare(a.checked_on) || b.created_at.localeCompare(a.created_at))) if (!seen.has(c.account_key)) seen.set(c.account_key, c);
  const list = [...seen.values()];
  return { list, own: list.filter((c) => c.is_own).reduce((s, c) => s + Number(c.amount), 0), held: list.filter((c) => !c.is_own).reduce((s, c) => s + Number(c.amount), 0), asOf: list.map((c) => c.checked_on).sort()[0] ?? null };
}

// What Kivu Ride earns per month today: what Finance records as its own
// (managed-car margins, fees, onboarding) plus the app commission estimate.
export function incomeNow(live: MoneyLive, s: MoneySettings) {
  const commission = Math.round(Number(live.fares_30d) * (Number(s.commission_pct) / 100));
  const byType = live.own_income_by_type ?? {};
  const onboarding = Number(byType.onboarding_fee ?? 0);
  const recurring = Number(byType.management_margin ?? 0) + Number(byType.revenue ?? 0);
  return {
    commission, onboarding, managedMargin: Number(byType.management_margin ?? 0), fees: Number(byType.revenue ?? 0),
    recurring: recurring + commission, total: recurring + onboarding + commission,
    avgFare: live.completed_30d ? Math.round(Number(live.fares_30d) / Number(live.completed_30d)) : 0, tripsPerDay: Math.round((Number(live.completed_30d) / 30) * 10) / 10,
  };
}

// Funding expected to reach Kivu Ride's own accounts, by month (weighted by probability for deals in talks).
export function expectedFunding(funding: Funding[], weighted: boolean) {
  return funding.filter((f) => f.cash_to_company && f.amount && ['pending', 'agreed'].includes(f.status) && f.expected_date)
    .map((f) => ({ f, month: f.expected_date!.slice(0, 7), amount: (Number(f.amount) - Number(f.received_amount)) * (f.status === 'agreed' ? 1 : weighted ? (f.probability ?? 0) / 100 : 1) }))
    .filter((x) => x.amount > 0);
}

// ------------------------------------------------------------ scenarios
export interface ScenarioInputs {
  tripsPerDay: number; avgFare: number; commissionPct: number; managedCars: number; marginPerCar: number; feePerCar: number; otherIncome: number; monthlyCosts: number; cash: number;
}
export function runScenario(i: ScenarioInputs) {
  const commission = i.tripsPerDay * 30 * i.avgFare * (i.commissionPct / 100);
  const managed = i.managedCars * (i.marginPerCar + i.feePerCar);
  const income = commission + managed + i.otherIncome;
  const profit = income - i.monthlyCosts;
  const perTrip = i.avgFare * (i.commissionPct / 100);
  const breakEvenTrips = perTrip > 0 ? Math.max(0, Math.ceil((i.monthlyCosts - managed - i.otherIncome) / 30 / perTrip)) : null;
  const carsToBreakEven = i.marginPerCar + i.feePerCar > 0 ? Math.max(0, Math.ceil((i.monthlyCosts - commission - i.otherIncome) / (i.marginPerCar + i.feePerCar))) : null;
  const runwayMonths = profit >= 0 ? null : i.cash > 0 ? Math.floor((i.cash / -profit) * 10) / 10 : 0;
  return { commission, managed, income, profit, perTrip, breakEvenTrips, carsToBreakEven, runwayMonths };
}

// ------------------------------------------------------------ loading
let seq = 0;
export function useMoney() {
  const [settings, setSettings] = useState<MoneySettings | null>(null);
  const [checks, setChecks] = useState<CashCheck[]>([]);
  const [funding, setFunding] = useState<Funding[]>([]);
  const [uses, setUses] = useState<FundingUse[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [live, setLive] = useState<MoneyLive | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const [s, c, f, u, sc, l, a] = await Promise.all([
      supabase.from('company_money_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('company_cash_checks').select('*').order('checked_on', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      supabase.from('company_funding').select('*').order('sort').order('number'),
      supabase.from('company_funding_uses').select('*').order('sort'),
      supabase.from('company_scenarios').select('*').order('updated_at', { ascending: false }),
      supabase.rpc('company_money_live'),
      supabase.from('finance_accounts').select('id, key, name, bank_name, purpose').order('created_at'),
    ]);
    setSettings((s.data as MoneySettings | null) ?? null);
    setChecks((c.data as CashCheck[]) ?? []);
    setFunding((f.data as Funding[]) ?? []);
    setUses((u.data as FundingUse[]) ?? []);
    setScenarios((sc.data as Scenario[]) ?? []);
    setLive((l.data as MoneyLive | null) ?? null);
    setAccounts((a.data as FinanceAccount[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`company-money-${++seq}`).on('postgres_changes', { event: '*', schema: 'public', table: 'company_funding' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { settings, checks, funding, uses, scenarios, live, accounts, loading, reload: load };
}
export type MoneyData = ReturnType<typeof useMoney>;
