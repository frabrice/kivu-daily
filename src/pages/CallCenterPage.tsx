import { useState } from 'react';
import { PhoneCall, Users2, BookOpen, CarFront } from 'lucide-react';
import { useCallCenterData } from '../lib/callCenter';
import CallQueuePage from './callCenter/CallQueuePage';
import CallDirectoryPage from './callCenter/CallDirectoryPage';
import CallScriptsPage from './callCenter/CallScriptsPage';
import NonInsiderDriversPage from './nonInsider/NonInsiderDriversPage';

// MD-only: Call Center employees see Queue/Directory/Scripts as separate
// sidebar pages (src/pages/callCenter/*); the MD sees them as tabs here.
type Tab = 'queue' | 'directory' | 'scripts' | 'non_insider';

export default function CallCenterPage() {
  const [tab, setTab] = useState<Tab>('queue');
  const data = useCallCenterData();
  const { drivers, logs } = data;

  const urgentCount = drivers.filter((d) => d.stage !== 'inactive').filter((d) => {
    const driverLogs = logs.filter((l) => l.driver_id === d.id);
    const lastCall = driverLogs[0];
    if (!lastCall) return true;
    if (lastCall.outcome?.needs_followup) return true;
    const days = Math.floor((Date.now() - new Date(lastCall.created_at).getTime()) / 86400000);
    return days >= 7;
  }).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
        <TabButton active={tab === 'queue'} onClick={() => setTab('queue')} icon={PhoneCall} label="Call Queue" badge={urgentCount} />
        <TabButton active={tab === 'directory'} onClick={() => setTab('directory')} icon={Users2} label="Directory" />
        <TabButton active={tab === 'scripts'} onClick={() => setTab('scripts')} icon={BookOpen} label="Scripts" />
        <TabButton active={tab === 'non_insider'} onClick={() => setTab('non_insider')} icon={CarFront} label="Non-Insider Drivers" />
      </div>

      {tab === 'queue' && <CallQueuePage data={data} />}
      {tab === 'directory' && <CallDirectoryPage data={data} />}
      {tab === 'scripts' && <CallScriptsPage data={data} />}
      {tab === 'non_insider' && <NonInsiderDriversPage />}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof PhoneCall; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {!!badge && <span className="text-[9px] font-bold text-white bg-orange-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}
