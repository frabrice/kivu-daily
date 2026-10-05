import { useCallback, useEffect, useState } from 'react';
import { supabase, PlatformDriver } from './supabase';

// Non-Insider outreach: in quiet time, Call Center agents call Non-Insider
// drivers about the app's new features, our device (120,000 RWF, one-time)
// and branding (20,000 RWF, one-time, paid by the driver - who then becomes
// a priority driver). Every call is logged; interest goes to the Fleet
// Manager's Branding & Devices list.

export const DEVICE_PRICE = 120000;
export const BRANDING_PRICE = 20000;
export const DAILY_GOAL = 15;

export type OutreachOutcome =
  | 'interested_device' | 'interested_branding' | 'interested_both' | 'callback'
  | 'not_interested' | 'no_answer' | 'wrong_number' | 'already_done';

export const OUTCOMES: { key: OutreachOutcome; label: string; hint: string; tone: 'good' | 'neutral' | 'bad' }[] = [
  { key: 'interested_device', label: 'Interested in device', hint: 'Goes to the Fleet Manager', tone: 'good' },
  { key: 'interested_branding', label: 'Interested in branding', hint: 'Goes to the Fleet Manager', tone: 'good' },
  { key: 'interested_both', label: 'Interested in both', hint: 'Goes to the Fleet Manager', tone: 'good' },
  { key: 'callback', label: 'Call back later', hint: 'Set a date and time', tone: 'neutral' },
  { key: 'no_answer', label: 'No answer / busy', hint: 'Back in the queue tomorrow', tone: 'neutral' },
  { key: 'not_interested', label: 'Not interested', hint: 'Not called again for 30 days', tone: 'bad' },
  { key: 'already_done', label: 'Already has both', hint: 'Branded and has the device', tone: 'neutral' },
  { key: 'wrong_number', label: 'Wrong number', hint: 'Tell the Fleet Manager', tone: 'bad' },
];
export const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label])) as Record<OutreachOutcome, string>;

export const ONLINE_STATUS: { key: 'online_daily' | 'sometimes' | 'rarely'; label: string }[] = [
  { key: 'online_daily', label: 'Online every day' },
  { key: 'sometimes', label: 'Sometimes' },
  { key: 'rarely', label: 'Rarely' },
];

export interface OutreachCall {
  id: string;
  platform_driver_id: string;
  car_id: string | null;
  agent_id: string | null;
  outcome: OutreachOutcome;
  callback_at: string | null;
  online_status: 'online_daily' | 'sometimes' | 'rarely' | null;
  usual_area: string | null;
  note: string | null;
  created_at: string;
}

export type QueueBucket = 'callback_due' | 'never' | 'retry' | 'later' | 'done';
export const BUCKET_LABEL: Record<QueueBucket, string> = {
  callback_due: 'Call-backs due',
  never: 'Not called yet',
  retry: 'Try again',
  later: 'Call-back later',
  done: 'Done',
};

const DAY = 86400000;

// Where a driver sits in the queue, from their last outreach call.
export function bucketFor(d: PlatformDriver, last: OutreachCall | undefined, now = Date.now()): QueueBucket {
  const car = d.car;
  const hasBoth = (car?.is_branded || car?.branding_status === 'branded') && car?.device_status === 'installed';
  if (!last) return hasBoth ? 'done' : 'never';
  const age = now - new Date(last.created_at).getTime();
  switch (last.outcome) {
    case 'callback':
      return last.callback_at && new Date(last.callback_at).getTime() <= now + 30 * 60000 ? 'callback_due' : 'later';
    case 'no_answer':
      return age >= DAY * 0.75 ? 'retry' : 'done';
    case 'not_interested':
      return age >= 30 * DAY ? 'retry' : 'done';
    default:
      return 'done';
  }
}

export function useOutreach() {
  const [drivers, setDrivers] = useState<PlatformDriver[]>([]);
  const [calls, setCalls] = useState<OutreachCall[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const [d, c] = await Promise.all([
      supabase.from('platform_drivers').select('*, car:platform_cars(*)').order('full_name'),
      supabase.from('platform_outreach_calls').select('*').order('created_at', { ascending: false }),
    ]);
    setDrivers((d.data as PlatformDriver[]) ?? []);
    setCalls((c.data as OutreachCall[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { drivers, calls, loading, reload: load };
}

export const rwf = (n: number) => `${n.toLocaleString('en-US')} RWF`;
