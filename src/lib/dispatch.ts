import { supabase } from './supabase';
import { edgeFunctionError } from './edgeFunctions';
import type { Tone } from '../ui/kit';

// Dispatch (migration 20261101100000, edge function `dispatch`): book a
// Kivu Ride trip for someone from Kivu Daily. See the function for how a
// booking reaches the app; this file is what the pages share.

export interface Place { address: string; lat: number; lng: number; source: 'ours' | 'map' | 'link' | 'pin' | 'gps'; detail?: string; uses?: number }
export interface NearDriver { id: number; name: string | null; plate: string | null; car: string | null; distance_km: number | null; status: string | null; rating: number | null; ours: boolean; lat: number | null; lng: number | null }
export interface TypeQuote {
  slug: string; name: string; subtitle: string | null; seats: number | null;
  fare: number | null; distance_km: number | null; duration_minutes: number | null; error: string | null;
  drivers: NearDriver[]; drivers_ok: boolean;
}
export type ForKind = 'hotline' | 'whatsapp' | 'friend_family' | 'company' | 'other';
export const FOR_KINDS: { key: ForKind; label: string }[] = [
  { key: 'hotline', label: 'Hotline caller' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'friend_family', label: 'Friend or family' },
  { key: 'company', label: 'Company client' },
  { key: 'other', label: 'Other' },
];
export const FOR_LABEL = Object.fromEntries(FOR_KINDS.map((k) => [k.key, k.label])) as Record<ForKind, string>;

export interface Dispatch {
  id: string; created_by: string; created_at: string; shift_id: string | null; for_kind: ForKind;
  client_name: string; client_phone: string; client_email: string | null;
  pickup_address: string; pickup_lat: number; pickup_lng: number; destination_address: string; destination_lat: number; destination_lng: number;
  vehicle_type: string; payment_method: 'cash' | 'mobile_money'; scheduled_pickup_time: string | null; note: string | null;
  estimated_fare: number | null; estimated_distance_km: number | null; estimated_duration_minutes: number | null; nearby_drivers: number | null;
  partner_reference: string; sandbox: boolean; status: string; error: string | null; platform_trip_id: number | null; trip_code: string | null;
  driver_name: string | null; driver_phone: string | null; driver_rating: number | null; vehicle_plate: string | null; vehicle_label: string | null; fare: number | null;
  accepted_at: string | null; started_at: string | null; completed_at: string | null; cancelled_at: string | null;
  cancelled_by: string | null; cancellation_reason: string | null; cancelled_by_profile: string | null; last_checked_at: string | null;
}

// The app's trip statuses, in the order a trip goes through them.
export const STEPS = ['requested', 'accepted', 'driver_arriving', 'driver_arrived', 'in_progress', 'driver_completed', 'completed'] as const;
export const STATUS: Record<string, { label: string; tone: Tone; hint?: string }> = {
  booking: { label: 'Sending to the app', tone: 'info' },
  unknown: { label: 'Checking with the app', tone: 'attention', hint: 'The app did not answer the booking. Kivu Daily keeps checking; do not book again yet.' },
  failed: { label: 'Not booked', tone: 'danger' },
  scheduled: { label: 'Booked for later', tone: 'info', hint: 'The app sends it to drivers shortly before the pickup time.' },
  requested: { label: 'Finding a driver', tone: 'attention', hint: 'The app is offering the trip to the nearest drivers. The first to accept takes it.' },
  accepted: { label: 'Driver on the way', tone: 'accent' },
  driver_arriving: { label: 'Driver is close', tone: 'accent' },
  driver_arrived: { label: 'Driver at the pickup', tone: 'accent', hint: 'The client gives the driver the trip code to start.' },
  in_progress: { label: 'On the trip', tone: 'accent' },
  driver_completed: { label: 'Arrived, paying', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const statusOf = (s: string) => STATUS[s] ?? { label: s.replace(/_/g, ' '), tone: 'neutral' as Tone };
export const isRunning = (d: Pick<Dispatch, 'status'>) => !['completed', 'cancelled', 'failed'].includes(d.status);
export const CANCELLED_BY: Record<string, string> = { partner: 'Kivu Daily', driver: 'the driver', passenger: 'the client', admin: 'a Kivu Ride admin', system: 'the app (no driver found)' };
export const PAY_LABEL = { cash: 'Cash', mobile_money: 'Mobile Money' } as const;

export async function callDispatch<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('dispatch', { body });
  if (error) return { ok: false, error: await edgeFunctionError(error) } as T & { ok: boolean; error?: string };
  return data as T & { ok: boolean; error?: string };
}

export const fmtRwf = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(Number(n)).toLocaleString('en-US')} RWF`);
export const localPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, '').slice(-9); return d.length === 9 ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : p ?? ''; };
export const kTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });
export const kDayTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });

// What the agent tells or sends the client: the driver, the car and the trip code.
export function clientMessage(d: Dispatch): string {
  const code = d.trip_code ? `Trip code: ${d.trip_code} (give it to the driver when you get in).` : '';
  const when = d.scheduled_pickup_time ? ` for ${kDayTime(d.scheduled_pickup_time)}` : '';
  if (d.driver_name) {
    return [
      `Kivu Ride: your driver ${d.driver_name}${d.driver_phone ? ` (${localPhone(d.driver_phone)})` : ''} is coming${d.vehicle_label || d.vehicle_plate ? ` in a ${[d.vehicle_label, d.vehicle_plate].filter(Boolean).join(', ')}` : ''}.`,
      code, `Pickup: ${d.pickup_address}. Fare about ${fmtRwf(d.fare ?? d.estimated_fare)}, paid ${d.payment_method === 'mobile_money' ? 'by Mobile Money' : 'in cash'} to the driver.`,
    ].filter(Boolean).join('\n');
  }
  return [`Kivu Ride: your ride${when} is booked, from ${d.pickup_address} to ${d.destination_address}. We are finding your driver and will send their name and car.`, code].filter(Boolean).join('\n');
}
export const whatsappLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '250')}?text=${encodeURIComponent(text)}`;
