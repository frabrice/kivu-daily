import { LayoutGrid, Table2 } from 'lucide-react';

export type ViewMode = 'cards' | 'table';

export default function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit shrink-0">
      <button
        onClick={() => onChange('cards')}
        title="Card view"
        className={`p-1.5 rounded-md transition-all ${value === 'cards' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-400'}`}
      >
        <LayoutGrid size={14} />
      </button>
      <button
        onClick={() => onChange('table')}
        title="Table view"
        className={`p-1.5 rounded-md transition-all ${value === 'table' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-400'}`}
      >
        <Table2 size={14} />
      </button>
    </div>
  );
}
