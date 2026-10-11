import { CampaignStatus } from '../../lib/supabase';

export default function StatusBadge({ status }: { status: CampaignStatus }) {
  const map: Record<CampaignStatus, string> = {
    active: 'bg-brand/10 text-brand-700 dark:text-brand-300',
    paused: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
    completed: 'bg-inset text-fg-muted',
  };
  return <span className={`text-micro font-medium px-1.5 py-0.5 rounded-full shrink-0 ${map[status]}`}>{status}</span>;
}
