import { useState, useMemo, useEffect } from 'react';
import { Plus, ArrowLeft, Package, Milestone as MilestoneIcon, Layers, User } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useITHubData, MILESTONE_STATUSES, STORY_STATUSES, PRIORITY_STYLE } from '../../lib/itHub';
import { Product, Milestone, Feature, UserStory } from '../../lib/supabase';
import EntryActions from '../../components/EntryActions';
import ProductDrawer from '../../components/itHub/ProductDrawer';
import MilestoneDrawer from '../../components/itHub/MilestoneDrawer';
import FeatureDrawer from '../../components/itHub/FeatureDrawer';
import StoryDrawer from '../../components/itHub/StoryDrawer';

interface ProductsPageProps { data?: ReturnType<typeof useITHubData> }

// See FleetPipelinePage.tsx for why this takes an optional pre-fetched
// data prop rather than always calling useITHubData() itself.
export default function ProductsPage({ data }: ProductsPageProps = {}) {
  return data ? <ProductsPageView data={data} /> : <ProductsPageWithData />;
}

function ProductsPageWithData() {
  return <ProductsPageView data={useITHubData()} />;
}

function ProductsPageView({ data }: { data: ReturnType<typeof useITHubData> }) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'it';
  const { visibleProducts, products, milestones, features, stories, itProfiles, loading, reload } = data;

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [editMilestone, setEditMilestone] = useState<Milestone | 'new' | null>(null);
  const [editFeature, setEditFeature] = useState<Feature | 'new' | null>(null);
  const [storyDrawer, setStoryDrawer] = useState<{ story: UserStory | null; startEditing: boolean } | null>(null);

  useEffect(() => {
    if (selectedProduct) {
      const fresh = products.find((p) => p.id === selectedProduct.id);
      if (fresh) setSelectedProduct(fresh);
    }
    if (selectedMilestone) {
      const fresh = milestones.find((m) => m.id === selectedMilestone.id);
      if (fresh) setSelectedMilestone(fresh);
    }
    if (selectedFeature) {
      const fresh = features.find((f) => f.id === selectedFeature.id);
      if (fresh) setSelectedFeature(fresh);
    }
  }, [products, milestones, features]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  if (selectedFeature) {
    const featureStories = stories.filter((s) => s.feature_id === selectedFeature.id);
    return (
      <>
        <StoriesBoard
          feature={selectedFeature}
          stories={featureStories}
          canEdit={canEdit}
          onBack={() => setSelectedFeature(null)}
          onAddStory={() => setStoryDrawer({ story: null, startEditing: true })}
          onOpenStory={(s, startEditing) => setStoryDrawer({ story: s, startEditing })}
        />
        {storyDrawer && (
          <StoryDrawer
            story={storyDrawer.story}
            startEditing={storyDrawer.startEditing}
            featureId={selectedFeature.id}
            itProfiles={itProfiles}
            canEdit={canEdit}
            onClose={() => setStoryDrawer(null)}
            onSaved={reload}
          />
        )}
      </>
    );
  }

  if (selectedMilestone) {
    const milestoneFeatures = features.filter((f) => f.milestone_id === selectedMilestone.id);
    return (
      <>
        <FeaturesList
          milestone={selectedMilestone}
          milestoneFeatures={milestoneFeatures}
          stories={stories}
          canEdit={canEdit}
          onBack={() => setSelectedMilestone(null)}
          onSelectFeature={setSelectedFeature}
          onAddFeature={() => setEditFeature('new')}
          onEditFeature={(f) => setEditFeature(f)}
        />
        {editFeature && (
          <FeatureDrawer
            feature={editFeature === 'new' ? null : editFeature}
            milestoneId={selectedMilestone.id}
            canEdit={canEdit}
            onClose={() => setEditFeature(null)}
            onSaved={reload}
          />
        )}
      </>
    );
  }

  if (selectedProduct) {
    const productMilestones = milestones.filter((m) => m.product_id === selectedProduct.id);
    return (
      <>
        <MilestonesList
          product={selectedProduct}
          productMilestones={productMilestones}
          features={features}
          canEdit={canEdit}
          onBack={() => setSelectedProduct(null)}
          onSelectMilestone={setSelectedMilestone}
          onAddMilestone={() => setEditMilestone('new')}
          onEditMilestone={(m) => setEditMilestone(m)}
        />
        {editMilestone && (
          <MilestoneDrawer
            milestone={editMilestone === 'new' ? null : editMilestone}
            productId={selectedProduct.id}
            canEdit={canEdit}
            onClose={() => setEditMilestone(null)}
            onSaved={reload}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Package size={16} className="text-cyan-600 dark:text-cyan-300" /> Products</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">{visibleProducts.length} product{visibleProducts.length === 1 ? '' : 's'}</p>
        </div>
        {canEdit && (
          <button onClick={() => setNewProductOpen(true)} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> New Product
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {visibleProducts.map((prod) => {
          const prodMilestones = milestones.filter((m) => m.product_id === prod.id);
          const shipped = prodMilestones.filter((m) => m.status === 'shipped').length;
          return (
            <button key={prod.id} onClick={() => setSelectedProduct(prod)} className="card p-4 text-left hover:shadow-md hover:border-brand/30 transition-all">
              <div className="flex items-center gap-2 mb-1.5">
                <Package size={14} className="text-brand-600 dark:text-brand-300 shrink-0" />
                <p className="text-[12px] font-semibold truncate">{prod.name}</p>
              </div>
              {prod.description && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{prod.description}</p>}
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span>{prodMilestones.length} milestone{prodMilestones.length === 1 ? '' : 's'}</span>
                <span className="text-positive font-medium">{shipped} shipped</span>
              </div>
              {prodMilestones.length > 0 && (
                <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mt-2 flex">
                  {MILESTONE_STATUSES.map((s) => {
                    const n = prodMilestones.filter((m) => m.status === s.key).length;
                    const pct = (n / prodMilestones.length) * 100;
                    return pct > 0 ? <div key={s.key} style={{ width: `${pct}%`, backgroundColor: s.color }} /> : null;
                  })}
                </div>
              )}
            </button>
          );
        })}
        {visibleProducts.length === 0 && (
          <div className="card p-10 text-center col-span-full">
            <Package size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">No products yet. Android App, Web Dashboard — start with what you're building.</p>
          </div>
        )}
      </div>

      {newProductOpen && <ProductDrawer onClose={() => setNewProductOpen(false)} onSaved={reload} />}
    </div>
  );
}

function MilestonesList({
  product,
  productMilestones,
  features,
  canEdit,
  onBack,
  onSelectMilestone,
  onAddMilestone,
  onEditMilestone,
}: {
  product: Product;
  productMilestones: Milestone[];
  features: Feature[];
  canEdit: boolean;
  onBack: () => void;
  onSelectMilestone: (m: Milestone) => void;
  onAddMilestone: () => void;
  onEditMilestone: (m: Milestone) => void;
}) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 -ml-2">
        <ArrowLeft size={14} /> Products
      </button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">{product.name}</h2>
          {product.description && <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">{product.description}</p>}
        </div>
        {canEdit && (
          <button onClick={onAddMilestone} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> New Milestone
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {productMilestones.map((m) => {
          const status = MILESTONE_STATUSES.find((s) => s.key === m.status)!;
          const featureCount = features.filter((f) => f.milestone_id === m.id).length;
          return (
            <div key={m.id} className="card p-4 hover:shadow-md hover:border-brand/30 transition-all">
              <button onClick={() => onSelectMilestone(m)} className="w-full text-left">
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <MilestoneIcon size={13} className="text-gray-400 shrink-0" />
                    <p className="text-[12px] font-medium truncate">{m.name}</p>
                  </div>
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${status.color}20`, color: status.color }}>
                    {status.label}
                  </span>
                </div>
                {m.description && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">{m.description}</p>}
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                  <span>{featureCount} feature{featureCount === 1 ? '' : 's'}</span>
                  {m.target_date && <span>Target {m.target_date}</span>}
                </div>
              </button>
              {canEdit && (
                <button onClick={() => onEditMilestone(m)} className="text-[9px] text-brand-600 dark:text-brand-300 mt-2 hover:underline">
                  Edit
                </button>
              )}
            </div>
          );
        })}
        {productMilestones.length === 0 && (
          <div className="card p-10 text-center col-span-full">
            <MilestoneIcon size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">No milestones yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FeaturesList({
  milestone,
  milestoneFeatures,
  stories,
  canEdit,
  onBack,
  onSelectFeature,
  onAddFeature,
  onEditFeature,
}: {
  milestone: Milestone;
  milestoneFeatures: Feature[];
  stories: UserStory[];
  canEdit: boolean;
  onBack: () => void;
  onSelectFeature: (f: Feature) => void;
  onAddFeature: () => void;
  onEditFeature: (f: Feature) => void;
}) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 -ml-2">
        <ArrowLeft size={14} /> Milestones
      </button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">{milestone.name}</h2>
          {milestone.description && <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">{milestone.description}</p>}
        </div>
        {canEdit && (
          <button onClick={onAddFeature} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> New Feature
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {milestoneFeatures.map((f) => {
          const featureStories = stories.filter((s) => s.feature_id === f.id);
          const done = featureStories.filter((s) => s.status === 'done').length;
          return (
            <div key={f.id} className="card p-4 hover:shadow-md hover:border-brand/30 transition-all">
              <button onClick={() => onSelectFeature(f)} className="w-full text-left">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Layers size={13} className="text-gray-400 shrink-0" />
                  <p className="text-[12px] font-medium truncate">{f.name}</p>
                </div>
                {f.description && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">{f.description}</p>}
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                  <span>{featureStories.length} stor{featureStories.length === 1 ? 'y' : 'ies'}</span>
                  {featureStories.length > 0 && <span className="text-positive font-medium">{done} done</span>}
                </div>
              </button>
              {canEdit && (
                <button onClick={() => onEditFeature(f)} className="text-[9px] text-brand-600 dark:text-brand-300 mt-2 hover:underline">
                  Edit
                </button>
              )}
            </div>
          );
        })}
        {milestoneFeatures.length === 0 && (
          <div className="card p-10 text-center col-span-full">
            <Layers size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">No features yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StoriesBoard({
  feature,
  stories,
  canEdit,
  onBack,
  onAddStory,
  onOpenStory,
}: {
  feature: Feature;
  stories: UserStory[];
  canEdit: boolean;
  onBack: () => void;
  onAddStory: () => void;
  onOpenStory: (s: UserStory, startEditing: boolean) => void;
}) {
  const byStatus = useMemo(() => {
    const map: Record<string, UserStory[]> = { backlog: [], in_progress: [], review: [], done: [] };
    for (const s of stories) map[s.status].push(s);
    return map;
  }, [stories]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 -ml-2">
        <ArrowLeft size={14} /> Features
      </button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">{feature.name}</h2>
          {feature.description && <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">{feature.description}</p>}
        </div>
        {canEdit && (
          <button onClick={onAddStory} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> New Story
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {STORY_STATUSES.map((status) => (
          <div key={status.key} className="space-y-2">
            <div className="flex items-center gap-1.5 px-0.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{status.label}</p>
              <span className="text-[9px] text-gray-400">{byStatus[status.key].length}</span>
            </div>
            <div className="space-y-1.5 min-h-[40px]">
              {byStatus[status.key].map((s) => {
                const doneCriteria = s.acceptance_criteria.filter((c) => c.done).length;
                return (
                  <div
                    key={s.id}
                    onClick={() => onOpenStory(s, false)}
                    className="w-full card p-2.5 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
                  >
                    <div className="flex items-start justify-between gap-1.5 mb-1">
                      <p className="text-[11px] font-medium line-clamp-2">As a {s.persona}, {s.need}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-[8px] font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[s.priority]}`}>{s.priority}</span>
                        <EntryActions onView={() => onOpenStory(s, false)} onEdit={() => onOpenStory(s, true)} canEdit={canEdit} />
                      </div>
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
              {byStatus[status.key].length === 0 && (
                <div className="h-12 rounded-lg border border-dashed border-gray-200 dark:border-white/10 flex items-center justify-center">
                  <p className="text-[9px] text-gray-300 dark:text-white/20">Empty</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
