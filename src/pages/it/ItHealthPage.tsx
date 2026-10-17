import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, Bug, Car, Clock, ExternalLink, GitBranch, GitPullRequest, HeartPulse, Loader2, Plus, RefreshCw, Settings, Sparkles, Timer, Users2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { ItIssue, ago, keyOf, useItData, when } from '../../lib/it';
import {
  ErrorExplained, Health, HealthSettings, SentryIssue, SentryProject, askAi, pctOf, refreshHealth, useAiStatus, useHealth,
} from '../../lib/itHealth';
import { usePageTitle } from '../../os/workspace';
import { Box, Label, PageHeader, StatCard, StatGrid, UnderlineTabs } from '../../ui/kit';
import { ChartCard, DailyBars, DailyLines, RangeTabs, RankBars, usePalette } from '../../components/charts/kit';
import { IssueFormModal } from '../../components/it/ItModals';

// IT & Product phase 4: product health - trips, app errors (Sentry), code
// activity (GitHub) - with the thresholds and connections in Settings.

type Tab = 'trips' | 'errors' | 'code' | 'settings';
const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5';
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;

export function ItHealth() {
  usePageTitle('Health');
  const { profile } = useAuth();
  const data = useItData();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'trips';
  const [days, setDays] = useState(14);
  const h = useHealth(days);
  const member = data.members.find((m) => m.profile_id === profile?.id);
  const isLead = profile?.role === 'managing_director' || member?.role === 'head' || member?.role === 'md';
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  if (h.loading || data.loading || !h.settings) return <Loading />;
  const refresh = async () => { setRefreshing(true); setError(''); const err = await refreshHealth(); setRefreshing(false); if (err) setError(err); h.reload(); };
  const sentryOn = !!h.settings.sentry_org && h.settings.sentry_projects.length > 0;
  const githubOn = h.settings.github_repos.length > 0;
  return (
    <div className="animate-fade-in">
      <PageHeader icon={HeartPulse} title="Health" subtitle="Is the product working for riders and drivers? Trips, app errors and code activity, against the goals set in Settings."
        actions={isLead && (tab === 'errors' || tab === 'code') && <button onClick={refresh} disabled={refreshing} className="btn-secondary">{refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh now</button>} />
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
      <UnderlineTabs<Tab> value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { key: 'trips', label: 'Trips', icon: Car }, { key: 'errors', label: 'App errors', icon: Bug }, { key: 'code', label: 'Code', icon: GitBranch }, { key: 'settings', label: 'Settings', icon: Settings },
      ]} right={tab === 'trips' && <RangeTabs value={days} onChange={setDays} options={[{ v: 7, label: '7 days' }, { v: 14, label: '14 days' }, { v: 30, label: '30 days' }]} />} />
      {tab === 'trips' && <TripsTab h={h} days={days} />}
      {tab === 'errors' && (sentryOn ? <ErrorsTab h={h} data={data} isLead={isLead} me={profile?.id ?? ''} /> : <Connect what="Sentry" onSettings={() => setParams({ tab: 'settings' })} />)}
      {tab === 'code' && (githubOn ? <CodeTab h={h} data={data} /> : <Connect what="GitHub" onSettings={() => setParams({ tab: 'settings' })} />)}
      {tab === 'settings' && <SettingsTab h={h} data={data} isLead={isLead} />}
    </div>
  );
}

function Connect({ what, onSettings }: { what: 'Sentry' | 'GitHub'; onSettings: () => void }) {
  return (
    <div className="card p-6 max-w-2xl">
      <p className="text-body font-semibold mb-1">{what} isn't connected yet</p>
      <p className="text-small text-fg-muted mb-3">{what === 'Sentry' ? 'Once connected, this shows crash-free sessions per day, how many errors are open, new errors in the last 24 hours and the top errors — each one can become an issue in one click, or be explained by AI.' : 'Once connected, this shows commits per developer and repository, open and merged pull requests, and which commits mention an issue (KR-123) — those also appear in the issue\'s activity.'}</p>
      <button onClick={onSettings} className="btn-primary"><Settings size={14} /> How to connect</button>
    </div>
  );
}

