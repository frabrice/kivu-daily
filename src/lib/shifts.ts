import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { kigaliHour } from './kigali';

// Call Center shifts: three a day, teams of two, two shared computers.
// An agent starts a shift on sign-in and must end it (with a shift
// report) before signing out.

export type ShiftSlot = 'morning' | 'afternoon' | 'night';

export const SLOTS: { key: ShiftSlot; label: string; hours: string }[] = [
  { key: 'morning', label: 'Morning', hours: '07:00–15:00' },
  { key: 'afternoon', label: 'Afternoon', hours: '15:00–23:00' },
  { key: 'night', label: 'Night', hours: '23:00–07:00' },
];
export const SLOT_LABEL: Record<ShiftSlot, string> = { morning: 'Morning 07:00–15:00', afternoon: 'Afternoon 15:00–23:00', night: 'Night 23:00–07:00' };
export const STATIONS = ['Computer 1', 'Computer 2'];

// The shift is set by the Kigali time it starts, never picked by hand (MD,
// 31 Oct 2026: agents kept picking the wrong one). Same rule as
// shift_slot_at() in the database: from 2 hours before a shift's start it
// is that shift (13:15 = afternoon, early); after that, the running shift,
// late (11:00 = morning, 4 hours late).
export function suggestSlot(now = new Date()): ShiftSlot {
  const mins = kigaliHour(now) * 60 + now.getUTCMinutes();
  if (mins >= 300 && mins < 780) return 'morning';
  if (mins >= 780 && mins < 1260) return 'afternoon';
  return 'night';
}

// Calls by type, reported when ending a shift. calls_received / calls_made
// are the totals (the server adds them up).
export const INCOMING_TYPES = [
  { key: 'in_passengers', label: 'Passengers' },
  { key: 'in_drivers', label: 'Our drivers' },
  { key: 'in_noninsider', label: 'Non-Insider drivers' },
  { key: 'in_partners', label: 'Owners & partners' },
  { key: 'in_other', label: 'Other' },
] as const;
export const OUTGOING_TYPES = [
  { key: 'out_drivers', label: 'To our drivers' },
  { key: 'out_noninsider', label: 'To Non-Insider drivers' },
  { key: 'out_callbacks', label: 'Call-backs to passengers' },
  { key: 'out_other', label: 'Other' },
] as const;
export type CallCountKey = (typeof INCOMING_TYPES)[number]['key'] | (typeof OUTGOING_TYPES)[number]['key'];

export interface ShiftReport extends Partial<Record<CallCountKey, number>> {
  calls_received: number;
  calls_made: number;
  calls_missed: number;
  messages_handled: number;
  worked_on: string;
  resolved_summary: string;
  unresolved_summary: string;
  problems: string;
  feedback: string;
  suggestions: string;
}

export interface ShiftStats {
  minutes: number;
  contacts_logged: number;
  solved_on_call: number;
  handed_on: number;
  emergencies: number;
  bookings: number;
  abusive: number;
  cases_closed: number;
  notes_added: number;
  driver_calls: number;
  outreach_calls: number;
  outreach_interested: number;
  open_cases_at_end: number;
  dispatches?: number;
  // Calls after trips and commission follow-up (migration 20261101170000).
  trip_calls?: number;
  trip_calls_reached?: number;
  branding_yes?: number;
  commission_calls?: number;
  commission_collected?: number;
  commission_promised?: number;
  commission_reminded?: number;
}

export interface CallCenterShift {
  id: string;
  agent_id: string;
  partner_id: string | null;
  station: string;
  slot: ShiftSlot;
  started_at: string;
  ended_at: string | null;
  status: 'open' | 'closed' | 'auto_closed';
  late_minutes: number;
  report: Partial<ShiftReport>;
  stats: Partial<ShiftStats>;
  handover_id: string | null;
  created_at: string;
}

export function useMyOpenShift(profileId: string | undefined, enabled: boolean) {
  const [shift, setShift] = useState<CallCenterShift | null>(null);
  const [loading, setLoading] = useState(enabled);
  const channelName = useRef(`my-shift-${Math.random().toString(36).slice(2)}`);
  const load = useCallback(async () => {
    if (!enabled || !profileId) { setLoading(false); return; }
    const { data } = await supabase.from('call_center_shifts').select('*').eq('agent_id', profileId).eq('status', 'open').maybeSingle();
    setShift((data as CallCenterShift | null) ?? null);
    setLoading(false);
  }, [profileId, enabled]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!enabled || !profileId) return;
    const ch = supabase.channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_center_shifts', filter: `agent_id=eq.${profileId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, enabled, profileId]);
  return { shift, loading, reload: load };
}

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
