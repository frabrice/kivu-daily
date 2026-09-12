import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, ArrowLeft, Package, Milestone as MilestoneIcon, Layers, Trash2, CheckSquare, Square, X, User } from 'lucide-react';
import {
  supabase,
  Product,
  Milestone,
  MilestoneStatus,
  Feature,
  UserStory,
  UserStoryStatus,
  UserStoryPriority,
  AcceptanceCriterion,
  Profile,
} from '../lib/supabase';
import { useAuth } from '../lib/auth';
import Modal from '../components/Modal';

const MILESTONE_STATUSES: { key: MilestoneStatus; label: string; color: string }[] = [
  { key: 'planned', label: 'Planned', color: '#9ca3af' },
  { key: 'in_progress', label: 'In Progress', color: '#f97316' },
  { key: 'shipped', label: 'Shipped', color: '#4F7B3E' },
];

const STORY_STATUSES: { key: UserStoryStatus; label: string; color: string }[] = [
  { key: 'backlog', label: 'Backlog', color: '#9ca3af' },
  { key: 'in_progress', label: 'In Progress', color: '#f97316' },
  { key: 'review', label: 'Review', color: '#2F8C86' },
  { key: 'done', label: 'Done', color: '#4F7B3E' },
];

const PRIORITY_STYLE: Record<UserStoryPriority, string> = {
  low: 'bg-gray-100 dark:bg-white/10 text-gray-500',
  medium: 'bg-brand/10 text-brand-700 dark:text-brand-300',
  high: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
};

