import { useEffect, useState } from 'react';
import { Zap, ChevronRight, ClipboardList } from 'lucide-react';
import { supabase, SurveyCase } from '../lib/supabase';
import ChargingStationsHub from './casehubs/ChargingStationsHub';

const CASE_ICONS: Record<string, typeof Zap> = {
  'charging-stations': Zap,
};

// MD Panel is a directory of research "cases" - Charging Stations is
// Case 1. Each case gets its own dedicated hub (collectors/link, data
// table, analytics) rather than a generic form-builder, since building
// a flexible engine before a second case even exists would be wasted
// complexity - see the survey_cases migration for the full reasoning.
export default function MDPanel() {
  const [cases, setCases] = useState<SurveyCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCase, setOpenCase] = useState<SurveyCase | null>(null);

  const load = async () => {
    const { data } = await supabase.from('survey_cases').select('*').order('created_at');
    setCases((data as SurveyCase[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>;

  if (openCase) {
    if (openCase.slug === 'charging-stations') {
      return <ChargingStationsHub surveyCase={openCase} onBack={() => setOpenCase(null)} />;
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><ClipboardList size={16} className="text-amber-600 dark:text-amber-300" /> Research Cases</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Surveys, data collection, and the analytics built to make the call on each one.</p>
      </div>

      {cases.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-[12px] text-gray-400">No cases yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cases.map((c, i) => {
            const Icon = CASE_ICONS[c.slug] ?? ClipboardList;
            return (
              <button
                key={c.id}
                onClick={() => setOpenCase(c)}
                className="w-full card p-4 flex items-center gap-3 hover:shadow-md hover:border-brand/30 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-brand-600 dark:text-brand-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold">Case {i + 1}: {c.name}</p>
                  {c.description && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{c.description}</p>}
                </div>
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${c.status === 'active' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-white/5'}`}>
                  {c.status === 'active' ? 'Active' : 'Archived'}
                </span>
                <ChevronRight size={16} className="text-gray-300 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
