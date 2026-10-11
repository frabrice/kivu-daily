import { LayoutGrid, Table2, Columns3 } from 'lucide-react';

export type ViewMode = 'cards' | 'table' | 'kanban';

const ICONS: Record<ViewMode, typeof LayoutGrid> = {
  kanban: Columns3,
  cards: LayoutGrid,
  table: Table2,
};

const TITLES: Record<ViewMode, string> = {
  kanban: 'Board view',
  cards: 'Card view',
  table: 'Table view',
};

// `modes` defaults to the original two so every existing caller keeps its
// current two-button toggle unchanged; a page opts into the board view by
// passing modes={['kanban', 'cards', 'table']} (or any subset/order).
export default function ViewToggle({
  value,
  onChange,
  modes = ['cards', 'table'],
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  modes?: ViewMode[];
}) {
  return (
    <div className="flex gap-0.5 p-0.5 bg-inset rounded-lg w-fit shrink-0">
      {modes.map((m) => {
        const Icon = ICONS[m];
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            title={TITLES[m]}
            className={`p-1.5 rounded-md transition-all ${value === m ? 'bg-surface-2 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-fg-subtle'}`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
