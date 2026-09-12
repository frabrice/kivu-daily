import { useState, useMemo } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { EmployeeWithStats } from '../lib/company';
import { Task } from '../lib/supabase';
import { completionColor, formatDateLabel } from '../lib/utils';
import Avatar from '../components/Avatar';

interface Props {
  employees: EmployeeWithStats[];
  allTasks: Task[];
  onSelect: (e: EmployeeWithStats) => void;
}

export default function SearchPage({ employees, allTasks, onSelect }: Props) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    if (!query.trim()) return { employees: [], tasks: [], departments: [] as { name: string; count: number }[] };
    const q = query.toLowerCase();
    const empMatches = employees.filter(
      (e) => e.full_name.toLowerCase().includes(q) || (e.department?.name ?? '').toLowerCase().includes(q)
    );
    const taskMatches = allTasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 20);
    const deptMap = new Map<string, number>();
    for (const e of empMatches) {
      const dn = e.department?.name ?? 'No Department';
      deptMap.set(dn, (deptMap.get(dn) ?? 0) + 1);
    }
    return {
      employees: empMatches,
      tasks: taskMatches,
      departments: Array.from(deptMap.entries()).map(([name, count]) => ({ name, count })),
    };
  }, [query, employees, allTasks]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employees, tasks, departments…"
          className="input pl-11"
        />
      </div>

      {!query.trim() && <p className="text-sm text-gray-400 text-center py-8">Start typing to search across the company.</p>}

      {query.trim() && results.employees.length === 0 && results.tasks.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No results found.</p>
      )}

      {results.employees.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-2">Employees ({results.employees.length})</h3>
          <div className="space-y-2">
            {results.employees.map((e) => (
              <button key={e.id} onClick={() => onSelect(e)} className="card p-3 flex items-center gap-3 w-full text-left hover:shadow-sm transition-all">
                <Avatar name={e.full_name} url={e.avatar_url} size="md" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{e.full_name}</p>
                  <p className="text-xs text-gray-400">{e.department?.name}</p>
                </div>
                <span className="text-sm font-bold" style={{ color: completionColor(e.todayPct) }}>{Math.round(e.todayPct)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {results.tasks.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-2">Tasks ({results.tasks.length})</h3>
          <div className="space-y-1.5">
            {results.tasks.map((t) => {
              const emp = employees.find((e) => e.id === t.user_id);
              return (
                <div key={t.id} className="card p-3 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${t.completed ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <div className="flex-1">
                    <p className={`text-sm ${t.completed ? 'line-through text-gray-400' : ''}`}>{t.title}</p>
                    <p className="text-xs text-gray-400">{emp?.full_name} · {formatDateLabel(t.date)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
