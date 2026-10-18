import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Tone } from '../ui/kit';

// Freelance drivers (migration 20261027120000): a pool of part-time drivers
// who cover a shift when a car's driver didn't pay or left - they rent the
// car for the shift with a 30,000 target and keep what they make above it.

export interface Freelancer { id: string; full_name: string; phone: string; id_number: string | null; licence_number: string | null; status: 'available' | 'busy' | 'inactive'; notes: string | null; created_at: string }
export interface FreelanceShift {
  id: string; day: string; vehicle_id: string; shift: 'day' | 'night' | 'full'; freelancer_id: string; covering_driver_id: string | null; target: number;
  paid_amount: number | null; status: 'planned' | 'paid' | 'short' | 'no_show' | 'cancelled'; payment_method: 'momo' | 'cash' | 'bank' | null;
  confirmed_by: string | null; confirmed_at: string | null; note: string | null; recorded_by: string | null; created_at: string;
}
export const FREELANCE_TARGET = 30000;
export const SHIFT_LABEL: Record<FreelanceShift['shift'], string> = { day: 'Day', night: 'Night', full: 'Day & night' };
export const SHIFT_STATUS: Record<FreelanceShift['status'], { label: string; tone: Tone }> = {
  planned: { label: 'On the road', tone: 'info' }, paid: { label: 'Paid', tone: 'success' }, short: { label: 'Paid short', tone: 'attention' },
  no_show: { label: 'No show', tone: 'danger' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const FREELANCER_STATUS: Record<Freelancer['status'], { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'success' }, busy: { label: 'On a shift', tone: 'info' }, inactive: { label: 'Inactive', tone: 'neutral' },
};

let seq = 0;
export function useFreelance(days = 120) {
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [shifts, setShifts] = useState<FreelanceShift[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const [f, s] = await Promise.all([
      supabase.from('freelance_drivers').select('*').order('full_name'),
      supabase.from('freelance_shifts').select('*').gte('day', since).order('day', { ascending: false }),
    ]);
    setFreelancers((f.data as Freelancer[]) ?? []);
    setShifts((s.data as FreelanceShift[]) ?? []);
    setLoading(false);
  }, [days]);
  useEffect(() => {
    load();
    const ch = supabase.channel(`freelance-${++seq}`).on('postgres_changes', { event: '*', schema: 'public', table: 'freelance_shifts' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { freelancers, shifts, loading, reload: load };
}
export type FreelanceData = ReturnType<typeof useFreelance>;
