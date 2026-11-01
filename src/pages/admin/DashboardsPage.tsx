import { useEffect, useMemo, useState } from 'react';
import { Eye, History, Search, UserRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { usePageTitle } from '../../os/workspace';
import { EmptyState, Label, PageHeader } from '../../ui/kit';

// Admin > Open a dashboard (/admin/dashboards, MD): open anyone's Kivu Daily
// exactly as they see it - their menu, home, pages and tasks - and use it,
// to improve their dashboards. What the MD does there is done and recorded
// as the MD (migration 20261101210000, lib/viewAsStore.ts). Below: every
// visit and each change made in it.

interface Person { id: string; full_name: string; role: string; responsibility_label: string | null; department: { slug: string; name: string } | null }
interface Visit { id: string; target_id: string; started_at: string; last_at: string; ended_at: string | null }
interface Action { id: number; session_id: string; at: string; kind: string; target: string; status: number | null; detail: string | null }

const ORDER = ['finance', 'fleet', 'it', 'call_center'];
const KIND_LABEL: Record<string, string> = { add: 'Added', change: 'Changed', delete: 'Deleted', action: 'Did', function: 'Ran', blocked: 'Stopped' };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Kigali', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const minutes = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
const readable = (t: string) => t.replace(/_/g, ' ');

export default function DashboardsPage() {
  usePageTitle('Open a dashboard');
  const { openDashboard } = useAuth();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, full_name, role, responsibility_label, department:departments(slug, name)').eq('is_active', true).neq('role', 'managing_director'),
      supabase.from('view_as_sessions').select('id, target_id, started_at, last_at, ended_at').order('started_at', { ascending: false }).limit(40),
    ]).then(async ([p, v]) => {
      setPeople(((p.data ?? []) as unknown as Person[]).map((x) => ({ ...x, full_name: x.full_name.trim() })));
      const list = (v.data ?? []) as Visit[];
      setVisits(list);
      if (list.length) {
        const { data } = await supabase.from('view_as_actions').select('*').in('session_id', list.map((x) => x.id)).order('at');
        setActions((data ?? []) as Action[]);
      }
    });
  }, []);

  const go = async (id: string) => {
    setBusy(id); setErr(null);
    const e = await openDashboard(id);
    if (e) { setErr(e); setBusy(null); }
  };

  const term = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const shown = (people ?? []).filter((p) => !term || [p.full_name, p.responsibility_label, p.department?.name].join(' ').toLowerCase().includes(term));
    const slugs = [...new Set(shown.map((p) => p.department?.slug ?? 'other'))].sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);
    return slugs.map((slug) => ({ slug, name: shown.find((p) => (p.department?.slug ?? 'other') === slug)?.department?.name ?? 'No department', list: shown.filter((p) => (p.department?.slug ?? 'other') === slug).sort((a, b) => a.full_name.localeCompare(b.full_name)) }));
  }, [people, term]);
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.full_name ?? 'Someone who left';

  return (
    <div className="space-y-4">
      <PageHeader icon={Eye} title="Open a dashboard" subtitle="See Kivu Daily exactly as someone sees it, and use it. What you do there is done and recorded as you, not as them." />

      <div className="card p-3 text-small text-fg-muted space-y-1">
        <p>You get their menu, home page, tasks and pages, with what they are allowed to do. An amber bar stays at the bottom while you are in; <b>Exit</b> brings you back here.</p>
        <p>Every change you make there is listed under "Visits" below and in the activity log as you ("in their dashboard"). You can't start or end a Call Center shift, confirm IT work or decline a meeting for them: those would be done for you.</p>
      </div>

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, a role or a department" className="input pl-9" aria-label="Search people" />
      </div>
      {err && <p className="text-small text-danger">{err}</p>}

      {!people ? <div className="h-40 skeleton rounded-card" /> : groups.length === 0 ? <EmptyState icon={UserRound} title="Nobody matches" body="Try another name." /> : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.slug}>
              <h2 className="section-title mb-2">{g.name} <span className="text-fg-subtle font-normal">· {g.list.length}</span></h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {g.list.map((p) => (
                  <div key={p.id} className="card p-3 flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-full bg-inset flex items-center justify-center shrink-0 text-small font-semibold">{p.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{p.full_name}</p>
                      <p className="text-caption text-fg-muted truncate">{p.responsibility_label || g.name}</p>
                    </div>
                    <button className="btn-primary h-8 px-3 shrink-0" disabled={busy !== null} onClick={() => go(p.id)}>{busy === p.id ? 'Opening…' : 'Open'}</button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <section className="card p-3">
        <p className="text-body font-semibold flex items-center gap-1.5 mb-2"><History size={14} /> Visits</p>
        {visits.length === 0 ? <p className="text-small text-fg-muted">No visits yet.</p> : (
          <ul className="divide-y divide-line-muted">
            {visits.map((v) => {
              const mine = actions.filter((x) => x.session_id === v.id);
              const changes = mine.filter((x) => x.kind !== 'blocked');
              return (
                <li key={v.id} className="py-2">
                  <button className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-left text-small" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}>
                    <span className="font-medium">{nameOf(v.target_id)}</span>
                    <span className="text-fg-muted">{when(v.started_at)} · {minutes(v.started_at, v.ended_at ?? v.last_at)} min{v.ended_at ? '' : ' · still open or not exited'}</span>
                    <span className="ml-auto">{changes.length ? <Label tone="accent">{changes.length} change{changes.length === 1 ? '' : 's'}</Label> : <span className="text-fg-subtle">Looked only</span>}</span>
                  </button>
                  {open === v.id && (
                    mine.length === 0 ? <p className="mt-1.5 text-caption text-fg-muted">Nothing was changed in this visit.</p> : (
                      <ul className="mt-1.5 space-y-1 text-caption">
                        {mine.map((x) => (
                          <li key={x.id} className="flex gap-2">
                            <span className="text-fg-subtle tabular-nums shrink-0">{new Date(x.at).toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                            <span className="min-w-0">
                              <b className={x.kind === 'blocked' || (x.status ?? 0) >= 400 ? 'text-danger' : ''}>{KIND_LABEL[x.kind] ?? x.kind}</b> {readable(x.target)}
                              {(x.status ?? 0) >= 400 && x.kind !== 'blocked' ? <span className="text-danger"> (failed)</span> : null}
                              {x.detail ? <span className="block text-fg-subtle break-all">{x.detail}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
