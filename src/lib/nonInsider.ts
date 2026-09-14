import { useEffect, useState, useCallback } from 'react';
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
      .channel('platform-fleet-feed')
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