export default function ITHubPage() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'it';

  const [products, setProducts] = useState<Product[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [stories, setStories] = useState<UserStory[]>([]);
  const [itProfiles, setItProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);

  const [newProductOpen, setNewProductOpen] = useState(false);
  const [editMilestone, setEditMilestone] = useState<Milestone | 'new' | null>(null);
  const [editFeature, setEditFeature] = useState<Feature | 'new' | null>(null);
  const [editStory, setEditStory] = useState<UserStory | 'new' | null>(null);

  const load = useCallback(async () => {
    const [p, m, f, s, pr] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('milestones').select('*').order('created_at', { ascending: true }),
      supabase.from('features').select('*').order('created_at', { ascending: true }),
      supabase.from('user_stories').select('*, assignee:profiles!user_stories_assignee_id_fkey(*)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*, department:departments(*)').eq('is_active', true),
    ]);
    setProducts((p.data as Product[]) ?? []);
    setMilestones((m.data as Milestone[]) ?? []);
    setFeatures((f.data as Feature[]) ?? []);
    setStories((s.data as UserStory[]) ?? []);
    setItProfiles(((pr.data as Profile[]) ?? []).filter((x) => x.department?.slug === 'it' || x.role === 'managing_director'));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('it-hub-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'features' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_stories' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

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
          onAddStory={() => setEditStory('new')}
          onEditStory={(s) => setEditStory(s)}
        />
        {editStory && (
          <StoryDrawer
            story={editStory === 'new' ? null : editStory}
            featureId={selectedFeature.id}
            itProfiles={itProfiles}
            canEdit={canEdit}
            onClose={() => setEditStory(null)}
            onSaved={load}
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
            onSaved={load}
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
            onSaved={load}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold">Product Hub</h2>
          <p className="text-xs text-gray-400 mt-0.5">{products.length} product{products.length === 1 ? '' : 's'}</p>
        </div>
        {canEdit && (
          <button onClick={() => setNewProductOpen(true)} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> New Product
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {products.map((prod) => {
          const prodMilestones = milestones.filter((m) => m.product_id === prod.id);
          const shipped = prodMilestones.filter((m) => m.status === 'shipped').length;
          return (
            <button key={prod.id} onClick={() => setSelectedProduct(prod)} className="card p-4 text-left hover:shadow-md hover:border-brand/30 transition-all">
              <div className="flex items-center gap-2 mb-1.5">
                <Package size={14} className="text-brand-600 dark:text-brand-300 shrink-0" />
                <p className="text-[13px] font-semibold truncate">{prod.name}</p>
              </div>
              {prod.description && <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{prod.description}</p>}
              <div className="flex items-center justify-between text-[11px] text-gray-400">
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
        {products.length === 0 && (
          <div className="card p-10 text-center col-span-full">
            <Package size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[13px] text-gray-400">No products yet. iOS App, Android App, Web Dashboard — start with what you're building.</p>
          </div>
        )}
      </div>

      {newProductOpen && <ProductDrawer onClose={() => setNewProductOpen(false)} onSaved={load} />}
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
          {product.description && <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{product.description}</p>}
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
                    <p className="text-[13px] font-medium truncate">{m.name}</p>
                  </div>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: `${status.color}20`, color: status.color }}>
                    {status.label}
                  </span>
                </div>
                {m.description && <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">{m.description}</p>}
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>{featureCount} feature{featureCount === 1 ? '' : 's'}</span>
                  {m.target_date && <span>Target {m.target_date}</span>}
                </div>
              </button>
              {canEdit && (
                <button onClick={() => onEditMilestone(m)} className="text-[10px] text-brand-600 dark:text-brand-300 mt-2 hover:underline">
                  Edit
                </button>
              )}
            </div>
          );
        })}
        {productMilestones.length === 0 && (
          <div className="card p-10 text-center col-span-full">
            <MilestoneIcon size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[13px] text-gray-400">No milestones yet.</p>
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
          {milestone.description && <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{milestone.description}</p>}
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
                  <p className="text-[13px] font-medium truncate">{f.name}</p>
                </div>
                {f.description && <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">{f.description}</p>}
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>{featureStories.length} stor{featureStories.length === 1 ? 'y' : 'ies'}</span>
                  {featureStories.length > 0 && <span className="text-positive font-medium">{done} done</span>}
                </div>
              </button>
              {canEdit && (
                <button onClick={() => onEditFeature(f)} className="text-[10px] text-brand-600 dark:text-brand-300 mt-2 hover:underline">
                  Edit
                </button>
              )}
            </div>
          );
        })}
        {milestoneFeatures.length === 0 && (
          <div className="card p-10 text-center col-span-full">
            <Layers size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[13px] text-gray-400">No features yet.</p>
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
  onEditStory,
}: {
  feature: Feature;
  stories: UserStory[];
  canEdit: boolean;
  onBack: () => void;
  onAddStory: () => void;
  onEditStory: (s: UserStory) => void;
}) {
  const byStatus = useMemo(() => {
    const map: Record<UserStoryStatus, UserStory[]> = { backlog: [], in_progress: [], review: [], done: [] };
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
          {feature.description && <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{feature.description}</p>}
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
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{status.label}</p>
              <span className="text-[10px] text-gray-400">{byStatus[status.key].length}</span>
            </div>
            <div className="space-y-1.5 min-h-[40px]">
              {byStatus[status.key].map((s) => {
                const doneCriteria = s.acceptance_criteria.filter((c) => c.done).length;
                return (
                  <button key={s.id} onClick={() => onEditStory(s)} className="w-full card p-2.5 text-left hover:shadow-md hover:border-brand/30 transition-all">
                    <div className="flex items-start justify-between gap-1.5 mb-1">
                      <p className="text-[12px] font-medium line-clamp-2">As a {s.persona}, {s.need}</p>
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${PRIORITY_STYLE[s.priority]}`}>{s.priority}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-gray-400">
                      <span className="flex items-center gap-1">
                        <User size={10} /> {s.assignee?.full_name?.split(' ')[0] ?? 'Unassigned'}
                      </span>
                      {s.acceptance_criteria.length > 0 && (
                        <span>{doneCriteria}/{s.acceptance_criteria.length} AC</span>
                      )}
                    </div>
                  </button>
                );
              })}
              {byStatus[status.key].length === 0 && (
                <div className="h-12 rounded-lg border border-dashed border-gray-200 dark:border-white/10 flex items-center justify-center">
                  <p className="text-[10px] text-gray-300 dark:text-white/20">Empty</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('products').insert({ name: name.trim(), description: description.trim() || null });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="New Product" subtitle="e.g. iOS App, Android App, Web Dashboard" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="iOS App" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input resize-none" placeholder="What this product is" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Product'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MilestoneDrawer({
  milestone,
  productId,
  canEdit,
  onClose,
  onSaved,
}: {
  milestone: Milestone | null;
  productId: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(milestone?.name ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [targetDate, setTargetDate] = useState(milestone?.target_date ?? '');
  const [status, setStatus] = useState<MilestoneStatus>(milestone?.status ?? 'planned');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const payload = { name: name.trim(), description: description.trim() || null, target_date: targetDate || null, status };
    const { error: err } = milestone
      ? await supabase.from('milestones').update(payload).eq('id', milestone.id)
      : await supabase.from('milestones').insert({ ...payload, product_id: productId });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!milestone) return;
    setSaving(true);
    await supabase.from('milestones').delete().eq('id', milestone.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={milestone ? milestone.name : 'New Milestone'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="input" placeholder="v2.0 Launch" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} rows={3} className="input resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as MilestoneStatus)} disabled={!canEdit} className="input">
              {MILESTONE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Target date</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} disabled={!canEdit} className="input" />
          </div>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {canEdit && (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {milestone ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : milestone ? 'Save Changes' : 'Create Milestone'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function FeatureDrawer({
  feature,
  milestoneId,
  canEdit,
  onClose,
  onSaved,
}: {
  feature: Feature | null;
  milestoneId: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(feature?.name ?? '');
  const [description, setDescription] = useState(feature?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const payload = { name: name.trim(), description: description.trim() || null };
    const { error: err } = feature
      ? await supabase.from('features').update(payload).eq('id', feature.id)
      : await supabase.from('features').insert({ ...payload, milestone_id: milestoneId });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!feature) return;
    setSaving(true);
    await supabase.from('features').delete().eq('id', feature.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={feature ? feature.name : 'New Feature'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="input" placeholder="Offline mode" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} rows={3} className="input resize-none" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {canEdit && (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {feature ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : feature ? 'Save Changes' : 'Create Feature'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function StoryDrawer({
  story,
  featureId,
  itProfiles,
  canEdit,
  onClose,
  onSaved,
}: {
  story: UserStory | null;
  featureId: string;
  itProfiles: Profile[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [persona, setPersona] = useState(story?.persona ?? '');
  const [need, setNeed] = useState(story?.need ?? '');
  const [benefit, setBenefit] = useState(story?.benefit ?? '');
  const [details, setDetails] = useState(story?.details ?? '');
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(story?.acceptance_criteria ?? []);
  const [status, setStatus] = useState<UserStoryStatus>(story?.status ?? 'backlog');
  const [priority, setPriority] = useState<UserStoryPriority>(story?.priority ?? 'medium');
  const [assigneeId, setAssigneeId] = useState(story?.assignee_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addCriterion = () => setCriteria((c) => [...c, { text: '', done: false }]);
  const updateCriterion = (i: number, patch: Partial<AcceptanceCriterion>) =>
    setCriteria((c) => c.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  const removeCriterion = (i: number) => setCriteria((c) => c.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!persona.trim() || !need.trim() || !benefit.trim()) return;
    setSaving(true);
    setError('');
    const payload = {
      persona: persona.trim(),
      need: need.trim(),
      benefit: benefit.trim(),
      details: details.trim() || null,
      acceptance_criteria: criteria.filter((c) => c.text.trim()),
      status,
      priority,
      assignee_id: assigneeId || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = story
      ? await supabase.from('user_stories').update(payload).eq('id', story.id)
      : await supabase.from('user_stories').insert({ ...payload, feature_id: featureId, created_by: profile!.id });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!story) return;
    setSaving(true);
    await supabase.from('user_stories').delete().eq('id', story.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={story ? 'User Story' : 'New User Story'} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="card p-3 bg-gray-50 dark:bg-white/5 text-[13px] leading-relaxed">
          <span className="text-gray-400">As a</span> <span className="font-medium">{persona || '…'}</span>,{' '}
          <span className="text-gray-400">I need</span> <span className="font-medium">{need || '…'}</span>,{' '}
          <span className="text-gray-400">so that</span> <span className="font-medium">{benefit || '…'}</span>.
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">As a… (persona)</label>
          <input value={persona} onChange={(e) => setPersona(e.target.value)} disabled={!canEdit} className="input" placeholder="driver, rider, call center agent…" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">I need…</label>
          <input value={need} onChange={(e) => setNeed(e.target.value)} disabled={!canEdit} className="input" placeholder="to see my earnings for the week" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">So that…</label>
          <input value={benefit} onChange={(e) => setBenefit(e.target.value)} disabled={!canEdit} className="input" placeholder="I can plan my schedule" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Details</label>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} disabled={!canEdit} rows={3} className="input resize-none" placeholder="Extra context, constraints, links…" />
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Acceptance Criteria</label>
          <div className="space-y-1.5">
            {criteria.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <button type="button" onClick={() => canEdit && updateCriterion(i, { done: !c.done })} className="shrink-0 text-gray-400">
                  {c.done ? <CheckSquare size={16} className="text-positive" /> : <Square size={16} />}
                </button>
                <input
                  value={c.text}
                  onChange={(e) => updateCriterion(i, { text: e.target.value })}
                  disabled={!canEdit}
                  className="input flex-1 py-1.5"
                  placeholder="Given… when… then…"
                />
                {canEdit && (
                  <button type="button" onClick={() => removeCriterion(i)} className="shrink-0 text-gray-300 hover:text-red-500">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button type="button" onClick={addCriterion} className="text-[12px] text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 pt-0.5">
                <Plus size={12} /> Add criterion
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as UserStoryStatus)} disabled={!canEdit} className="input">
              {STORY_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as UserStoryPriority)} disabled={!canEdit} className="input">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Assignee</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={!canEdit} className="input">
            <option value="">Unassigned</option>
            {itProfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {canEdit && (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {story ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !persona.trim() || !need.trim() || !benefit.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : story ? 'Save Changes' : 'Create Story'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
