import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase, Product, Milestone, Feature, UserStory, Profile } from './supabase';

export function useITHubData() {
  const [products, setProducts] = useState<Product[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [stories, setStories] = useState<UserStory[]>([]);
  const [itProfiles, setItProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, m, f, s, pr] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('milestones').select('*').order('created_at', { ascending: true }),
      supabase.from('features').select('*').order('created_at', { ascending: true }),
      supabase.from('user_stories').select('*, assignee:profiles!user_stories_assignee_id_fkey(*), product:products(*)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*, department:departments(*)').eq('is_active', true),
    ]);
    setProducts((p.data as Product[]) ?? []);
    setMilestones((m.data as Milestone[]) ?? []);
    setFeatures((f.data as Feature[]) ?? []);
    setStories((s.data as UserStory[]) ?? []);
    setItProfiles(((pr.data as Profile[]) ?? []).filter((x) => x.department?.slug === 'it' || x.role === 'managing_director'));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('it-hub-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'features' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_stories' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const flagInboxFeature = useMemo(() => features.find((f) => f.is_flag_inbox) ?? null, [features]);
  const issuesFeatureId = flagInboxFeature?.id ?? null;

  // The flag inbox feature still needs to live under a milestone/product to
  // satisfy the schema's FK chain, but issues are meant to read as a flat
  // list, not something you drill into via Products - so that seed product
  // never shows up in the normal Products grid.
  const hiddenProductId = useMemo(() => {
    if (!flagInboxFeature) return null;
    const milestone = milestones.find((m) => m.id === flagInboxFeature.milestone_id);
    return milestone?.product_id ?? null;
  }, [flagInboxFeature, milestones]);

  const visibleProducts = useMemo(() => products.filter((p) => p.id !== hiddenProductId), [products, hiddenProductId]);

  const issues = useMemo(() => {
    return stories
      .filter((s) => s.source === 'flagged')
      .sort((a, b) => {
        if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [stories]);

  const openIssueCount = issues.filter((s) => s.status !== 'done').length;

  return {
    products, milestones, features, stories, itProfiles, loading, reload: load,
    visibleProducts, issues, issuesFeatureId, openIssueCount,
  };
}

export const MILESTONE_STATUSES: { key: Milestone['status']; label: string; color: string }[] = [
  { key: 'planned', label: 'Planned', color: '#9ca3af' },
  { key: 'in_progress', label: 'In Progress', color: '#f97316' },
  { key: 'shipped', label: 'Shipped', color: '#4F7B3E' },
];

export const STORY_STATUSES: { key: UserStory['status']; label: string; color: string }[] = [
  { key: 'backlog', label: 'Backlog', color: '#9ca3af' },
  { key: 'in_progress', label: 'In Progress', color: '#f97316' },
  { key: 'review', label: 'Review', color: '#2F8C86' },
  { key: 'done', label: 'Done', color: '#4F7B3E' },
];

export const PRIORITY_STYLE: Record<UserStory['priority'], string> = {
  low: 'bg-gray-100 dark:bg-white/10 text-gray-500',
  medium: 'bg-brand/10 text-brand-700 dark:text-brand-300',
  high: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
};
