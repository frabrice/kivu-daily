import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, PlatformDriver, PlatformCar } from './supabase';

// Non-insider drivers: live on the passenger app but their car isn't part
// of Kivu Ride's managed fleet. Kept in their own tables (not reusing
// drivers/vehicles) since these were onboarded outside the normal
// pipeline and the whole point is a driver and their car can move
// independently of each other - see the migration for the full story.
export function useNonInsiderData() {
  const [drivers, setDrivers] = useState<PlatformDriver[]>([]);
  const [cars, setCars] = useState<PlatformCar[]>([]);
  const [loading, setLoading] = useState(true);
  // Unique per mount - two pages using this hook at once must not share a channel.
  const channelName = useRef(`platform-fleet-feed-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    const [d, c] = await Promise.all([
      supabase.from('platform_drivers').select('*, car:platform_cars(*)').order('created_at', { ascending: false }),
      supabase.from('platform_cars').select('*').order('created_at', { ascending: false }),
    ]);
    setDrivers((d.data as PlatformDriver[]) ?? []);
    setCars((c.data as PlatformCar[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_drivers' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_cars' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { drivers, cars, loading, reload: load };
}

export function yesNoUnknown(v: boolean | null): 'Yes' | 'No' | 'Unknown' {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return 'Unknown';
}

// Shared by the Drivers and Vehicles filter bars - a driver's connected
// car (or a car's connected driver) means the same handful of tri-state
// survey fields (branded/allows branding/device) need filtering the
// same way on both pages.
export type TriFilter = 'all' | 'yes' | 'no' | 'unknown';

export function matchesTri(value: boolean | null, filter: TriFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'yes') return value === true;
  if (filter === 'no') return value === false;
  return value === null;
}

// Branding & Devices: cars whose owner allows branding / wants our device
// and still need the Fleet Manager's follow-up (sidebar badge).
export function useCarFollowupCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  const channelName = useRef(`car-followups-${Math.random().toString(36).slice(2)}`);
  const load = useCallback(async () => {
    if (!enabled) return;
    const { count: c } = await supabase.from('platform_cars').select('id', { count: 'exact', head: true })
      .or('branding_status.eq.to_contact,device_status.eq.to_contact');
    setCount(c ?? 0);
  }, [enabled]);
  useEffect(() => {
    load();
    if (!enabled) return;
    const channel = supabase.channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_cars' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, enabled]);
  return count;
}
