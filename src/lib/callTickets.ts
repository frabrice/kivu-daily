import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  supabase, CallTicket, CallTicketCallerType, CallTicketCategory, CallTicketChannel, CallTicketStatus, CallTicketUpdate, Profile, ScriptCard,
} from './supabase';

// Call Center tickets: shared labels, the overdue rule, and the data hook
// used by both the Call Center's "Calls & Tickets" page and everyone's
// "From Call Center" page. RLS decides what each person gets back (Call
// Center and the MD see everything; anyone else sees tickets assigned to
// them now or that they handled before). Every change goes through the
// create_call_ticket / call_ticket_action RPCs - never a direct write.

// Ticket categories are the Script Book's sections. The original seven
// categories stay labelled so older tickets still read correctly.
export const CATEGORIES: { key: CallTicketCategory; label: string }[] = [
  { key: 'booking', label: 'Booking & dispatch' },
  { key: 'fares_payments', label: 'Fares & payments' },
  { key: 'before_pickup', label: 'Before pickup' },
  { key: 'during_trip', label: 'During the trip' },
  { key: 'lost_property', label: 'Lost property' },
  { key: 'complaint', label: 'Complaint' },
  { key: 'emergency', label: 'Emergency & safety' },
  { key: 'driver_support', label: 'Driver support' },
  { key: 'fleet_partner', label: 'Fleet owner / partner' },
  { key: 'smart_account', label: 'Smart Account' },
  { key: 'general', label: 'General enquiry' },
];
export const CATEGORY_LABEL: Record<CallTicketCategory, string> = {
  ...(Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<CallTicketCategory, string>),
  app: 'App problem', payment: 'Payment', trip: 'Trip', driver_behaviour: 'Driver behaviour', lost_item: 'Lost item', other: 'Other',
};

export const CALLER_TYPES: { key: CallTicketCallerType; label: string }[] = [
  { key: 'passenger', label: 'Passenger' },
  { key: 'driver', label: 'Driver' },
  { key: 'car_owner', label: 'Fleet owner / partner' },
  { key: 'smart_account', label: 'Smart Account member' },
  { key: 'prospective_driver', label: 'Prospective driver' },
  { key: 'organization', label: 'Organisation / hotel' },
  { key: 'government_media', label: 'Government / media' },
  { key: 'other', label: 'Other' },
];
export const CALLER_TYPE_LABEL: Record<CallTicketCallerType, string> = {
  ...(Object.fromEntries(CALLER_TYPES.map((c) => [c.key, c.label])) as Record<CallTicketCallerType, string>),
  partner: 'Partner',
};

export const CHANNELS: { key: CallTicketChannel; label: string }[] = [
  { key: 'call', label: 'Call' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'sms', label: 'SMS' },
  { key: 'web', label: 'Website' },
];

// The Script Book's status words (section 13A). 'Resolved' here means the
// owner has finished; the Call Center then informs the caller and closes.
export const STATUS_META: Record<CallTicketStatus, { label: string; chip: string }> = {
  open: { label: 'Assigned', chip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' },
  in_progress: { label: 'In progress', chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
  waiting_on_caller: { label: 'Pending', chip: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300' },
  resolved: { label: 'Resolved', chip: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300' },
  closed: { label: 'Closed', chip: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400' },
};

export const UNRESOLVED: CallTicketStatus[] = ['open', 'in_progress', 'waiting_on_caller'];
export const isUnresolved = (t: CallTicket) => UNRESOLVED.includes(t.status);

// Resolution target: still unresolved 24 hours after an urgent or
// emergency call, or 3 days after a normal one (same rule as the emails).
export function isOverdue(t: CallTicket, now = Date.now()): boolean {
  if (!isUnresolved(t)) return false;
  const hours = (now - new Date(t.created_at).getTime()) / 3600000;
  return hours > (t.priority === 'normal' ? 72 : 24);
}

// The Script Book's two-hour standard: the owner hasn't acted at all yet.
export function isResponseOverdue(t: CallTicket, now = Date.now()): boolean {
  if (!isUnresolved(t) || t.first_response_at || t.priority === 'emergency') return false;
  return now - new Date(t.assigned_at ?? t.created_at).getTime() > 2 * 3600000;
}

export const needsMdAck = (t: CallTicket) => t.priority === 'emergency' && !t.md_acknowledged_at && t.status !== 'closed';

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
// Emergencies first, then no response yet, then past target, then urgent,
// then oldest. A promised call-back that's due also jumps up.
export function sortForWork(a: CallTicket, b: CallTicket): number {
  const now = Date.now();
  const rank = (t: CallTicket) =>
    t.priority === 'emergency' ? 0
      : t.callback_at && new Date(t.callback_at).getTime() <= now ? 1
        : isResponseOverdue(t, now) ? 2
          : isOverdue(t, now) ? 3
            : t.priority === 'urgent' ? 4 : 5;
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
      supabase.from('call_tickets').select('*, driver:drivers(full_name, vehicle:vehicles(plate_number)), platform_driver:platform_drivers(full_name, phone)').order('created_at', { ascending: false }),
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

// The Script Book cards (approved ones for agents; the MD sees drafts too).
export function useScriptCards() {
  const [cards, setCards] = useState<ScriptCard[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from('script_cards').select('*').order('section_order').order('card_order');
    setCards((data as ScriptCard[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { cards, loading, reload: load };
}

// Department duties (route_it, fleet_manager...) -> who currently holds them,
// so picking a Script Book situation pre-selects the right person.
export function useDuties() {
  const [duties, setDuties] = useState<Record<string, { label: string; profile_id: string | null }>>({});
  useEffect(() => {
    supabase.from('responsibilities').select('key, label, profile_id').then(({ data }) => {
      const map: Record<string, { label: string; profile_id: string | null }> = {};
      for (const r of (data as { key: string; label: string; profile_id: string | null }[]) ?? []) map[r.key] = { label: r.label, profile_id: r.profile_id };
      setDuties(map);
    });
  }, []);
  return duties;
}

export const SATISFACTION: { key: 'happy' | 'neutral' | 'unhappy'; label: string }[] = [
  { key: 'happy', label: 'Happy' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'unhappy', label: 'Unhappy' },
];

export const OUTCOME_LABEL: Record<string, string> = {
  booking_dispatched: 'Booking dispatched',
  booking_declined_wait: 'Passenger declined the wait',
  booking_no_driver: 'No driver available',
  abusive_ended: 'Call ended — abusive',
  info_given: 'Information given',
};
