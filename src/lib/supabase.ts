import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type Role = 'employee' | 'managing_director';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  department_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  force_password_change: boolean;
  last_comment_seen_at: string | null;
  created_at: string;
  updated_at: string;
  department?: Department | null;
}

export type DepartmentSlug =
  | 'it'
  | 'marketing_sales_bd'
  | 'call_center'
  | 'social_media'
  | 'finance'
  | 'fleet'
  | 'admin';

export interface Department {
  id: string;
  name: string;
  slug: DepartmentSlug | null;
  created_at: string;
}

// 'active' is never stored - it's computed by effectiveStage() in
// lib/fleet.ts from vehicle_id + initial_deposit_paid + contract_status.
// Included here because that's still a value driver.stage can display as
// once computed, even though the DB CHECK constraint no longer allows
// writing it directly.
export type DriverStage = 'applying' | 'raw' | 'ready' | 'active' | 'flagged' | 'inactive';
export type RuraLicenseStatus = 'pending' | 'provided';
export type DriverShift = 'day' | 'night';
export type DriverRestDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type DriverContractStatus = 'active' | 'ended';
export type ContractEventType = 'ended' | 'reactivated';

export type PaymentDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface VehicleOwner {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  bank_name: string | null;
  account_number: string | null;
  payment_day: PaymentDay | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: string;
  plate_number: string;
  make: string | null;
  model: string | null;
  color: string | null;
  device_label: string | null;
  documents: string[];
  notes: string | null;
  given_date: string | null;
  operation_start_date: string | null;
  rura_license_status: RuraLicenseStatus;
  rura_license_issued_date: string | null;
  rura_license_expiry_date: string | null;
  owner_id: string | null;
  weekly_owner_payout_amount: number | null;
  monthly_management_fee_amount: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  owner?: VehicleOwner | null;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  join_date: string | null;
  initial_deposit_paid: boolean;
  initial_deposit_date: string | null;
  initial_deposit_amount: number | null;
  stage: DriverStage;
  notes: string | null;
  vehicle_id: string | null;
  shift: DriverShift | null;
  rest_day: DriverRestDay | null;
  contract_status: DriverContractStatus;
  replaced_driver_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  vehicle?: Vehicle | null;
}

export type DriverDocumentType =
  | 'application_letter' | 'cv' | 'id' | 'driving_license'
  | 'medical_certificate' | 'criminal_record' | 'discipline_certificate';

