import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, PlatformDriver } from './supabase';

// Non-Insider outreach, in rounds. The Call Center calls every Non-Insider
// driver one by one and records three answers: will they come to our office
// for the updated app (or do they have it already, and how much they use
// it), will they buy our device (120,000 RWF, one-time), will they brand
// their car (20,000 RWF, one-time, paid by the driver - they become a
// priority driver). When everyone has been reached a new round starts with
// new talking points, and everyone who hasn't come to the office yet is
// called again. Opening a driver claims them so the other computer doesn't
// call them too.

export const DEVICE_PRICE = 120000;
export const BRANDING_PRICE = 20000;
export const DAILY_GOAL = 15;
export const CLAIM_MINUTES = 15;

export type CallResult = 'reached' | 'no_answer' | 'callback' | 'wrong_number';
export type AppStatus = 'will_come' | 'has_latest' | 'not_interested';
export type AppUsage = 'daily' | 'sometimes' | 'rarely' | 'not_using';
export type Answer = 'yes' | 'thinking' | 'no';

export const RESULTS: { key: CallResult; label: string; hint: string }[] = [
  { key: 'reached', label: 'Reached', hint: 'Record their answers' },
  { key: 'no_answer', label: 'No answer / busy', hint: 'Tried again in 2 hours' },
  { key: 'callback', label: 'Call back later', hint: 'Set a date and time' },
  { key: 'wrong_number', label: 'Wrong number', hint: 'Taken off the rounds' },
];
export const RESULT_LABEL = Object.fromEntries(RESULTS.map((r) => [r.key, r.label])) as Record<CallResult, string>;

export const APP_STATUS: { key: AppStatus; label: string; short: string }[] = [
  { key: 'will_come', label: 'Will come to the office for it', short: 'Coming for it' },
  { key: 'has_latest', label: 'Already has the updated app', short: 'Has it' },
  { key: 'not_interested', label: "Doesn't want it", short: "Doesn't want it" },
];
export const APP_USAGE: { key: AppUsage; label: string }[] = [
  { key: 'daily', label: 'Every day' },
  { key: 'sometimes', label: 'Sometimes' },
  { key: 'rarely', label: 'Rarely' },
  { key: 'not_using', label: 'Not using it' },
];
export const ANSWERS: { key: Answer; label: string }[] = [
  { key: 'yes', label: 'Yes' },
  { key: 'thinking', label: 'Thinking about it' },
  { key: 'no', label: 'No' },
];
export const APP_STATUS_SHORT = Object.fromEntries(APP_STATUS.map((a) => [a.key, a.short])) as Record<AppStatus, string>;
export const APP_USAGE_LABEL = Object.fromEntries(APP_USAGE.map((a) => [a.key, a.label])) as Record<AppUsage, string>;
export const ANSWER_LABEL = Object.fromEntries(ANSWERS.map((a) => [a.key, a.label])) as Record<Answer, string>;

export interface OutreachStatus {
  platform_driver_id: string;
  app_status: AppStatus | null;
  app_usage: AppUsage | null;
  device_answer: Answer | null;
  branding_answer: Answer | null;
  usual_area: string | null;
  came_to_office_on: string | null;
  came_recorded_by: string | null;
  last_round: number | null;
  last_result: CallResult | null;
  last_called_at: string | null;
  last_agent_id: string | null;
  ever_reached: boolean;
  callback_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
}

export interface OutreachCall {
  id: string;
  platform_driver_id: string;
  agent_id: string | null;
  round: number;
  result: CallResult;
  app_status: AppStatus | null;
  app_usage: AppUsage | null;
  device_answer: Answer | null;
  branding_answer: Answer | null;
  interested: boolean;
  callback_at: string | null;
  usual_area: string | null;
  note: string | null;
  created_at: string;
}

export interface OutreachRound {
  id: string;
  number: number;
  talking_points: string | null;
  started_at: string;
  started_by: string | null;
  closed_at: string | null;
}

