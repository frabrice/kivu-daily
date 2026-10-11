import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMyOpenTicketCount } from '../lib/callTickets';
import { useUnreadComments } from '../lib/hooks';
import { useCarFollowupCount } from '../lib/nonInsider';
import { useAuth } from '../lib/auth';
import { Access } from './access';
import { BadgeKey } from './registry';

const head = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });

// Live counters for the rail and sidebars. Cheap head-only counts,
// refreshed every minute and whenever the window regains focus.
export function useBadges(a: Access): Partial<Record<BadgeKey, number>> {
  const { profile } = useAuth();
  const myCases = useMyOpenTicketCount(profile?.id);
  const unreadComments = useUnreadComments(a.isMd ? profile : null);
  const carFollowups = useCarFollowupCount(a.in('fleet', 'it'));
  const q = useQuery({
    queryKey: ['os-badges', profile?.id, a.isMd, a.dept],
    enabled: !!profile,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [pendingPauses, openIssues, pendingFinance, myOpenTasks, pendingDeposits] = await Promise.all([
        a.in('fleet', 'finance', 'it') ? head(supabase.from('driver_pauses').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending')) : 0,
        a.in('it') ? head(supabase.from('user_stories').select('id', { count: 'exact', head: true }).eq('source', 'flagged').neq('status', 'done')) : 0,
        a.in('finance') ? head(supabase.from('finance_transactions').select('id', { count: 'exact', head: true }).in('status', ['pending', 'checked'])) : 0,
        head(supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', profile!.id).eq('date', today()).eq('completed', false)),
        a.in('fleet', 'finance', 'it') ? head(supabase.from('driver_deposits').select('id', { count: 'exact', head: true }).eq('status', 'pending')) : 0,
      ]);
      return { pendingPauses, openIssues, pendingFinance, myOpenTasks, overdueDeposits: pendingDeposits };
    },
  });
  return { myCases, unreadComments, carFollowups, ...(q.data ?? {}) };
}
