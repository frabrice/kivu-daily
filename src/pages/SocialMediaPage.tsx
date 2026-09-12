import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, ChevronLeft, ChevronRight, Rocket, Image as ImageIcon, Zap, Trash2, ListFilter, CalendarDays, Pencil } from 'lucide-react';
import { supabase, ContentPost, ContentStatus } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { todayStr, dateStr, addDays, startOfWeek } from '../lib/utils';
import Modal from '../components/Modal';
import ViewToggle, { ViewMode } from '../components/ViewToggle';
import DataTable from '../components/DataTable';
import EntryActions from '../components/EntryActions';

type CalendarMode = 'week' | 'list';

const PILLARS = ['Launch', 'Download Drive', 'Driver Heroes', 'Rider Love/UGC', 'Kivu Care', 'Explore Kigali', 'Green Month', 'Referral Blitz', 'Other'];
const INTENTS = ['Awareness', 'Engagement', 'Downloads', 'Retention', 'Driver Recruitment', 'Trust-building'];
const AUDIENCES = ['Riders', 'Drivers', 'Partners', 'General Public'];
const FORMATS = ['Photo', 'Reel', 'Story', 'Carousel', 'Video'];
const PLATFORMS = ['Instagram', 'Facebook', 'TikTok', 'X (Twitter)', 'LinkedIn', 'WhatsApp Status'];

