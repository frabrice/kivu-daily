import { useState } from 'react';
import { Package, AlertTriangle } from 'lucide-react';
import { useITHubData } from '../lib/itHub';
import ProductsPage from './itHub/ProductsPage';
import IssuesPage from './itHub/IssuesPage';

// MD-only: IT employees see Products/Issues as separate sidebar pages
// (src/pages/itHub/*); the MD sees them as tabs here.
type Tab = 'products' | 'issues';

export default function ITHubPage() {
  const [tab, setTab] = useState<Tab>('products');
  const { openIssueCount } = useITHubData();

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
        <TabButton active={tab === 'products'} onClick={() => setTab('products')} icon={Package} label="Products" />
        <TabButton active={tab === 'issues'} onClick={() => setTab('issues')} icon={AlertTriangle} label="Issues" badge={openIssueCount} />
      </div>

      {tab === 'products' && <ProductsPage />}
      {tab === 'issues' && <IssuesPage />}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof Package; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {!!badge && <span className="text-[9px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}
