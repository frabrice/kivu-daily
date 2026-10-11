import { useMemo, useState } from 'react';
import { Plus, AlertTriangle, User, Package } from 'lucide-react';
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
  const { issues: allIssues, itProfiles, visibleProducts, issuesFeatureId, openIssueCount, loading, reload } = data;
  const [view, setView] = useState<ViewMode>('kanban');
  const [productFilter, setProductFilter] = useState<string>('all');
  // Product chips: every product that has issues, plus flagged items with no product.
  const productChips = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const s of allIssues) {
      const key = s.product?.id ?? 'none';
      const chip = map.get(key) ?? { key, label: s.product?.name ?? 'No product', count: 0 };
      chip.count += 1;
      map.set(key, chip);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [allIssues]);
  const issues = productFilter === 'all' ? allIssues : allIssues.filter((s) => (s.product?.id ?? 'none') === productFilter);
  const [storyDrawer, setStoryDrawer] = useState<{ story: UserStory | null; startEditing: boolean } | null>(null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle size={16} className="text-cyan-600 dark:text-cyan-300" /> Issues
            {openIssueCount > 0 && <span className="text-micro font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{openIssueCount}</span>}
          </h2>
          <p className="text-caption text-fg-subtle mt-0.5">Friction flagged in from other departments, anything IT adds directly, and the user stories planned under each product.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} modes={['kanban', 'cards', 'table']} />
          {canEdit && (
            <button onClick={() => setStoryDrawer({ story: null, startEditing: true })} className="btn-primary flex items-center gap-1.5">
              <Plus size={14} /> New Issue
            </button>
          )}
        </div>
      </div>

      {productChips.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by product">
          {[{ key: 'all', label: 'All', count: allIssues.length }, ...productChips].map((c) => (
            <button key={c.key} role="tab" aria-selected={productFilter === c.key} onClick={() => setProductFilter(c.key)}
              className={`px-2.5 py-1 rounded-full text-caption font-medium border transition-colors ${productFilter === c.key ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-line text-fg-muted hover:border-brand/40'}`}>
              {c.label} <span className="opacity-60">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {issues.length === 0 && (
        <div className="card p-12 text-center">
          <AlertTriangle size={26} className="text-fg-subtle mx-auto mb-2" />
          <p className="text-small text-fg-subtle">No issues yet. Flagged friction from other departments lands here.</p>
        </div>
      )}

      {issues.length > 0 && view === 'kanban' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {STORY_STATUSES.map((status) => {
            const columnIssues = issues.filter((s) => s.status === status.key);
            return (
              <div key={status.key} className="space-y-2">
                <div className="flex items-center gap-1.5 px-0.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                  <p className="text-micro font-semibold uppercase tracking-wide text-fg-muted">{status.label}</p>
                  <span className="text-micro text-fg-subtle">{columnIssues.length}</span>
                </div>
                <div className="space-y-1.5 min-h-[40px]">
                  {columnIssues.map((s) => {
                    const doneCriteria = s.acceptance_criteria.filter((c) => c.done).length;
                    return (
                      <div
                        key={s.id}
                        onClick={() => setStoryDrawer({ story: s, startEditing: false })}
                        className="card p-2.5 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <p className="text-caption font-medium line-clamp-2">{s.title || `As a ${s.persona}, ${s.need}`}</p>
                          <EntryActions
                            onView={() => setStoryDrawer({ story: s, startEditing: false })}
                            onEdit={() => setStoryDrawer({ story: s, startEditing: true })}
                            canEdit={canEdit}
                          />
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[s.priority]}`}>{s.priority}</span>
                          {s.product && (
                            <span className="inline-flex items-center gap-1 text-micro font-medium text-cyan-600 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 px-1.5 py-0.5 rounded-full">
                              <Package size={9} /> {s.product.name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-micro text-fg-subtle mt-1.5">
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
                  {columnIssues.length === 0 && (
                    <div className="h-12 rounded-lg border border-dashed border-line flex items-center justify-center">
                      <p className="text-micro text-fg-subtle ">Empty</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {issues.length > 0 && view === 'table' && (
        <DataTable
          rows={issues}
          keyFn={(s) => s.id}
          onRowClick={(s) => setStoryDrawer({ story: s, startEditing: false })}
          columns={[
            { header: 'Title', className: 'max-w-sm whitespace-normal', render: (s) => <span className="font-medium">{s.title || `As a ${s.persona}, ${s.need}`}</span> },
            { header: 'Product', render: (s) => s.product?.name ?? '—' },
            {
              header: 'Status',
              render: (s) => {
                const status = STORY_STATUSES.find((st) => st.key === s.status)!;
                return (
                  <span className="text-micro font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${status.color}20`, color: status.color }}>
                    {status.label}
                  </span>
                );
              },
            },
            { header: 'Priority', render: (s) => <span className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[s.priority]}`}>{s.priority}</span> },
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
                  <p className="text-caption font-medium line-clamp-2">{s.title || `As a ${s.persona}, ${s.need}`}</p>
                  <EntryActions onView={() => setStoryDrawer({ story: s, startEditing: false })} onEdit={() => setStoryDrawer({ story: s, startEditing: true })} canEdit={canEdit} />
                </div>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-micro font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${status.color}20`, color: status.color }}>
                    {status.label}
                  </span>
                  <span className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[s.priority]}`}>{s.priority}</span>
                  {s.product && (
                    <span className="inline-flex items-center gap-1 text-micro font-medium text-cyan-600 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 px-1.5 py-0.5 rounded-full">
                      <Package size={9} /> {s.product.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-micro text-fg-subtle">
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

      {storyDrawer && (
        <StoryDrawer
          story={storyDrawer.story}
          startEditing={storyDrawer.startEditing}
          featureId={issuesFeatureId}
          isIssue
          itProfiles={itProfiles}
          products={visibleProducts}
          canEdit={canEdit}
          onClose={() => setStoryDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
