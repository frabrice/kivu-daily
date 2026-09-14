import { useState } from 'react';
import { Plus, AlertTriangle, User } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useITHubData, STORY_STATUSES, PRIORITY_STYLE } from '../../lib/itHub';
import { UserStory } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import StoryDrawer from '../../components/itHub/StoryDrawer';

interface IssuesPageProps { data?: ReturnType<typeof useITHubData> }

export default function IssuesPage({ data }: IssuesPageProps = {}) {
  return data ? <IssuesPageView data={data} /> : <IssuesPageWithData />;
}

function IssuesPageWithData() {
  return <IssuesPageView data={useITHubData()} />;
}

function IssuesPageView({ data }: { data: ReturnType<typeof useITHubData> }) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'it';
  const { issues, itProfiles, issuesFeatureId, openIssueCount, loading, reload } = data;
  const [view, setView] = useState<ViewMode>('cards');
  const [storyDrawer, setStoryDrawer] = useState<{ story: UserStory | null; startEditing: boolean } | null>(null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle size={16} className="text-cyan-600 dark:text-cyan-300" /> Issues
            {openIssueCount > 0 && <span className="text-[8px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{openIssueCount}</span>}
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Friction flagged in from other departments, plus anything IT adds directly.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          {canEdit && issuesFeatureId && (
            <button onClick={() => setStoryDrawer({ story: null, startEditing: true })} className="btn-primary flex items-center gap-1.5">
              <Plus size={14} /> New Issue
            </button>
          )}
        </div>
      </div>

      {issues.length === 0 && (
        <div className="card p-12 text-center">
          <AlertTriangle size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No issues yet. Flagged friction from other departments lands here.</p>
        </div>
      )}

      {issues.length > 0 && view === 'table' && (
        <DataTable
          rows={issues}
          keyFn={(s) => s.id}
          onRowClick={(s) => setStoryDrawer({ story: s, startEditing: false })}
          columns={[
            { header: 'Need', className: 'max-w-sm whitespace-normal', render: (s) => <span className="font-medium">As a {s.persona}, {s.need}</span> },
            {
              header: 'Status',
              render: (s) => {
                const status = STORY_STATUSES.find((st) => st.key === s.status)!;
                return (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${status.color}20`, color: status.color }}>
                    {status.label}
                  </span>
                );
              },
            },
            { header: 'Priority', render: (s) => <span className={`text-[8px] font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[s.priority]}`}>{s.priority}</span> },
            { header: 'Assignee', render: (s) => s.assignee?.full_name ?? 'Unassigned' },
            {
              header: '',
              className: 'text-right',
              render: (s) => <EntryActions onView={() => setStoryDrawer({ story: s, startEditing: false })} onEdit={() => setStoryDrawer({ story: s, startEditing: true })} canEdit={canEdit} />,
            },
          ]}
        />
      )}

      {issues.length > 0 && view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {issues.map((s) => {
            const status = STORY_STATUSES.find((st) => st.key === s.status)!;
            const doneCriteria = s.acceptance_criteria.filter((c) => c.done).length;
            return (
              <div
                key={s.id}
                onClick={() => setStoryDrawer({ story: s, startEditing: false })}
                className="card p-4 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
              >
                <div className="flex items-start justify-between gap-1.5 mb-1.5">
                  <p className="text-[11px] font-medium line-clamp-2">As a {s.persona}, {s.need}</p>
                  <EntryActions onView={() => setStoryDrawer({ story: s, startEditing: false })} onEdit={() => setStoryDrawer({ story: s, startEditing: true })} canEdit={canEdit} />
                </div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${status.color}20`, color: status.color }}>
                    {status.label}
                  </span>
                  <span className={`text-[8px] font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[s.priority]}`}>{s.priority}</span>
                </div>
                <div className="flex items-center justify-between text-[9px] text-gray-400">
                  <span className="flex items-center gap-1">
                    <User size={10} /> {s.assignee?.full_name?.split(' ')[0] ?? 'Unassigned'}
                  </span>
                  {s.acceptance_criteria.length > 0 && (
                    <span>{doneCriteria}/{s.acceptance_criteria.length} AC</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {storyDrawer && issuesFeatureId && (
        <StoryDrawer
          story={storyDrawer.story}
          startEditing={storyDrawer.startEditing}
          featureId={issuesFeatureId}
          isIssue
          itProfiles={itProfiles}
          canEdit={canEdit}
          onClose={() => setStoryDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
