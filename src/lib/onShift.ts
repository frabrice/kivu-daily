import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { DEFAULT_HOURS, DriverState, Expected, LogEntry, ShiftHours, ShiftKey } from '../../supabase/functions/_shared/onShift';

export * from '../../supabase/functions/_shared/onShift';

// Ours On Shift (migrations 20261030100000/110000): who should be driving
// (worked out on the server every 2 minutes) and their state in the app.

export interface RosterRow {
  key: string; kind: 'driver' | 'freelancer'; driver_id: string | null; freelancer_id: string | null; name: string; phone: string | null; plate: string | null;
  vehicle_id: string | null; shift: ShiftKey; day: string; starts_at: string; ends_at: string; blocked: string | null; computed_at: string;
}
export interface SyncState { last_run_at: string | null; last_ok_at: string | null; last_error: string | null }

export const APP_STATUS: Record<string, string> = { online: 'Online', busy: 'On a trip', break: 'On a break', offline: 'Offline' };

let seq = 0;
export function useOnShift() {
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [states, setStates] = useState<DriverState[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [hours, setHours] = useState<ShiftHours>(DEFAULT_HOURS);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    const [r, s, h, st] = await Promise.all([
      supabase.from('driver_shift_roster').select('*').order('starts_at'),
      supabase.from('platform_driver_status').select('platform_driver_id, kivu_driver_id, freelancer_id, is_online, driver_status, logged_in, last_seen_at, last_location_at, status_since, app_version, vehicle_plate').or('kivu_driver_id.not.is.null,freelancer_id.not.is.null'),
      supabase.from('fleet_shift_hours').select('shift, starts, ends'),
      supabase.from('platform_sync_state').select('last_run_at, last_ok_at, last_error').eq('key', 'drivers').maybeSingle(),
    ]);
    const rows = (r.data as RosterRow[]) ?? [];
    setRoster(rows);
    setStates((s.data as DriverState[]) ?? []);
    const next: ShiftHours = { day: { ...DEFAULT_HOURS.day }, night: { ...DEFAULT_HOURS.night } };
    for (const x of (h.data ?? []) as { shift: ShiftKey; starts: string; ends: string }[]) next[x.shift] = { starts: x.starts.slice(0, 5), ends: x.ends.slice(0, 5) };
    setHours(next);
    setSync((st.data as SyncState | null) ?? null);
    // Online/offline changes since a day before the earliest shift shown (to know the state when it started).
    const from = rows.length ? new Date(Math.min(...rows.map((x) => Date.parse(x.starts_at))) - 86400000).toISOString() : new Date(Date.now() - 2 * 86400000).toISOString();
    const lg = await supabase.from('driver_online_log').select('platform_driver_id, is_online, at').gte('at', from).order('at').limit(5000);
    setLog((lg.data as LogEntry[]) ?? []);
    setNow(Date.now());
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`on-shift-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_driver_status' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_shift_roster' }, () => load())
      .subscribe();
    // "Offline for 12 min" keeps counting between syncs.
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { supabase.removeChannel(ch); window.clearInterval(t); };
  }, [load]);
  // Ask the server to read the app now (instead of waiting up to 2 minutes).
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('driver-status-sync', { body: {} });
    await load();
    return error ? error.message : (data as { error?: string } | null)?.error ?? null;
  }, [load]);
  return { roster, states, log, hours, sync, loading, now, reload: load, refresh };
}

export const toExpected = (r: RosterRow): Expected => ({
  key: r.key, kind: r.kind, driverId: r.driver_id, freelancerId: r.freelancer_id, name: r.name, phone: r.phone, plate: r.plate, vehicleId: r.vehicle_id,
  shift: r.shift, day: r.day, start: Date.parse(r.starts_at), end: Date.parse(r.ends_at), blocked: r.blocked,
});