const STATUS_META: Record<ContentStatus, { label: string; color: string; bg: string }> = {
  idea: { label: 'Idea', color: '#6b7280', bg: 'bg-gray-100 dark:bg-white/10 text-gray-500' },
  drafted: { label: 'Drafted', color: '#f97316', bg: 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  scheduled: { label: 'Scheduled', color: '#2F8C86', bg: 'bg-brand/10 text-brand-700 dark:text-brand-300' },
  posted: { label: 'Posted', color: '#4F7B3E', bg: 'bg-positive/10 text-positive' },
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function SocialMediaPage() {
  const [mode, setMode] = useState<CalendarMode>('week');
  const [listView, setListView] = useState<ViewMode>('cards');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [postDrawer, setPostDrawer] = useState<{ post: ContentPost | null; startEditing: boolean } | null>(null);
  const [newPostDate, setNewPostDate] = useState(todayStr());

  const load = useCallback(async () => {
    const { data } = await supabase.from('content_calendar').select('*').order('post_date', { ascending: true });
    setPosts((data as ContentPost[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('content-calendar-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_calendar' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekLabel = `${weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const postsByDate = useMemo(() => {
    const map: Record<string, ContentPost[]> = {};
    for (const p of posts) {
      (map[p.post_date] ??= []).push(p);
    }
    return map;
  }, [posts]);

  const openNew = (date: string) => {
    setNewPostDate(date);
    setPostDrawer({ post: null, startEditing: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
          <TabButton active={mode === 'week'} onClick={() => setMode('week')} icon={CalendarDays} label="Week" />
          <TabButton active={mode === 'list'} onClick={() => setMode('list')} icon={ListFilter} label="List" />
        </div>
        <div className="flex items-center gap-2">
          {mode === 'week' && (
            <div className="flex items-center gap-1">
              <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="btn-ghost p-1.5"><ChevronLeft size={15} /></button>
              <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="text-[12px] text-gray-500 px-2">{weekLabel}</button>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="btn-ghost p-1.5"><ChevronRight size={15} /></button>
            </div>
          )}
          {mode === 'list' && <ViewToggle value={listView} onChange={setListView} />}
          <button onClick={() => openNew(todayStr())} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> New Post
          </button>
        </div>
      </div>

      {loading && <div className="grid grid-cols-1 sm:grid-cols-4 xl:grid-cols-7 gap-2">{Array.from({ length: 7 }, (_, i) => <div key={i} className="h-40 skeleton rounded-xl" />)}</div>}

      {!loading && mode === 'week' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
          {weekDays.map((d, i) => {
            const ds = dateStr(d);
            const dayPosts = postsByDate[ds] ?? [];
            const isToday = ds === todayStr();
            return (
              <div key={ds} className="space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? 'text-brand-600 dark:text-brand-300' : 'text-gray-500'}`}>
                    {DAY_LABELS[i]} {d.getDate()}
                  </p>
                  <button onClick={() => openNew(ds)} className="text-gray-300 hover:text-brand-500 transition-colors">
                    <Plus size={13} />
                  </button>
                </div>
                <div className="space-y-1.5 min-h-[50px]">
                  {dayPosts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setPostDrawer({ post: p, startEditing: false })}
                      className="w-full card p-2.5 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex items-center gap-1 mb-1 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_META[p.status].color }} />
                          <p className="text-[11px] font-medium truncate">{p.pillar ?? 'Untitled'}</p>
                        </div>
                        <EntryActions
                          onView={() => setPostDrawer({ post: p, startEditing: false })}
                          onEdit={() => setPostDrawer({ post: p, startEditing: true })}
                          canEdit
                        />
                      </div>
                      {p.format && <p className="text-[10px] text-gray-400">{p.format}</p>}
                      {p.boosted && <p className="text-[10px] text-orange-500 flex items-center gap-0.5 mt-0.5"><Zap size={9} /> Boosted</p>}
                    </div>
                  ))}
                  {dayPosts.length === 0 && (
                    <div className="h-10 rounded-lg border border-dashed border-gray-200 dark:border-white/10" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && mode === 'list' && posts.length === 0 && (
        <div className="card p-10 text-center">
          <ImageIcon size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[13px] text-gray-400">No posts planned yet.</p>
        </div>
      )}

      {!loading && mode === 'list' && posts.length > 0 && listView === 'cards' && (
        <div className="space-y-1.5">
          {posts.map((p) => (
            <div
              key={p.id}
              onClick={() => setPostDrawer({ post: p, startEditing: false })}
              className="w-full card p-3 flex items-center gap-3 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
            >
              <div className="text-center shrink-0 w-11">
                <p className="text-[10px] text-gray-400 uppercase">{new Date(p.post_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</p>
                <p className="text-[15px] font-bold leading-none">{new Date(p.post_date + 'T00:00:00').getDate()}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate">{p.pillar ?? 'Untitled'} {p.format ? `· ${p.format}` : ''}</p>
                <p className="text-[11px] text-gray-400 truncate">{p.platforms.join(', ') || 'No platform set'} {p.audience ? `· ${p.audience}` : ''}</p>
              </div>
              {p.boosted && <Zap size={13} className="text-orange-500 shrink-0" />}
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_META[p.status].bg}`}>{STATUS_META[p.status].label}</span>
              <EntryActions
                onView={() => setPostDrawer({ post: p, startEditing: false })}
                onEdit={() => setPostDrawer({ post: p, startEditing: true })}
                canEdit
              />
            </div>
          ))}
        </div>
      )}

      {!loading && mode === 'list' && posts.length > 0 && listView === 'table' && (
        <DataTable
          rows={posts}
          keyFn={(p) => p.id}
          onRowClick={(p) => setPostDrawer({ post: p, startEditing: false })}
          columns={[
            { header: 'Date', render: (p) => p.post_date },
            { header: 'Pillar', render: (p) => <span className="font-medium">{p.pillar ?? 'Untitled'}</span> },
            { header: 'Format', render: (p) => p.format ?? '—' },
            { header: 'Platforms', render: (p) => p.platforms.join(', ') || '—' },
            {
              header: 'Status',
              render: (p) => <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_META[p.status].bg}`}>{STATUS_META[p.status].label}</span>,
            },
            {
              header: '',
              className: 'text-right',
              render: (p) => (
                <EntryActions
                  onView={() => setPostDrawer({ post: p, startEditing: false })}
                  onEdit={() => setPostDrawer({ post: p, startEditing: true })}
                  canEdit
                />
              ),
            },
          ]}
        />
      )}

      {postDrawer && (
        <PostDrawer
          post={postDrawer.post}
          startEditing={postDrawer.startEditing}
          defaultDate={newPostDate}
          onClose={() => setPostDrawer(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof CalendarDays; label: string }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}

function PostDrawer({
  post,
  startEditing,
  defaultDate,
  onClose,
  onSaved,
}: {
  post: ContentPost | null;
  startEditing: boolean;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing);
  const [postDate, setPostDate] = useState(post?.post_date ?? defaultDate);
  const [platforms, setPlatforms] = useState<string[]>(post?.platforms ?? []);
  const [pillar, setPillar] = useState(post?.pillar ?? '');
  const [intent, setIntent] = useState(post?.intent ?? '');
  const [audience, setAudience] = useState(post?.audience ?? '');
  const [format, setFormat] = useState(post?.format ?? '');
  const [status, setStatus] = useState<ContentStatus>(post?.status ?? 'idea');
  const [boosted, setBoosted] = useState(post?.boosted ?? false);
  const [budget, setBudget] = useState(post?.budget?.toString() ?? '');
  const [caption, setCaption] = useState(post?.caption ?? '');
  const [performanceNotes, setPerformanceNotes] = useState(post?.performance_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const togglePlatform = (p: string) => {
    setPlatforms((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  };

  const save = async () => {
    if (!postDate) return;
    setSaving(true);
    setError('');
    const payload = {
      post_date: postDate,
      platforms,
      pillar: pillar || null,
      intent: intent || null,
      audience: audience || null,
      format: format || null,
      status,
      boosted,
      budget: boosted && budget ? Number(budget) : null,
      caption: caption.trim() || null,
      performance_notes: performanceNotes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = post
      ? await supabase.from('content_calendar').update(payload).eq('id', post.id)
      : await supabase.from('content_calendar').insert({ ...payload, created_by: profile!.id });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!post) return;
    setSaving(true);
    await supabase.from('content_calendar').delete().eq('id', post.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={post ? (post.pillar ?? 'Post') : 'New Post'} subtitle="Plan the content, not just the date" maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Date</label>
            <input type="date" value={postDate} onChange={(e) => setPostDate(e.target.value)} disabled={!editing} className="input" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as ContentStatus)} disabled={!editing} className="input">
              {(Object.keys(STATUS_META) as ContentStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Platforms</label>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={!editing}
                onClick={() => togglePlatform(p)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-60 ${platforms.includes(p) ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><Rocket size={11} /> Pillar</label>
            <select value={pillar} onChange={(e) => setPillar(e.target.value)} disabled={!editing} className="input">
              <option value="">Select</option>
              {PILLARS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={!editing} className="input">
              <option value="">Select</option>
              {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Intent</label>
            <select value={intent} onChange={(e) => setIntent(e.target.value)} disabled={!editing} className="input">
              <option value="">Select</option>
              {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Audience</label>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} disabled={!editing} className="input">
              <option value="">Select</option>
              {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-[12px] font-medium text-gray-500 mb-1.5">
            <input type="checkbox" checked={boosted} onChange={(e) => setBoosted(e.target.checked)} disabled={!editing} className="rounded" />
            Boosted post
          </label>
          {boosted && (
            <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} disabled={!editing} placeholder="Budget (RWF)" className="input" />
          )}
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Caption</label>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Mwaramutse! Beyond Transport. Into the Future." />
        </div>

        {status === 'posted' && (
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Performance notes</label>
            <textarea value={performanceNotes} onChange={(e) => setPerformanceNotes(e.target.value)} disabled={!editing} rows={2} className="input resize-none" placeholder="Reach, engagement, saves…" />
          </div>
        )}

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {post ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (post ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !postDate} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : post ? 'Save Changes' : 'Add Post'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
              <Pencil size={13} /> Edit
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