// Where a driver stands overall - every driver is in exactly one.
export type Category = 'came' | 'accepted' | 'thinking' | 'declined' | 'not_reached' | 'wrong_number';
export const CATEGORIES: { key: Category; label: string; hint: string }[] = [
  { key: 'accepted', label: 'Accepted — expected at office', hint: 'Said yes to the updated app, the device or branding, but hasn\'t come yet' },
  { key: 'came', label: 'Came to the office', hint: 'Done — out of the rounds' },
  { key: 'thinking', label: 'Thinking about it', hint: 'No yes yet, but not a no' },
  { key: 'declined', label: 'Said no', hint: 'Call again next round with new numbers' },
  { key: 'not_reached', label: 'Not reached yet', hint: 'Never answered, or never called' },
  { key: 'wrong_number', label: 'Wrong number', hint: 'Check the number with the Fleet Manager' },
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<Category, string>;

export function categoryOf(s: OutreachStatus | undefined): Category {
  if (!s) return 'not_reached';
  if (s.came_to_office_on) return 'came';
  if (s.last_result === 'wrong_number') return 'wrong_number';
  if (s.app_status === 'will_come' || s.device_answer === 'yes' || s.branding_answer === 'yes') return 'accepted';
  if (s.device_answer === 'thinking' || s.branding_answer === 'thinking') return 'thinking';
  if (s.ever_reached) return 'declined';
  return 'not_reached';
}

const claimActive = (s: OutreachStatus, now: number) => !!s.claimed_by && !!s.claimed_at && now - new Date(s.claimed_at).getTime() < CLAIM_MINUTES * 60000;
export const claimedByOther = (s: OutreachStatus | undefined, me: string | undefined, now = Date.now()) => !!s && claimActive(s, now) && s.claimed_by !== me;

// Same rules as next_outreach_driver() in the database.
export function doneThisRound(s: OutreachStatus | undefined, round: number): boolean {
  if (!s) return false;
  return !!s.came_to_office_on || s.last_result === 'wrong_number' || (s.last_round === round && s.last_result === 'reached');
}
export function callbackDue(s: OutreachStatus | undefined, now = Date.now()): boolean {
  return !!s && s.last_result === 'callback' && !!s.callback_at && new Date(s.callback_at).getTime() <= now + 15 * 60000 && !s.came_to_office_on;
}

export function useOutreach() {
  const [drivers, setDrivers] = useState<PlatformDriver[]>([]);
  const [statuses, setStatuses] = useState<Record<string, OutreachStatus>>({});
  const [calls, setCalls] = useState<OutreachCall[]>([]);
  const [round, setRound] = useState<OutreachRound | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const channelName = useRef(`outreach-${Math.random().toString(36).slice(2)}`);

  const loadStatuses = useCallback(async () => {
    const { data } = await supabase.from('platform_outreach_status').select('*');
    setStatuses(Object.fromEntries(((data as OutreachStatus[]) ?? []).map((s) => [s.platform_driver_id, s])));
  }, []);

  const load = useCallback(async () => {
    const [d, c, r, p] = await Promise.all([
      supabase.from('platform_drivers').select('*, car:platform_cars(*)').order('full_name'),
      supabase.from('platform_outreach_calls').select('*').order('created_at', { ascending: false }),
      supabase.from('outreach_rounds').select('*').order('number', { ascending: false }).limit(1),
      supabase.from('profiles').select('id, full_name'),
      loadStatuses(),
    ]);
    setDrivers((d.data as PlatformDriver[]) ?? []);
    setCalls((c.data as OutreachCall[]) ?? []);
    setRound(((r.data as OutreachRound[]) ?? [])[0] ?? null);
    setNames(Object.fromEntries(((p.data as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name.trim()])));
    setLoading(false);
  }, [loadStatuses]);

  useEffect(() => { load(); }, [load]);
  // Live: who is calling whom on the other computer.
  useEffect(() => {
    const ch = supabase.channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_outreach_status' }, () => loadStatuses())
      .subscribe();
    const t = setInterval(loadStatuses, 30000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [loadStatuses]);

  return { drivers, statuses, calls, round, names, loading, reload: load };
}

export const rwf = (n: number) => `${n.toLocaleString('en-US')} RWF`;
export const shortDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
