import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import type { Tone } from '../ui/kit';

// KivuRide platform trips, copied into platform_trips by the trips-sync
// edge function every 2 minutes (see migration 20261016110000).

export interface PlatformTrip {
  id: number; status: string; created_at: string | null; requested_at: string | null; accepted_at: string | null;
  started_at: string | null; completed_at: string | null; cancelled_at: string | null;
  is_scheduled: boolean; scheduled_pickup_time: string | null; vehicle_type: string | null; passenger_count: number | null;
  pickup_address: string | null; pickup_lat: number | null; pickup_lng: number | null;
  destination_address: string | null; destination_lat: number | null; destination_lng: number | null;
  rider_kind: string | null; rider_name: string | null; rider_phone: string | null;
  platform_driver_id: number | null; driver_name: string | null; driver_phone: string | null; driver_rating: number | null;
  vehicle_plate: string | null; vehicle_label: string | null; kivu_driver_id: string | null; kivu_vehicle_id: string | null;
  dispatch_method: string | null; rejected_driver_count: number;
  estimated_distance_km: number | null; actual_distance_km: number | null; estimated_duration_minutes: number | null; actual_duration_minutes: number | null;
  base_fare: number | null; distance_fare: number | null; time_fare: number | null; surge_multiplier: number | null;
  waiting_minutes: number | null; waiting_fee: number | null; extras_total: number | null; total_fare: number | null;
  payment_method: string | null; payment_status: string | null;
  rider_rating: number | null; driver_rating_of_rider: number | null; rider_feedback: string | null; driver_feedback: string | null;
  fraud_flag: boolean; code_verified: boolean; distance_source: string | null; telemetry_status: string | null;
  synced_at: string; status_changed_at: string;
}
export interface SyncState { last_run_at: string | null; last_ok_at: string | null; last_full_at: string | null; last_error: string | null; last_changed: number | null; platform_total: number | null }

const LIST_COLUMNS = 'id, status, created_at, requested_at, accepted_at, started_at, completed_at, cancelled_at, is_scheduled, scheduled_pickup_time, vehicle_type, passenger_count, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, rider_kind, rider_name, rider_phone, platform_driver_id, driver_name, driver_phone, driver_rating, vehicle_plate, vehicle_label, kivu_driver_id, kivu_vehicle_id, dispatch_method, rejected_driver_count, estimated_distance_km, actual_distance_km, estimated_duration_minutes, actual_duration_minutes, base_fare, distance_fare, time_fare, surge_multiplier, waiting_minutes, waiting_fee, extras_total, total_fare, payment_method, payment_status, rider_rating, driver_rating_of_rider, rider_feedback, driver_feedback, fraud_flag, code_verified, distance_source, telemetry_status, synced_at, status_changed_at';

export const FINAL_STATUSES = ['completed', 'cancelled'];
export const TRIP_STATUS: Record<string, { label: string; tone: Tone; order: number }> = {
  requested: { label: 'Searching for a driver', tone: 'attention', order: 0 },
  scheduled: { label: 'Scheduled', tone: 'info', order: 1 },
  accepted: { label: 'Driver on the way', tone: 'accent', order: 2 },
  driver_arriving: { label: 'Driver arriving', tone: 'accent', order: 3 },
  driver_arrived: { label: 'Driver at pickup', tone: 'accent', order: 4 },
  in_progress: { label: 'In ride', tone: 'done', order: 5 },
  driver_completed: { label: 'Arrived · awaiting payment', tone: 'attention', order: 6 },
  completed: { label: 'Completed', tone: 'success', order: 7 },
  cancelled: { label: 'Cancelled', tone: 'danger', order: 8 },
};
export const statusOf = (s: string) => TRIP_STATUS[s] ?? { label: s.replace(/_/g, ' '), tone: 'neutral' as Tone, order: 9 };
export const DISPATCH_LABEL: Record<string, string> = { app: 'Rider app', driver_initiated: 'Driver started it', manual: 'Manual dispatch' };
export const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', mobile_money: 'Mobile Money' };

// "3496+QJ7, KG 303 St, Kigali, Rwanda" -> "KG 303 St, Kigali"
export function shortAddress(a: string | null | undefined) {
  if (!a) return '—';
  const s = a.replace(/^[A-Z0-9]{4,}\+[A-Z0-9]{2,},?\s*/i, '').replace(/,?\s*Rwanda$/i, '').trim();
  return s || a;
}
export const minutesBetween = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);
export const kigaliDayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' }) : '');
export const kigaliTime = (iso: string | null, withDay = true) => (iso ? new Date(iso).toLocaleString('en-GB', {
  timeZone: 'Africa/Kigali', ...(withDay ? { day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit',
}) : '—');
export const mapsRoute = (t: PlatformTrip) => (t.pickup_lat && t.destination_lat
  ? `https://www.google.com/maps/dir/?api=1&origin=${t.pickup_lat},${t.pickup_lng}&destination=${t.destination_lat},${t.destination_lng}`
  : null);

let seq = 0;
// Trips created from `fromDay` (Kigali date; null = all), live: the page
// refreshes itself whenever the sync writes a change.
export function useTrips(fromDay: string | null) {
  const [trips, setTrips] = useState<PlatformTrip[]>([]);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    const from = fromDay ? new Date(`${fromDay}T00:00:00+02:00`).toISOString() : null;
    const [t, s] = await Promise.all([
      fetchAll<PlatformTrip>(() => {
        let q = supabase.from('platform_trips').select(LIST_COLUMNS).order('created_at', { ascending: false }).order('id', { ascending: false });
        if (from) q = q.gte('created_at', from);
        return q;
      }),
      supabase.from('platform_sync_state').select('*').eq('key', 'trips').maybeSingle(),
    ]);
    if (t.error) setError(t.error.message); else { setError(''); setTrips(t.data ?? []); }
    setSync((s.data as SyncState | null) ?? null);
    setLoading(false);
  }, [fromDay]);
  useEffect(() => {
    setLoading(true);
    load();
    const ch = supabase.channel(`platform-trips-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_trips' }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(load, 1500); // a sync writes many rows at once
      })
      .subscribe();
    const poll = setInterval(load, 60_000); // keeps the "last synced" line fresh
    return () => { supabase.removeChannel(ch); clearInterval(poll); if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  const syncNow = useCallback(async (full = false) => {
    const { data, error: err } = await supabase.functions.invoke('trips-sync', { body: { full } });
    await load();
    if (err) return err.message;
    return (data as { error?: string } | null)?.error ?? null;
  }, [load]);
  return { trips, sync, loading, error, reload: load, syncNow };
}

export async function loadTripDetail(id: number) {
  const [t, log] = await Promise.all([
    supabase.from('platform_trips').select('raw').eq('id', id).maybeSingle(),
    supabase.from('platform_trip_status_log').select('status, seen_at').eq('trip_id', id).order('seen_at'),
  ]);
  return { raw: (t.data?.raw ?? null) as Record<string, unknown> | null, log: (log.data ?? []) as { status: string; seen_at: string }[] };
}