// ------------------------------------------------------------ trips
function TripsTab({ h, days }: { h: Health; days: number }) {
  const c = usePalette();
  const s = h.settings!;
  const t = h.trips;
  if (!t || !t.totals) return <p className="text-small text-fg-muted">No trip data.</p>;
  const tot = t.totals;
  const done = pctOf(tot.completed, tot.requested), lost = pctOf(tot.no_driver, tot.requested), cancelled = pctOf(tot.cancelled_after_accept, tot.requested);
  const rows = t.days.map((d) => ({ day: d.day, completed: d.completed, no_driver: d.no_driver, cancelled: d.cancelled_after_accept, done_pct: pctOf(d.completed, d.requested), lost_pct: pctOf(d.no_driver, d.requested) }));
  const busyHours = t.hours.filter((x) => x.requested).map((x) => x.hour);
  const hours = busyHours.length ? Array.from({ length: Math.max(...busyHours) - Math.min(...busyHours) + 1 }, (_, k) => { const hr = Math.min(...busyHours) + k; const x = t.hours.find((y) => y.hour === hr); return { hour: String(hr), requested: x?.requested ?? 0, no_driver: x?.no_driver ?? 0 }; }) : [];
  const worst = [...t.hours].filter((x) => x.requested >= 3).sort((a, b) => b.no_driver / b.requested - a.no_driver / a.requested)[0];
  return (
    <>
      <StatGrid cols={5}>
        <StatCard icon={Car} label={`Requests · ${days} days`} value={tot.requested} sub={`${Math.round(tot.requested / days)} a day`} />
        <StatCard icon={Activity} label="Completed" value={done === null ? '—' : `${done}%`} sub={`goal ≥ ${Number(s.min_completion_pct)}% · ${tot.completed} trips`} tone={done !== null && done < Number(s.min_completion_pct) ? 'danger' : 'success'} />
        <StatCard icon={AlertTriangle} label="No driver found" value={lost === null ? '—' : `${lost}%`} sub={`goal ≤ ${Number(s.max_no_driver_pct)}% · ${tot.no_driver} riders lost`} tone={lost !== null && lost > Number(s.max_no_driver_pct) ? 'danger' : undefined} />
        <StatCard icon={Timer} label="Time to accept" value={tot.accept_median_s === null ? '—' : `${tot.accept_median_s} s`} sub={`median, app requests · goal ≤ ${Number(s.max_accept_seconds)} s`} tone={tot.accept_median_s !== null && tot.accept_median_s > Number(s.max_accept_seconds) ? 'attention' : undefined} />
        <StatCard icon={Clock} label="Pickup time" value={tot.pickup_avg_min === null ? '—' : `${tot.pickup_avg_min} min`} sub={`accept → trip start · goal ≤ ${Number(s.max_pickup_minutes)} min`} tone={tot.pickup_avg_min !== null && tot.pickup_avg_min > Number(s.max_pickup_minutes) ? 'attention' : undefined} />
      </StatGrid>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <ChartCard title="What happened to each request" subtitle={`${cancelled ?? 0}% were cancelled after a driver accepted (the platform doesn't say by whom yet).`}
          legend={[{ key: 'completed', label: 'Completed', color: c.aqua }, { key: 'no_driver', label: 'No driver found', color: c.orange }, { key: 'cancelled', label: 'Cancelled after accept', color: c.yellow }]}>
          <DailyBars data={rows} c={c} series={[{ key: 'completed', label: 'Completed', color: c.aqua }, { key: 'no_driver', label: 'No driver found', color: c.orange }, { key: 'cancelled', label: 'Cancelled after accept', color: c.yellow }]} />
        </ChartCard>
        <ChartCard title="Completed and lost, % of requests" subtitle={`Goals: completed ≥ ${Number(s.min_completion_pct)}%, no driver ≤ ${Number(s.max_no_driver_pct)}%.`}
          legend={[{ key: 'done_pct', label: 'Completed %', color: c.aqua }, { key: 'lost_pct', label: 'No driver %', color: c.orange }]}>
          <DailyLines data={rows} c={c} domain={[0, 100]} format={(n) => `${n}%`} series={[{ key: 'done_pct', label: 'Completed %', color: c.aqua }, { key: 'lost_pct', label: 'No driver %', color: c.orange }]} />
        </ChartCard>
      </div>
      <ChartCard title="When riders find no driver" subtitle={worst ? `Worst hour: ${worst.hour}:00 — ${Math.round((worst.no_driver / worst.requested) * 100)}% of ${worst.requested} requests found no driver. More drivers online then would win those trips.` : 'Requests by hour of the day (Kigali).'}
        legend={[{ key: 'requested', label: 'Requests', color: c.blue }, { key: 'no_driver', label: 'No driver found', color: c.orange }]}>
        <DailyBars data={hours} c={c} stacked={false} xKey="hour" xFormat={(x) => `${x}h`} tipTitle={(x) => `${x}:00 – ${x}:59`} series={[{ key: 'requested', label: 'Requests', color: c.blue }, { key: 'no_driver', label: 'No driver found', color: c.orange }]} />
      </ChartCard>
    </>
  );
}

