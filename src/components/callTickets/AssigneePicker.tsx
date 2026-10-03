import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { personWithRole, TicketPerson } from '../../lib/callTickets';

// Everyone who can take a ticket, shown the way the Call Center thinks
// about routing: "Imanariyo Baptiste (Head of IT)". Searchable by name or
// by what they're in charge of ("finance", "IT"...).
export default function AssigneePicker({
  people,
  value,
  onChange,
  excludeId,
}: {
  people: TicketPerson[];
  value: string;
  onChange: (id: string) => void;
  excludeId?: string | null;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people
      .filter((p) => p.is_active && p.id !== excludeId)
      .filter((p) => !needle || personWithRole(p).toLowerCase().includes(needle) || (p.department?.name ?? '').toLowerCase().includes(needle))
      .sort((a, b) => Number(b.role === 'managing_director') - Number(a.role === 'managing_director') || a.full_name.localeCompare(b.full_name));
  }, [people, q, excludeId]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.02]">
        <Search size={13} className="text-gray-400 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or what they're in charge of"
          className="flex-1 bg-transparent text-[12px] outline-none"
          aria-label="Search people"
        />
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-50 dark:divide-white/5" role="listbox" aria-label="Assign to">
        {list.length === 0 && <p className="text-[11px] text-gray-400 text-center py-6">Nobody matches "{q}".</p>}
        {list.map((p) => {
          const selected = p.id === value;
          const label = p.responsibility_label || (p.role === 'managing_director' ? 'Managing Director' : p.department?.name);
          return (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(p.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${selected ? 'bg-brand/10' : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]'}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${selected ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'}`}>
                {p.full_name.trim().charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] truncate">
                  <span className="font-medium">{p.full_name.trim()}</span>
                  {label && <span className="text-gray-500 dark:text-gray-400"> ({label})</span>}
                </p>
                {p.department?.name && p.department.name !== label && <p className="text-[10px] text-gray-400 truncate">{p.department.name}</p>}
              </div>
              {selected && <Check size={15} className="text-brand-600 dark:text-brand-300 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
