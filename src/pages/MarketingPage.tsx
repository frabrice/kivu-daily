import { useState } from 'react';
import { useMarketingData } from '../lib/marketing';
import { todayStr } from '../lib/utils';
import CampaignsPage from './marketing/CampaignsPage';
import FollowUpsPage from './marketing/FollowUpsPage';

// MD-only: Marketing employees see Campaigns/Follow-ups as separate
// sidebar pages (src/pages/marketing/*); the MD sees them as tabs here.
type Tab = 'campaigns' | 'followups';

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>('campaigns');
  const data = useMarketingData();
  const { contacts } = data;

  const overdueCount = contacts.filter((c) => {
    if (!c.next_follow_up || c.stage === 'won' || c.stage === 'lost') return false;
    return c.next_follow_up < todayStr();
  }).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
        <TabButton active={tab === 'campaigns'} onClick={() => setTab('campaigns')} label="Campaigns" />
        <TabButton active={tab === 'followups'} onClick={() => setTab('followups')} label="Follow-ups" badge={overdueCount} />
      </div>

      {tab === 'campaigns' && <CampaignsPage data={data} />}
      {tab === 'followups' && <FollowUpsPage data={data} />}
    </div>
  );
}

function TabButton({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      {label}
      {!!badge && <span className="text-[8px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}