// ------------------------------------------------------------ Sentry
function ErrorsTab({ h, data, isLead, me }: { h: Health; data: ReturnType<typeof useItData>; isLead: boolean; me: string }) {
  const c = usePalette();
  const ai = useAiStatus();
  const snap = h.sentry;
  const [explained, setExplained] = useState<Record<string, ErrorExplained | 'busy' | string>>({});
  const [newIssue, setNewIssue] = useState<Partial<ItIssue> | null>(null);
  if (!snap) return <p className="text-small text-fg-muted">Connected, waiting for the first read (every hour at :07). Press Refresh now to read it immediately.</p>;
  const min = Number(h.settings!.min_crash_free_pct);
  const explain = async (i: SentryIssue) => {
    setExplained((x) => ({ ...x, [i.id]: 'busy' }));
    try { const r = await askAi<ErrorExplained>('explain_error', { error: { title: i.title, culprit: i.culprit, level: i.level, events: i.count, users: i.users, firstSeen: i.firstSeen, lastSeen: i.lastSeen } }); setExplained((x) => ({ ...x, [i.id]: r })); }
    catch (e) { setExplained((x) => ({ ...x, [i.id]: e instanceof Error ? e.message : 'Failed' })); }
  };
  const toIssue = (i: SentryIssue) => {
    const ex = explained[i.id];
    const smart = typeof ex === 'object' ? ex : null;
    setNewIssue({ type: 'bug', title: smart?.suggested_title || i.title.slice(0, 120), areas: smart?.likely_area ? [smart.likely_area] : [], priority: i.users >= 10 ? 'p1' : 'p2',
      description: `Sentry ${i.shortId}: ${i.title}\n${i.culprit ?? ''}\n${i.count} events, ${i.users} users, last seen ${when(i.lastSeen)}.\n${i.url}${smart ? `\n\n${smart.explanation}` : ''}`,
      acceptance_criteria: [{ text: `No new ${i.shortId} events in Sentry for 7 days after the fix is released`, done: false }] });
  };
  return (
    <>
      <p className="text-caption text-fg-muted mb-3">Read {ago(snap.taken_at)}{!snap.ok && snap.error ? <span className="text-danger"> · {snap.error}</span> : snap.error ? <span className="text-attention"> · {snap.error}</span> : null}</p>
      {(snap.data?.projects ?? []).map((p: SentryProject) => {
        if (!p.ok) return <Box key={p.slug} title={p.slug} className="mb-4"><p className="text-small text-danger">{p.error}</p></Box>;
        const cf = p.sessions?.totals.crashFreeSessions ?? null;
        const series = p.sessions ? p.sessions.days.map((d, k) => ({ day: d, sessions: p.sessions!.crashFreeSessions[k] === null ? null : Math.round((p.sessions!.crashFreeSessions[k] as number) * 10000) / 100, users: p.sessions!.crashFreeUsers[k] === null ? null : Math.round((p.sessions!.crashFreeUsers[k] as number) * 10000) / 100 })) : [];
        return (
          <section key={p.slug} className="mb-6">
            <h2 className="section-title mb-2">{p.name ?? p.slug} <span className="text-caption text-fg-muted font-normal">{p.platform}</span></h2>
            <StatGrid cols={4}>
              <StatCard icon={HeartPulse} label="Crash-free sessions" value={cf === null ? '—' : `${(cf * 100).toFixed(2)}%`} sub={cf === null ? 'No session data for this project' : `14 days · goal ≥ ${min}%`} tone={cf !== null && cf * 100 < min ? 'danger' : cf !== null ? 'success' : undefined} />
              <StatCard icon={Users2} label="Crash-free users" value={p.sessions?.totals.crashFreeUsers == null ? '—' : `${(p.sessions.totals.crashFreeUsers * 100).toFixed(2)}%`} sub={p.sessions ? `${p.sessions.totals.sessions.toLocaleString()} sessions` : ''} />
              <StatCard icon={Bug} label="Open errors" value={p.unresolved ?? 0} sub="unresolved in Sentry" />
              <StatCard icon={AlertTriangle} label="New in 24 h" value={p.new24h ?? 0} tone={(p.new24h ?? 0) > 0 ? 'attention' : undefined} sub="first seen in the last day" />
            </StatGrid>
            {series.length > 0 && (
              <div className="mb-4"><ChartCard title="Crash-free, per day" legend={[{ key: 'sessions', label: 'Sessions', color: c.aqua }, { key: 'users', label: 'Users', color: c.blue }]}>
                <DailyLines data={series} c={c} height={180} format={(n) => `${n}%`} domain={[Math.max(0, Math.floor(Math.min(...series.map((x) => x.sessions ?? 100), min) - 1)), 100]} series={[{ key: 'sessions', label: 'Sessions', color: c.aqua }, { key: 'users', label: 'Users', color: c.blue }]} />
              </ChartCard></div>
            )}
            <Box title="Top errors (14 days)" icon={Bug} padded={false}>
              <ul className="divide-y divide-line-muted">
                {(p.top ?? []).map((i) => {
                  const ex = explained[i.id];
                  return (
                    <li key={i.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label tone={i.level === 'fatal' || i.level === 'error' ? 'danger' : 'attention'}>{i.level}</Label>
                        <a href={i.url} target="_blank" rel="noreferrer" className="flex-1 min-w-[220px] text-body font-medium hover:underline">{i.title} <ExternalLink size={11} className="inline" /></a>
                        <span className="text-caption text-fg-muted tabular-nums">{i.count.toLocaleString()} events · {i.users} users · last {ago(i.lastSeen)}</span>
                        {ai.data?.configured && <button onClick={() => explain(i)} disabled={ex === 'busy'} className="btn-ghost text-caption">{ex === 'busy' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Explain</button>}
                        {isLead && <button onClick={() => toIssue(i)} className="btn-ghost text-caption"><Plus size={12} /> Make an issue</button>}
                      </div>
                      {i.culprit && <p className="text-caption text-fg-muted font-mono truncate">{i.culprit}</p>}
                      {typeof ex === 'object' && (
                        <div className="mt-2 rounded-md bg-inset px-3 py-2 text-small">
                          <p>{ex.explanation}</p>
                          {ex.first_steps.length > 0 && <ol className="list-decimal ml-5 mt-1 text-caption">{ex.first_steps.map((s, k) => <li key={k}>{s}</li>)}</ol>}
                          <p className="text-micro text-fg-subtle mt-1">AI suggestion{ex.likely_area ? ` · area: ${data.areaLabel(ex.likely_area)}` : ''} — check before acting.</p>
                        </div>
                      )}
                      {typeof ex === 'string' && ex !== 'busy' && <p className="mt-1 text-caption text-danger">{ex}</p>}
                    </li>
                  );
                })}
                {!(p.top ?? []).length && <li className="px-4 py-6 text-center text-small text-fg-muted">No open errors.</li>}
              </ul>
            </Box>
          </section>
        );
      })}
      {newIssue && <IssueFormModal data={data} issue={null} isLead={isLead} me={me} defaults={newIssue} onClose={() => setNewIssue(null)} onSaved={() => data.reload()} />}
    </>
  );
}

// ------------------------------------------------------------ GitHub
function CodeTab({ h, data }: { h: Health; data: ReturnType<typeof useItData> }) {
  const c = usePalette();
  const snap = h.github;
  const loginOf = useMemo(() => new Map(data.members.map((m) => [m.profile_id, m.name])), [data.members]);
  if (!snap) return <p className="text-small text-fg-muted">Connected, waiting for the first read (every hour at :07). Press Refresh now to read it immediately.</p>;
  const repos = snap.data?.repos ?? [];
  const byPerson = new Map<string, number>();
  for (const cm of h.commits) { const k = cm.profile_id ? loginOf.get(cm.profile_id) ?? cm.author_login ?? '?' : `${cm.author_login ?? cm.author_name ?? '?'} (not linked)`; byPerson.set(k, (byPerson.get(k) ?? 0) + 1); }
  const unlinked = [...new Set(h.commits.filter((x) => !x.profile_id && x.author_login).map((x) => x.author_login!))];
  const total = h.commits.length, withIssue = h.commits.filter((x) => x.issue_ids.length).length;
  const open = repos.flatMap((r) => (r.open ?? []).map((p) => ({ ...p, repo: r.repo }))).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const merged = repos.reduce((s, r) => s + (r.merged?.length ?? 0), 0);
  const ageDays = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return (
    <>
      <p className="text-caption text-fg-muted mb-3">Read {ago(snap.taken_at)} · default branches, last 14 days{snap.error ? <span className="text-danger"> · {snap.error}</span> : null}</p>
      <StatGrid cols={4}>
        <StatCard icon={GitBranch} label="Commits" value={total} sub={`${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}`} />
        <StatCard label="Linked to an issue" value={total ? `${pctOf(withIssue, total)}%` : '—'} sub="mention KR-123 in the message" tone={total && (pctOf(withIssue, total) ?? 0) < 50 ? 'attention' : undefined} />
        <StatCard icon={GitPullRequest} label="Open pull requests" value={open.length} sub={`${open.filter((p) => ageDays(p.created_at) >= 3).length} waiting 3+ days`} tone={open.some((p) => ageDays(p.created_at) >= 3) ? 'attention' : undefined} />
        <StatCard label="Merged" value={merged} sub="pull requests, 14 days" />
      </StatGrid>
      {unlinked.length > 0 && <p className="mb-3 text-caption rounded-md bg-attention-muted px-3 py-2">GitHub users not linked to anyone in IT: <b>{unlinked.join(', ')}</b>. Add their GitHub usernames in Settings so their commits count for them.</p>}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Box title="Commits by person" icon={Users2}><RankBars rows={[...byPerson.entries()].map(([k, n]) => ({ key: k, label: k, n })).sort((a, b) => b.n - a.n)} color={c.blue} empty="No commits in 14 days." /></Box>
        <Box title="By repository" icon={GitBranch}><RankBars rows={repos.map((r) => ({ key: r.repo, label: r.repo, n: r.commits14 ?? 0, sub: r.ok ? undefined : r.error }))} color={c.violet} /></Box>
        <Box title="Open pull requests" icon={GitPullRequest} padded={false}>
          {open.length ? <ul className="divide-y divide-line-muted">{open.map((p) => (
            <li key={`${p.repo}-${p.number}`} className="px-4 py-2 text-small"><a href={p.url} target="_blank" rel="noreferrer" className="hover:underline font-medium">#{p.number} {p.title}</a>
              <p className="text-caption text-fg-muted">{p.repo} · {p.author} · <span className={ageDays(p.created_at) >= 3 ? 'text-attention' : ''}>{ageDays(p.created_at)} d old</span>{p.draft ? ' · draft' : ''}</p></li>
          ))}</ul> : <p className="p-5 text-small text-fg-muted">None open.</p>}
        </Box>
      </div>
      <Box title="Recent commits" icon={GitBranch} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-body min-w-[700px]">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['When', 'Who', 'Repository', 'Message', 'Issue'].map((x) => <th key={x} className={th}>{x}</th>)}</tr></thead>
            <tbody>{h.commits.slice(0, 40).map((cm) => (
              <tr key={`${cm.repo}-${cm.sha}`} className="border-t border-line-muted">
                <td className={`${td} text-caption whitespace-nowrap`}>{when(cm.committed_at)}</td>
                <td className={`${td} text-caption`}>{cm.profile_id ? data.nameOf(cm.profile_id).split(' ')[0] : cm.author_login ?? cm.author_name}</td>
                <td className={`${td} text-caption text-fg-muted`}>{cm.repo.split('/')[1] ?? cm.repo}</td>
                <td className={`${td} max-w-[420px] truncate`}>{cm.url ? <a href={cm.url} target="_blank" rel="noreferrer" className="hover:underline">{(cm.message ?? '').split('\n')[0]}</a> : (cm.message ?? '').split('\n')[0]}</td>
                <td className={`${td} text-caption`}>{cm.issue_ids.map((id) => <Link key={id} to={`/product/issues?issue=${id}`} className="link mr-1">{keyOf(id)}</Link>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Box>
    </>
  );
}

// ------------------------------------------------------------ settings
function SettingsTab({ h, data, isLead }: { h: Health; data: ReturnType<typeof useItData>; isLead: boolean }) {
  const s = h.settings!;
  const ai = useAiStatus();
  const [f, setF] = useState({
    sentry_base_url: s.sentry_base_url, sentry_org: s.sentry_org ?? '', sentry_projects: s.sentry_projects.join(', '), github_repos: s.github_repos.join(', '),
    min_completion_pct: String(s.min_completion_pct), max_no_driver_pct: String(s.max_no_driver_pct), max_accept_seconds: String(s.max_accept_seconds),
    max_pickup_minutes: String(s.max_pickup_minutes), min_crash_free_pct: String(s.min_crash_free_pct),
  });
  const [logins, setLogins] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('it_members').select('profile_id, github_login').then(({ data: rows }) => setLogins(Object.fromEntries(((rows ?? []) as { profile_id: string; github_login: string | null }[]).map((r) => [r.profile_id, r.github_login ?? '']))));
  }, []);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const list = (v: string) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    const repos = list(f.github_repos).map((r) => r.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, ''));
    if (repos.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r))) { setMsg('Repositories are written owner/name, e.g. kivuride/rider-app.'); return; }
    setBusy(true); setMsg('');
    const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : d);
    const { error } = await supabase.from('it_health_settings').update({
      sentry_base_url: f.sentry_base_url.trim() || 'https://sentry.io', sentry_org: f.sentry_org.trim() || null, sentry_projects: list(f.sentry_projects), github_repos: repos,
      min_completion_pct: num(f.min_completion_pct, 60), max_no_driver_pct: num(f.max_no_driver_pct, 20), max_accept_seconds: num(f.max_accept_seconds, 60),
      max_pickup_minutes: num(f.max_pickup_minutes, 10), min_crash_free_pct: num(f.min_crash_free_pct, 99), updated_at: new Date().toISOString(),
    }).eq('id', 1);
    const errs = [error?.message];
    for (const m of data.members) {
      const v = (logins[m.profile_id] ?? '').trim().replace(/^@/, '') || null;
      const { error: e2 } = await supabase.from('it_members').update({ github_login: v }).eq('profile_id', m.profile_id);
      errs.push(e2?.message);
    }
    setBusy(false);
    const bad = errs.filter(Boolean);
    setMsg(bad.length ? bad.join('; ') : 'Saved.');
    h.reload();
  };
  const lbl = 'block text-caption font-medium mb-1.5 text-fg-muted';
  // A plain function (not a component), so inputs keep focus while typing.
  const field = (k: keyof typeof f, label: string, hint?: string, wide?: boolean) => (
    <label key={k} className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className={lbl}>{label}</span><input value={f[k]} onChange={(e) => set(k, e.target.value)} disabled={!isLead} className="input disabled:opacity-70" />{hint && <span className="text-micro text-fg-subtle">{hint}</span>}</label>
  );
  const cmd = 'block font-mono text-caption bg-inset rounded px-2 py-1.5 mt-1 select-all';
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="space-y-4">
        <Box title="Goals (thresholds)" icon={Activity}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('min_completion_pct', 'Completed trips, at least (%)', 'Last 8 weeks: about 60%')}
            {field('max_no_driver_pct', 'No driver found, at most (%)', 'Last 8 weeks: 17–31%')}
            {field('max_accept_seconds', 'Time to accept, at most (seconds, median)', 'Last 8 weeks: about 20 s')}
            {field('max_pickup_minutes', 'Pickup time, at most (minutes)', 'Last 8 weeks: 4–9 min')}
            {field('min_crash_free_pct', 'Crash-free sessions, at least (%)')}
          </div>
          <p className="text-caption text-fg-muted mt-2">A daily 08:00 alert goes to the head of IT and the MD when yesterday missed one of these.</p>
        </Box>
        <Box title="GitHub usernames" icon={Users2}>
          <div className="space-y-2">{data.members.map((m) => (
            <label key={m.profile_id} className="flex items-center gap-3 text-small"><span className="w-44 truncate">{m.name}</span>
              <input value={logins[m.profile_id] ?? ''} onChange={(e) => setLogins((x) => ({ ...x, [m.profile_id]: e.target.value }))} disabled={!isLead} className="input !py-1 disabled:opacity-70" placeholder="github username" /></label>
          ))}</div>
        </Box>
        {isLead && <div className="flex items-center gap-3"><button onClick={save} disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save settings'}</button>{msg && <span className={`text-caption ${msg === 'Saved.' ? 'text-success' : 'text-danger'}`}>{msg}</span>}</div>}
      </div>
      <div className="space-y-4">
        <Box title="Sentry (app errors)" icon={Bug}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {field('sentry_org', 'Organisation slug', 'From the Sentry address: sentry.io/organizations/<slug>/')}
            {field('sentry_base_url', 'Sentry address', 'https://sentry.io, or https://de.sentry.io for EU data')}
            {field('sentry_projects', 'Project slugs', 'Comma separated, e.g. kivuride-app, kivuride-backend', true)}
          </div>
          <p className="text-small font-medium">The token (once, in PowerShell, in the project folder)</p>
          <ol className="list-decimal ml-5 text-small space-y-1 mt-1">
            <li>In Sentry: Settings → Developer Settings → Personal Tokens → create one with <b>Read</b> on Organization, Project, Issue &amp; Event.</li>
            <li>Run, replacing the placeholder with the token (don't paste it anywhere else):<code className={cmd}>npx supabase secrets set SENTRY_AUTH_TOKEN=paste-the-token-here</code></li>
          </ol>
          <p className="text-caption text-fg-muted mt-2">{h.sentry ? `Last read ${ago(h.sentry.taken_at)}${h.sentry.error ? ` — ${h.sentry.error}` : ''}` : 'Not read yet.'}</p>
        </Box>
        <Box title="GitHub (code)" icon={GitBranch}>
          <div className="grid grid-cols-1 gap-3 mb-3">{field('github_repos', 'Repositories', 'owner/name, comma separated, e.g. kivuride/rider-driver-app, kivuride/backend')}</div>
          <ol className="list-decimal ml-5 text-small space-y-1">
            <li>In GitHub: Settings → Developer settings → Fine-grained tokens → generate one for those repositories with <b>read-only</b> Contents, Metadata and Pull requests.</li>
            <li>Run:<code className={cmd}>npx supabase secrets set GITHUB_TOKEN=paste-the-token-here</code></li>
          </ol>
          <p className="text-caption text-fg-muted mt-2">Tip: mention the issue in commit messages (e.g. "KR-118 fix promo total") — the commit then shows in that issue's activity. {h.github ? `Last read ${ago(h.github.taken_at)}.` : ''}</p>
        </Box>
        <Box title="AI help" icon={Sparkles}>
          <p className="text-small">{ai.data?.configured ? <><Label tone="success">Connected</Label> using {ai.data.providers.join(', ')}.</> : <><Label>Not connected</Label> Add one key — Gemini has a free tier:</>}</p>
          {!ai.data?.configured && <code className={cmd}>npx supabase secrets set GEMINI_API_KEY=paste-the-key-here</code>}
          <p className="text-caption text-fg-muted mt-2">Used for: writing up an issue from a rough request, drafting the weekly review notes, and explaining Sentry errors. Names, phone numbers and plates are replaced with codes before anything is sent. The same key also turns on the AI line in the daily "Your day" email.</p>
        </Box>
      </div>
    </div>
  );
}
export type { HealthSettings };
