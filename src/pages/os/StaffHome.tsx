import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Clock, Flame, Headphones, ListTodo, Rocket, Sparkles, Target, X, Zap } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useTasks, computeStreak, dailyCompletionMap } from '../../lib/hooks';
import { formatDateFull, greeting } from '../../lib/utils';
import { useAccess } from '../../os/access';
import { useBadges } from '../../os/badges';
import { MODULES, visiblePages } from '../../os/registry';
import { Ring } from '../../os/shell/Shell';
import { Box, Counter, Label, StatCard, StatGrid } from '../../ui/kit';
import { addDays, today } from '../../lib/performance';

// Everyone's home: what to start with, today's tasks (smart ones show their
// progress), your rhythm, cases waiting on you, and your department's pages.
export default function StaffHome() {
  const { profile } = useAuth();
  const access = useAccess();
  const badges = useBadges(access);
  const { tasks } = useTasks(profile?.id);
  const [hideNews, setHideNews] = useState(() => { try { return localStorage.getItem('kivu-os-news-seen') === '1'; } catch { return false; } });
  const t = today();
  const mine = tasks.filter((x) => x.date === t);
  const open = mine.filter((x) => !x.completed).sort((a, b) => (a.priority === 'high' ? 0 : a.smart_key ? 1 : 2) - (b.priority === 'high' ? 0 : b.smart_key ? 1 : 2) || (a.due_time ?? '99').localeCompare(b.due_time ?? '99'));
  const done = mine.filter((x) => x.completed);
  const pct = mine.length ? Math.round((done.length / mine.length) * 100) : 0;
  const streak = computeStreak(tasks);
  const map = dailyCompletionMap(tasks);
  const last14 = Array.from({ length: 14 }, (_, i) => map[addDays(t, i - 13)]?.completed ?? 0);
  const last30 = Array.from({ length: 30 }, (_, i) => map[addDays(t, i - 29)]).filter(Boolean);
  const rate30 = last30.reduce((s, d) => s + d!.total, 0) ? Math.round((last30.reduce((s, d) => s + d!.completed, 0) / last30.reduce((s, d) => s + d!.total, 0)) * 100) : null;
  const first = open[0];
  const focus = first
    ? <>Start with <b>{first.title.charAt(0).toLowerCase() + first.title.slice(1)}</b>{first.due_time ? <> before <b>{first.due_time.slice(0, 5)}</b></> : null}.{open.length > 1 ? ` Then ${open.length - 1} more.` : ''}</>
    : mine.length ? <>Everything for today is done. Well done.</> : <>Nothing is on your list today.</>;
  const workModules = MODULES.filter((m) => !['home', 'me', 'docs', 'admin'].includes(m.id)).map((m) => ({ m, pages: visiblePages(m, access) })).filter((x) => x.pages.length);

  return (
    <div className="animate-fade-in space-y-4">
      {!hideNews && (
        <div className="card p-3 flex items-center gap-3 border-accent/40 bg-accent/5">
          <Rocket size={18} className="text-accent-fg shrink-0" />
          <p className="text-body flex-1">Kivu Daily has a new look: search anything with <span className="kbd">Ctrl K</span>, open several pages as tabs, and click any name to see everything about it.</p>
          <Link to="/docs/whats-new" className="btn-secondary">See what's new</Link>
          <button onClick={() => { setHideNews(true); try { localStorage.setItem('kivu-os-news-seen', '1'); } catch { /* ignore */ } }} className="btn-ghost p-1.5" aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      <section className="card p-5 flex flex-wrap items-center gap-5">
        <Ring pct={pct} size={76} />
        <div className="flex-1 min-w-[220px]">
          <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">{formatDateFull(new Date())}</p>
          <h1 className="text-h2 font-semibold mt-0.5">{greeting()}, {profile?.full_name.trim()}</h1>
          <p className="text-body text-fg-muted mt-1">{focus}</p>
        </div>
        <Link to="/me/tasks" className="btn-primary"><ListTodo size={14} /> Open my tasks</Link>
      </section>

      <StatGrid cols={4}>
        <StatCard to="/me/tasks" icon={ListTodo} label="Today" value={`${done.length}/${mine.length}`} sub={open.filter((x) => x.priority === 'high').length ? `${open.filter((x) => x.priority === 'high').length} urgent left` : 'Nothing urgent left'} tone={open.some((x) => x.priority === 'high') ? 'attention' : undefined} />
        <StatCard to="/me/analytics" icon={Target} label="Done (30 days)" value={rate30 === null ? '—' : `${rate30}%`} spark={last14} sub="Tasks done per day, last 2 weeks" />
        <StatCard to="/me/analytics" icon={Flame} label="Streak" value={`${streak} day${streak === 1 ? '' : 's'}`} sub="Days in a row with everything done" />
        <StatCard to="/me/cases" icon={Headphones} label="Cases for me" value={badges.myCases ?? 0} tone={(badges.myCases ?? 0) ? 'attention' : undefined} sub="Callers the Call Center handed you" />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Box title="What needs you today" icon={Sparkles} className="xl:col-span-2" padded={false} right={<Link to="/me/tasks" className="text-caption link">All tasks</Link>}>
          {mine.length === 0 ? <p className="p-6 text-center text-body text-fg-muted">No tasks today.</p> : (
            <ul className="divide-y divide-line-muted">
              {[...open, ...done].map((x) => (
                <li key={x.id}>
                  <Link to="/me/tasks" className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/60">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${x.completed ? 'bg-success border-success text-white' : 'border-line-strong'}`}>{x.completed && <Check size={10} />}</span>
                    <span className={`flex-1 min-w-0 text-body truncate ${x.completed ? 'line-through text-fg-subtle' : ''}`}>{x.title}</span>
                    {x.smart_key && (x.smart_total ?? 0) > 1 && (
                      <span className="hidden sm:flex items-center gap-1.5 text-caption text-fg-muted"><Zap size={11} className="text-done" />
                        <span className="w-16 h-1.5 rounded-full bg-inset overflow-hidden"><span className="block h-full bg-done" style={{ width: `${((x.smart_done ?? 0) / (x.smart_total ?? 1)) * 100}%` }} /></span>{x.smart_done ?? 0}/{x.smart_total}
                      </span>
                    )}
                    {!x.completed && x.priority === 'high' && <Label tone="danger">Urgent</Label>}
                    {x.due_time && !x.completed && <span className="text-caption text-fg-muted flex items-center gap-1"><Clock size={11} />{x.due_time.slice(0, 5)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Box>
        <Box title="Your areas" icon={ArrowRight} padded={false}>
          <div className="divide-y divide-line-muted">
            {workModules.length === 0 && <p className="p-4 text-body text-fg-muted">Your department's pages appear here.</p>}
            {workModules.map(({ m, pages }) => (
              <div key={m.id} className="p-3">
                <p className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-fg-subtle flex items-center gap-1.5"><m.icon size={12} /> {m.label}</p>
                {pages.filter((p, i, arr) => arr.findIndex((x) => x.path === p.path) === i).map((p) => (
                  <Link key={p.id} to={p.path} className="nav-item text-body">
                    <p.icon size={15} /><span className="flex-1">{p.label}</span>{p.badge && (badges[p.badge] ?? 0) > 0 && <Counter n={badges[p.badge]!} tone="danger" />}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </Box>
      </div>
    </div>
  );
}
