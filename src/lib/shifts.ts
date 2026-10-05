import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

// Call Center shifts: three a day, teams of two, two shared computers.
// An agent starts a shift on sign-in and must end it (with a shift
// report) before signing out.

export type ShiftSlot = 'morning' | 'afternoon' | 'night';

export const SLOTS: { key: ShiftSlot; label: string; hours: string }[] = [
  { key: 'morning', label: 'Morning', hours: '06:00–14:00' },
  { key: 'afternoon', label: 'Afternoon', hours: '14:00–22:00' },
  { key: 'night', label: 'Night', hours: '22:00–06:00' },
];
export const SLOT_LABEL: Record<ShiftSlot, string> = { morning: 'Morning 06:00–14:00', afternoon: 'Afternoon 14:00–22:00', night: 'Night 22:00–06:00' };
export const STATIONS = ['Computer 1', 'Computer 2'];

// The shift running now - or the next one if it starts within the hour
// (an agent arriving 05:30 is on the morning shift; one signing in at
// 10:45 is on the morning shift too, just late).
export function suggestSlot(now = new Date()): ShiftSlot {
  const mins = (now.getHours() * 60 + now.getMinutes() + 60) % 1440;
  if (mins >= 360 && mins < 840) return 'morning';
  if (mins >= 840 && mins < 1320) return 'afternoon';
  return 'night';
}

export interface ShiftReport {
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
  open_cases_at_end: number;
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
