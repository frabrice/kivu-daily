import type { LucideIcon } from 'lucide-react';

// The old per-department page keys. The app now uses addresses (see
// src/os/registry.tsx); these keys remain for How to Use content and the
// old-key -> address map (LEGACY_PATH).
export type NavKey =
  | 'home'
  | 'calendar'
  | 'comments'
  | 'analytics'
  | 'dashboard'
  | 'departments'
  | 'leaderboard'
  | 'search'
  | 'admin'
  | 'settings'
  | 'tasks'
  | 'meetings'
  | 'documents'
  | 'announcements'
  | 'fleet'
  | 'call_center'
  | 'marketing'
  | 'social'
  | 'it_hub'
  | 'help'
  | 'activity_log'
  | 'finance'
  | 'finance_dashboard'
  | 'finance_revenue'
  | 'finance_fleet_collections'
  | 'finance_vehicle_owners'
  | 'finance_newsletters'
  | 'finance_payroll'
  | 'finance_driver_payroll'
  | 'finance_suppliers'
  | 'finance_transfers'
  | 'finance_expense_claims'
  | 'finance_accounts'
  | 'finance_reconciliation'
  | 'finance_deposit_confirmations'
  | 'finance_team'
  | 'fleet_pipeline'
  | 'fleet_vehicles'
  | 'fleet_deposits'
  | 'fleet_fines'
  | 'fleet_leaderboard'
  | 'fleet_branding'
  | 'finance_driver_leaderboard'
  | 'call_center_queue'
  | 'call_center_directory'
  | 'call_center_scripts'
  | 'call_center_tickets'
  | 'from_call_center'
  | 'call_center_outreach'
  | 'call_analytics'
  | 'performance'
  | 'marketing_campaigns'
  | 'marketing_followups'
  | 'it_hub_products'
  | 'it_hub_issues'
  | 'non_insider'
  | 'driver_pauses';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: LucideIcon;
  badge?: number;
}
