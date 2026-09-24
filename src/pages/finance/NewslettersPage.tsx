import { useState } from 'react';
import { Mail, Car } from 'lucide-react';
import VehicleOwnerNewsletterTab from './VehicleOwnerNewsletterTab';

type Tab = 'vehicle_owners';

// A directory of newsletter audiences - Vehicle Owners is the first.
// Each audience is its own bespoke tab (different attachment logic,
// different data collected), sharing only the underlying newsletters
// table - same reasoning as MD Panel's survey_cases registry: build for
// what exists, not a generic engine for audiences that don't yet exist.
export default function NewslettersPage() {
  const [tab, setTab] = useState<Tab>('vehicle_owners');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Mail size={16} className="text-amber-600 dark:text-amber-300" /> Newsletters</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Weekly updates, branded and personal, sent straight from here.</p>
      </div>

      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
        <button
          onClick={() => setTab('vehicle_owners')}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${tab === 'vehicle_owners' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
        >
          <Car size={14} /> Vehicle Owners
        </button>
      </div>

      {tab === 'vehicle_owners' && <VehicleOwnerNewsletterTab />}
    </div>
  );
}
