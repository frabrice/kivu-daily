import { useEffect, useState, useCallback } from 'react';
import { supabase, Campaign, Contact, ContactStage } from './supabase';

export function useMarketingData() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, k] = await Promise.all([
      supabase.from('campaigns').select('*, owner:profiles(*)').order('created_at', { ascending: false }),
      supabase.from('contacts').select('*').order('created_at', { ascending: false }),
    ]);
    setCampaigns((c.data as Campaign[]) ?? []);
    setContacts((k.data as Contact[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('crm-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { campaigns, contacts, loading, reload: load };
}

export const STAGES: { key: ContactStage; label: string; color: string }[] = [
  { key: 'not_contacted', label: 'Not Contacted', color: '#9ca3af' },
  { key: 'contacted', label: 'Contacted', color: '#2F8C86' },
  { key: 'negotiating', label: 'Negotiating', color: '#f97316' },
  { key: 'won', label: 'Won', color: '#4F7B3E' },
  { key: 'lost', label: 'Lost', color: '#ef4444' },
];
