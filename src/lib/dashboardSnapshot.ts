import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { depositDaysSince } from './fleet';
import { todayStr } from './utils';

export interface CompanySnapshot {
  fleet: { totalDrivers: number; activeDrivers: number; totalVehicles: number; overdueDeposits: number };
  finance: { monthRevenue: number; monthExpenses: number; pendingTransactions: number };
  callCenter: { followUpsNeeded: number };
  marketing: { activeCampaigns: number; overdueFollowUps: number };
  itHub: { totalProducts: number; openIssues: number };
  loading: boolean;
}

const EMPTY: CompanySnapshot = {
  fleet: { totalDrivers: 0, activeDrivers: 0, totalVehicles: 0, overdueDeposits: 0 },
  finance: { monthRevenue: 0, monthExpenses: 0, pendingTransactions: 0 },
  callCenter: { followUpsNeeded: 0 },
  marketing: { activeCampaigns: 0, overdueFollowUps: 0 },
  itHub: { totalProducts: 0, openIssues: 0 },
  loading: true,
};

// A read-only, MD-dashboard-only summary across every department. Kept
// deliberately separate from each department's own realtime hook
// (useFleetData, useFinanceData, useCallCenterData, useMarketingData,
// useITHubData) rather than reusing them here, because the dashboard
// stays mounted the whole time the MD is in the app - reusing one of
// those hooks would open a second realtime subscription under the same
// channel name the moment the MD also opens that department's own page,
// which Supabase rejects outright (see FleetPage.tsx for the full story).
export function useCompanySnapshot() {
  const [snapshot, setSnapshot] = useState<CompanySnapshot>(EMPTY);

  const load = useCallback(async () => {
    const monthStart = `${todayStr().slice(0, 7)}-01`;

    const [
      driversRes, vehiclesRes, depositsRes,
      monthTxRes, pendingTxRes,
      callLogsRes,
      campaignsRes, contactsRes,
      productsRes, storiesRes,
    ] = await Promise.all([
      supabase.from('drivers').select('id, stage, vehicle_id, initial_deposit_paid, initial_deposit_date'),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }),
      supabase.from('driver_deposits').select('driver_id, paid_date'),
      supabase.from('finance_transactions').select('amount, direction').gte('transaction_date', monthStart),
      supabase.from('finance_transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('call_logs').select('id, outcome:call_outcomes(needs_followup)'),
      supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('contacts').select('next_follow_up, stage'),
      supabase.from('products').select('id', { count: 'exact', head: true }),
      supabase.from('user_stories').select('source, status'),
    ]);

    const drivers = (driversRes.data as { id: string; stage: string; vehicle_id: string | null; initial_deposit_paid: boolean; initial_deposit_date: string | null }[]) ?? [];
    const deposits = (depositsRes.data as { driver_id: string; paid_date: string }[]) ?? [];
    const overdueDeposits = drivers
      .filter((d) => d.vehicle_id)
      .filter((d) => {
        const lastLogged = deposits.filter((dep) => dep.driver_id === d.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date))[0]?.paid_date ?? null;
        const daysSince = depositDaysSince(lastLogged, d.initial_deposit_paid, d.initial_deposit_date);
        return daysSince === null || daysSince >= 7;
      }).length;

    const monthTx = (monthTxRes.data as { amount: number; direction: 'in' | 'out' }[]) ?? [];

    const callLogs = (callLogsRes.data as unknown as { outcome: { needs_followup: boolean }[] | null }[]) ?? [];

    const contacts = (contactsRes.data as { next_follow_up: string | null; stage: string }[]) ?? [];

    const stories = (storiesRes.data as { source: string; status: string }[]) ?? [];

    setSnapshot({
      fleet: {
        totalDrivers: drivers.length,
        activeDrivers: drivers.filter((d) => d.stage === 'active').length,
        totalVehicles: vehiclesRes.count ?? 0,
        overdueDeposits,
      },
      finance: {
        monthRevenue: monthTx.filter((t) => t.direction === 'in').reduce((s, t) => s + t.amount, 0),
        monthExpenses: monthTx.filter((t) => t.direction === 'out').reduce((s, t) => s + t.amount, 0),
        pendingTransactions: pendingTxRes.count ?? 0,
      },
      callCenter: {
        followUpsNeeded: callLogs.filter((l) => l.outcome?.[0]?.needs_followup).length,
      },
      marketing: {
        activeCampaigns: campaignsRes.count ?? 0,
        overdueFollowUps: contacts.filter((c) => c.next_follow_up && c.stage !== 'won' && c.stage !== 'lost' && c.next_follow_up < todayStr()).length,
      },
      itHub: {
        totalProducts: productsRes.count ?? 0,
        openIssues: stories.filter((s) => s.source === 'flagged' && s.status !== 'done').length,
      },
      loading: false,
    });
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('dashboard-snapshot-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_deposits' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_transactions' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_stories' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return snapshot;
}