export interface DriverDocument {
  id: string;
  driver_id: string;
  doc_type: DriverDocumentType;
  file_url: string;
  file_name: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface DriverContractEvent {
  id: string;
  driver_id: string;
  event_type: ContractEventType;
  reason: string;
  details: string | null;
  event_date: string;
  created_by: string | null;
  created_at: string;
}

export type DepositPaymentMethod = 'momo' | 'bank';
export type DepositStatus = 'pending' | 'confirmed';

export interface DriverDeposit {
  id: string;
  driver_id: string;
  amount: number;
  paid_date: string;
  payment_method: DepositPaymentMethod;
  bank_name: string | null;
  status: DepositStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface DriverFine {
  id: string;
  driver_id: string;
  vehicle_id: string | null;
  amount: number;
  fine_date: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  driver?: Driver | null;
  vehicle?: Vehicle | null;
}

export interface DriverFinePayment {
  id: string;
  fine_id: string;
  amount: number;
  paid_date: string;
  created_by: string | null;
  created_at: string;
}

export interface PlatformCar {
  id: string;
  external_id: number | null;
  plate_number: string;
  make: string | null;
  model: string | null;
  color: string | null;
  is_branded: boolean | null;
  allows_branding: boolean | null;
  willing_to_buy_device: boolean | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformDriver {
  id: string;
  external_id: number | null;
  full_name: string;
  phone: string;
  email: string | null;
  is_owner: boolean | null;
  car_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  car?: PlatformCar | null;
}

export type ReviewStatus = 'completed' | 'in_progress' | 'not_done';

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  completed: boolean;
  date: string;
  completed_at: string | null;
  is_carried_over: boolean;
  original_date: string | null;
  parent_task_id: string | null;
  review_status: ReviewStatus | null;
  review_note: string | null;
  reviewed_at: string | null;
  assigned_by: string | null;
  source_meeting_id: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  author_id: string;
  target_user_id: string;
  task_date: string;
  task_id: string | null;
  parent_comment_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
  author?: Profile | null;
  target_user?: Profile | null;
  replies?: Comment[];
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

export type MeetingVisibility = 'private' | 'md' | 'department' | 'company';

export interface Meeting {
  id: string;
  author_id: string;
  title: string;
  date: string;
  notes: string;
  visibility: MeetingVisibility;
  department_id: string | null;
  created_at: string;
  updated_at: string;
  author?: Profile | null;
}

export interface Announcement {
  id: string;
  author_id: string;
  title: string;
  body: string;
  created_at: string;
  author?: Profile | null;
}

export interface DocumentCategory {
  id: string;
  name: string;
  department_id: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  uploader_id: string;
  department_id: string | null;
  title: string;
  description: string | null;
  file_url: string;
  category: string | null;
  category_id: string | null;
  created_at: string;
  uploader?: Profile | null;
  department?: Department | null;
  document_category?: DocumentCategory | null;
}

export type ContentStatus = 'idea' | 'drafted' | 'scheduled' | 'posted';

export interface ContentPost {
  id: string;
  post_date: string;
  platforms: string[];
  pillar: string | null;
  intent: string | null;
  audience: string | null;
  format: string | null;
  status: ContentStatus;
  boosted: boolean;
  budget: number | null;
  caption: string | null;
  performance_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignStatus = 'active' | 'paused' | 'completed';

export interface Campaign {
  id: string;
  name: string;
  goal: string | null;
  owner_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
  owner?: Profile | null;
}

export type ContactStage = 'not_contacted' | 'contacted' | 'negotiating' | 'won' | 'lost';

export interface Contact {
  id: string;
  campaign_id: string;
  org_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  type_tag: string | null;
  stage: ContactStage;
  last_touch: string | null;
  next_follow_up: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallReason {
  id: string;
  label: string;
  sort_order: number;
  created_at: string;
}

export interface CallOutcome {
  id: string;
  label: string;
  needs_followup: boolean;
  sort_order: number;
  created_at: string;
}

export interface CallScript {
  id: string;
  reason_id: string | null;
  title: string;
  body: string;
  created_by: string | null;
  created_at: string;
}

export interface CallLog {
  id: string;
  driver_id: string;
  caller_id: string;
  reason_id: string;
  outcome_id: string;
  note: string | null;
  created_at: string;
  driver?: Driver | null;
  caller?: Profile | null;
  reason?: CallReason | null;
  outcome?: CallOutcome | null;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export type MilestoneStatus = 'planned' | 'in_progress' | 'shipped';

export interface Milestone {
  id: string;
  product_id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  status: MilestoneStatus;
  created_at: string;
}

export interface Feature {
  id: string;
  milestone_id: string;
  name: string;
  description: string | null;
  is_flag_inbox: boolean;
  created_at: string;
}

export type UserStoryStatus = 'backlog' | 'in_progress' | 'review' | 'done';
export type UserStoryPriority = 'low' | 'medium' | 'high';
export type UserStorySource = 'manual' | 'flagged';

export interface AcceptanceCriterion {
  text: string;
  done: boolean;
}

export interface UserStory {
  id: string;
  feature_id: string | null;
  product_id: string | null;
  linked_task_id: string | null;
  title: string | null;
  persona: string;
  need: string;
  benefit: string;
  details: string | null;
  acceptance_criteria: AcceptanceCriterion[];
  status: UserStoryStatus;
  priority: UserStoryPriority;
  assignee_id: string | null;
  source: UserStorySource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assignee?: Profile | null;
  product?: Product | null;
}

export interface ActivityLogEntry {
  id: string;
  actor_id: string | null;
  department_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: Profile | null;
}

// ============================================================
// FINANCE
// ============================================================

export type FinanceAccountKey = 'equity' | 'bank_of_kigali' | 'im_bank' | 'momo';

export interface FinanceAccount {
  id: string;
  key: FinanceAccountKey;
  name: string;
  bank_name: string | null;
  purpose: string;
  opening_balance: number;
  opening_date: string;
  created_at: string;
}

export type FinanceTransactionType =
  | 'revenue'
  | 'fleet_collection'
  | 'vehicle_owner_payment'
  | 'payroll'
  | 'supplier_payment'
  | 'transfer'
  | 'expense_claim'
  | 'other'
  | 'onboarding_fee'
  | 'management_margin';

export type FinanceDirection = 'in' | 'out';
export type FinanceTransactionStatus = 'pending' | 'checked' | 'approved' | 'posted' | 'rejected';

export interface FinanceTransaction {
  id: string;
  reference: string;
  type: FinanceTransactionType;
  account_id: string;
  direction: FinanceDirection;
  amount: number;
  transaction_date: string;
  description: string | null;
  counterparty: string | null;
  linked_vehicle_id: string | null;
  linked_driver_id: string | null;
  transfer_group_id: string | null;
  status: FinanceTransactionStatus;
  prepared_by: string | null;
  checked_by: string | null;
  approved_by: string | null;
  checked_at: string | null;
  approved_at: string | null;
  supporting_document_id: string | null;
  system_generated: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  account?: FinanceAccount | null;
  linked_vehicle?: Vehicle | null;
  linked_driver?: Driver | null;
  preparer?: Profile | null;
  checker?: Profile | null;
  approver?: Profile | null;
  supporting_document?: Document | null;
}

export interface FinanceReconciliation {
  id: string;
  account_id: string;
  period: string;
  statement_balance: number;
  system_balance: number;
  variance: number;
  notes: string | null;
  reconciled_by: string | null;
  reconciled_at: string;
  account?: FinanceAccount | null;
  reconciler?: Profile | null;
}

export type PayrollRunStatus = 'draft' | 'checked' | 'approved' | 'paid';

export interface PayrollRun {
  id: string;
  period: string;
  status: PayrollRunStatus;
  total_amount: number;
  prepared_by: string | null;
  checked_by: string | null;
  approved_by: string | null;
  finance_transaction_id: string | null;
  created_at: string;
  updated_at: string;
  lines?: PayrollLine[];
}

export interface PayrollLine {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  gross_amount: number;
  deductions: number;
  net_amount: number;
  created_at: string;
  employee?: Profile | null;
}
