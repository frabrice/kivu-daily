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

export type DriverStage = 'applying' | 'training' | 'active' | 'waiting' | 'flagged' | 'inactive';
export type RuraLicenseStatus = 'pending' | 'provided';
export type DriverShift = 'day' | 'night';

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
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  join_date: string | null;
  initial_deposit_paid: boolean;
  stage: DriverStage;
  notes: string | null;
  vehicle_id: string | null;
  shift: DriverShift | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  vehicle?: Vehicle | null;
}

export interface DriverDeposit {
  id: string;
  driver_id: string;
  amount: number;
  paid_date: string;
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

export interface Document {
  id: string;
  uploader_id: string;
  department_id: string | null;
  title: string;
  description: string | null;
  file_url: string;
  category: string | null;
  created_at: string;
  uploader?: Profile | null;
  department?: Department | null;
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
  feature_id: string;
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
