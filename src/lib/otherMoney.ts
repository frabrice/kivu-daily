import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Money received from someone not (yet) in Kivu Daily as a driver on a car
// (MD, 27 Nov 2026 - table other_money_received). Recorded from the Deposits
// page or while making the PDF report, and kept, so every report counts it
// on the day it was received.

export type OtherMoneyKind = 'deposit' | 'collateral';
export const KIND_LABEL: Record<OtherMoneyKind, string> = { deposit: 'Deposit', collateral: 'Collateral' };

export interface OtherMoney {
  id: string;
  kind: OtherMoneyKind;
  // Connected to the driver once they are in Kivu Daily (from the driver form).
  driver_id: string | null;
  linked_at: string | null;
  driver?: { full_name: string } | null;
  payer_name: string;
  amount: number;
  received_on: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  author?: { full_name: string } | null;
}

export const OTHER_MONEY_SELECT = '*, author:profiles!other_money_received_created_by_fkey(full_name), driver:drivers(full_name)';
// How far back the report's "Money received, not yet in the system" list goes.
export const OTHER_MONEY_REPORT_DAYS = 7;

export interface NewOtherMoney { payer_name: string; amount: number; received_on: string; reason: string; kind: OtherMoneyKind }

export async function saveOtherMoney(rows: NewOtherMoney[]): Promise<string | null> {
  if (!rows.length) return null;
  const { error } = await supabase.from('other_money_received').insert(rows.map((r) => ({
    payer_name: r.payer_name.trim(), amount: r.amount, kind: r.kind, received_on: r.received_on, reason: r.reason.trim() || null,
  })));
  return error ? error.message : null;
}

export async function deleteOtherMoney(id: string): Promise<string | null> {
  const { error, count } = await supabase.from('other_money_received').delete({ count: 'exact' }).eq('id', id);
  if (error) return error.message;
  return count === 0 ? 'Only the person who recorded it (on the same day) or the MD can remove it, and only before it is connected to a driver.' : null;
}

// Can this person remove this entry? Mirrors the database rule.
export const canRemoveOtherMoney = (m: OtherMoney, profileId: string | undefined, isMd: boolean) =>
  !m.driver_id && (isMd ||
  (!!profileId && m.created_by === profileId && Date.now() - new Date(m.created_at).getTime() < 86400_000));

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

export async function linkOtherMoney(driverId: string, ids: string[]): Promise<string | null> {
  if (!ids.length) return null;
  const { error } = await supabase.rpc('link_other_money', { p_driver: driverId, p_ids: ids });
  return error ? error.message : null;
}

export async function unlinkOtherMoney(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('unlink_other_money', { p_id: id });
  return error ? error.message : null;
}

// How well a recorded payer's name matches a driver's name: shared words
// (3+ letters, any order, any case). 0 = no match.
const words = (n: string) => n.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').split(/[^a-z]+/).filter((w) => w.length >= 3);
export function nameMatch(a: string, b: string): number {
  const wb = new Set(words(b));
  return words(a).filter((w) => wb.has(w)).length;
}
