import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  supabase, CallTicket, CallTicketCallerType, CallTicketCategory, CallTicketStatus, CallTicketUpdate, Profile,
} from './supabase';

// Call Center tickets: shared labels, the overdue rule, and the data hook
// used by both the Call Center's "Calls & Tickets" page and everyone's
// "From Call Center" page. RLS decides what each person gets back (Call
// Center and the MD see everything; anyone else sees tickets assigned to
// them now or that they handled before). Every change goes through the
// create_call_ticket / call_ticket_action RPCs - never a direct write.

export const CATEGORIES: { key: CallTicketCategory; label: string }[] = [
  { key: 'app', label: 'App problem' },
  { key: 'payment', label: 'Payment' },
  { key: 'trip', label: 'Trip' },
  { key: 'driver_behaviour', label: 'Driver behaviour' },
  { key: 'lost_item', label: 'Lost item' },
  { key: 'complaint', label: 'Complaint' },
  { key: 'other', label: 'Other' },
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<CallTicketCategory, string>;

export const CALLER_TYPES: { key: CallTicketCallerType; label: string }[] = [
  { key: 'passenger', label: 'Passenger' },
  { key: 'driver', label: 'Driver' },
  { key: 'car_owner', label: 'Car owner' },
  { key: 'partner', label: 'Partner' },
  { key: 'other', label: 'Other' },
];
export const CALLER_TYPE_LABEL = Object.fromEntries(CALLER_TYPES.map((c) => [c.key, c.label])) as Record<CallTicketCallerType, string>;

export const STATUS_META: Record<CallTicketStatus, { label: string; chip: string }> = {
  open: { label: 'Open', chip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' },
  in_progress: { label: 'In progress', chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
  waiting_on_caller: { label: 'Waiting on caller', chip: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300' },
  resolved: { label: 'Resolved', chip: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300' },
  closed: { label: 'Closed', chip: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400' },
};

export const UNRESOLVED: CallTicketStatus[] = ['open', 'in_progress', 'waiting_on_caller'];
export const isUnresolved = (t: CallTicket) => UNRESOLVED.includes(t.status);

// Overdue = still unresolved 24 hours after an urgent call, or 3 days
// after a normal one (the same rule the emails use).
export function isOverdue(t: CallTicket, now = Date.now()): boolean {
  if (!isUnresolved(t)) return false;
  const hours = (now - new Date(t.created_at).getTime()) / 3600000;
  return hours > (t.priority === 'urgent' ? 24 : 72);
}

export function ageLabel(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function dateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// "Imanariyo Baptiste (Head of IT)" - falls back to the department name.
export function personWithRole(p: Pick<Profile, 'full_name' | 'responsibility_label' | 'role'> & { department?: { name: string } | null }): string {
  const label = p.responsibility_label || (p.role === 'managing_director' ? 'Managing Director' : p.department?.name);
  return `${p.full_name.trim()}${label ? ` (${label})` : ''}`;
}

// Phone numbers are typed every which way (+250 78..., 078..., 78...);
// the last 9 digits identify a Rwandan mobile.
export function phoneKey(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '').slice(-9);
}

// Overdue first, then urgent, then oldest.
export function sortForWork(a: CallTicket, b: CallTicket): number {
  const rank = (t: CallTicket) => (isOverdue(t) ? 0 : 2) + (t.priority === 'urgent' ? 0 : 1);
  return rank(a) - rank(b) || a.created_at.localeCompare(b.created_at);
}

export type TicketPerson = Pick<Profile, 'id' | 'full_name' | 'responsibility_label' | 'role' | 'is_active'> & { department: { name: string; slug: string } | null };

export function useCallTickets() {
  const [tickets, setTickets] = useState<CallTicket[]>([]);
  const [updates, setUpdates] = useState<CallTicketUpdate[]>([]);
  const [people, setPeople] = useState<TicketPerson[]>([]);
  const [loading, setLoading] = useState(true);
  // Unique per mount: Supabase refuses a second subscribe on a channel
  // name that's already subscribed (several pages can mount this hook).
  const channelName = useRef(`call-tickets-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    const [t, u, p] = await Promise.all([
      supabase.from('call_tickets').select('*, driver:drivers(full_name, vehicle:vehicles(plate_number))').order('created_at', { ascending: false }),
      supabase.from('call_ticket_updates').select('*').order('created_at'),
      supabase.from('profiles').select('id, full_name, responsibility_label, role, is_active, department:departments(name, slug)').order('full_name'),
    ]);
    setTickets((t.data as CallTicket[]) ?? []);
    setUpdates((u.data as CallTicketUpdate[]) ?? []);
    setPeople((p.data as unknown as TicketPerson[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_tickets' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_ticket_updates' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const personName = useCallback((id: string | null | undefined) => people.find((p) => p.id === id)?.full_name.trim() ?? '—', [people]);
  const updatesFor = useCallback((ticketId: string) => updates.filter((u) => u.ticket_id === ticketId), [updates]);
  const assignable = useMemo(() => people.filter((p) => p.is_active), [people]);

  return { tickets, updates, people, assignable, loading, reload: load, personName, updatesFor };
}

// Sidebar badge: unresolved tickets assigned to me.
export function useMyOpenTicketCount(profileId: string | undefined): number {
  const [count, setCount] = useState(0);
  const channelName = useRef(`my-ticket-count-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    if (!profileId) return;
    const { count: c } = await supabase.from('call_tickets').select('id', { count: 'exact', head: true })
      .eq('assignee_id', profileId).in('status', UNRESOLVED);
    setCount(c ?? 0);
  }, [profileId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_tickets' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return count;
}

// A ticket link from an email: ?ticket=<id> (or ?page=from_call_center).
// Read once, then removed from the address bar so a refresh doesn't
// reopen it.
export function takeTicketLink(): { ticketId: string | null; page: string | null } {
  try {
    const params = new URLSearchParams(window.location.search);
    const ticketId = params.get('ticket');
    const page = params.get('page');
    if (ticketId || page) {
      params.delete('ticket');
      params.delete('page');
      const rest = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    }
    return { ticketId, page };
  } catch {
    return { ticketId: null, page: null };
  }
}
