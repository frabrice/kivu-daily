import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Money received from someone not (yet) in Kivu Daily as a driver on a car
// (MD, 27 Nov 2026 - table other_money_received). Recorded from the Deposits
// page or while making the PDF report, and kept, so every report counts it
// on the day it was received.

export interface OtherMoney {
  id: string;
  payer_name: string;
  amount: number;
  received_on: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  author?: { full_name: string } | null;
}

export const OTHER_MONEY_SELECT = '*, author:profiles!other_money_received_created_by_fkey(full_name)';
// How far back the report's "Money received, not yet in the system" list goes.
export const OTHER_MONEY_REPORT_DAYS = 7;

export interface NewOtherMoney { payer_name: string; amount: number; received_on: string; reason: string }

export async function saveOtherMoney(rows: NewOtherMoney[]): Promise<string | null> {
  if (!rows.length) return null;
  const { error } = await supabase.from('other_money_received').insert(rows.map((r) => ({
    payer_name: r.payer_name.trim(), amount: r.amount, received_on: r.received_on, reason: r.reason.trim() || null,
  })));
  return error ? error.message : null;
}

export async function deleteOtherMoney(id: string): Promise<string | null> {
  const { error, count } = await supabase.from('other_money_received').delete({ count: 'exact' }).eq('id', id);
  if (error) return error.message;
  return count === 0 ? 'Only the person who recorded it (on the same day) or the MD can remove it.' : null;
}

// Can this person remove this entry? Mirrors the database rule.
export const canRemoveOtherMoney = (m: OtherMoney, profileId: string | undefined, isMd: boolean) =>
  isMd || (!!profileId && m.created_by === profileId && Date.now() - new Date(m.created_at).getTime() < 86400_000);

let seq = 0;
export function useOtherMoney() {
  const [items, setItems] = useState<OtherMoney[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from('other_money_received').select(OTHER_MONEY_SELECT)
      .order('received_on', { ascending: false }).order('created_at', { ascending: false }).limit(500);
    setItems((data as OtherMoney[] | null) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`other-money-${++seq}`).on('postgres_changes', { event: '*', schema: 'public', table: 'other_money_received' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { items, loading, reload: load };
}
