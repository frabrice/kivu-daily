import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { useCallCenterData } from '../../lib/callCenter';
import { CallScript } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import ScriptDrawer from '../../components/callCenter/ScriptDrawer';

interface ScriptDrawerState { script: CallScript | null; startEditing: boolean }

interface CallScriptsPageProps { data?: ReturnType<typeof useCallCenterData> }

export default function CallScriptsPage({ data }: CallScriptsPageProps = {}) {
  return data ? <CallScriptsPageView data={data} /> : <CallScriptsPageWithData />;
}

function CallScriptsPageWithData() {
  return <CallScriptsPageView data={useCallCenterData()} />;
}

function CallScriptsPageView({ data }: { data: ReturnType<typeof useCallCenterData> }) {
  const { reasons, scripts, loading, reload } = data;
  const [view, setView] = useState<ViewMode>('cards');
  const [drawer, setDrawer] = useState<ScriptDrawerState | null>(null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><BookOpen size={16} className="text-violet-600 dark:text-violet-300" /> Scripts</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">What to say, per reason for the call.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button onClick={() => setDrawer({ script: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> Add Script
          </button>
        </div>
      </div>

      {scripts.length === 0 && (
        <div className="card p-12 text-center">
          <BookOpen size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No scripts yet. Add one to help the team handle calls consistently.</p>
        </div>
      )}

      {scripts.length > 0 && view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {scripts.map((s) => {
            const reason = reasons.find((r) => r.id === s.reason_id);
            return (
              <div
                key={s.id}
                onClick={() => setDrawer({ script: s, startEditing: false })}
                className="card p-3.5 cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-[12px] font-medium">{s.title}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {reason && <span className="text-[9px] font-medium text-brand-600 dark:text-brand-300 bg-brand/10 px-1.5 py-0.5 rounded-full">{reason.label}</span>}
                    <EntryActions
                      onView={() => setDrawer({ script: s, startEditing: false })}
                      onEdit={() => setDrawer({ script: s, startEditing: true })}
                      canEdit
                    />
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap line-clamp-3">{s.body}</p>
              </div>
            );
          })}
        </div>
      )}

      {scripts.length > 0 && view === 'table' && (
        <DataTable
          rows={scripts}
          keyFn={(s) => s.id}
          onRowClick={(s) => setDrawer({ script: s, startEditing: false })}
          columns={[
            { header: 'Title', render: (s) => <span className="font-medium">{s.title}</span> },
            { header: 'Reason', render: (s) => reasons.find((r) => r.id === s.reason_id)?.label ?? 'General / any' },
            { header: 'Preview', className: 'max-w-sm truncate', render: (s) => s.body },
            {
              header: '',
              className: 'text-right',
              render: (s) => (
                <EntryActions
                  onView={() => setDrawer({ script: s, startEditing: false })}
                  onEdit={() => setDrawer({ script: s, startEditing: true })}
                  canEdit
                />
              ),
            },
          ]}
        />
      )}

      {drawer && (
        <ScriptDrawer
          script={drawer.script}
          startEditing={drawer.startEditing}
          reasons={reasons}
          onClose={() => setDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
