import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, BadgeCheck, CalendarOff, CalendarPlus, Car, ClipboardCheck, Coins, Gauge, Headphones, ListTodo, Megaphone, MessageSquare,
  Moon, Package, PhoneCall, Radio, Receipt, ShieldAlert, Target, Truck, Users2, Wallet, BellOff,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useCompanyData, buildEmployeeStats } from '../../lib/company';
import { useActivityFeed } from '../../lib/activity';
import { useUnreadComments } from '../../lib/hooks';
import { formatDateFull, greeting } from '../../lib/utils';
import { Task } from '../../lib/supabase';
import { usePerformanceData, collected, driverRows, fleetDays, kDay, kivuRevenue, periodOf, today, addDays } from '../../lib/performance';
import { EntityLink } from '../../os/EntityLink';
import { Box, Label, StatCard, StatGrid, rwf, rwfShort } from '../../ui/kit';
import ActivityFeed from '../../components/ActivityFeed';
import TaskReviewModal from '../../components/TaskReviewModal';

const AssignTaskHost = lazy(() => import('../../os/shell/NewThingModals').then((m) => ({ default: m.AssignTaskHost })));
const AnnouncementHost = lazy(() => import('../../os/shell/NewThingModals').then((m) => ({ default: m.AnnouncementHost })));
const MeetingHost = lazy(() => import('../../os/shell/NewThingModals').then((m) => ({ default: m.MeetingHost })));

// The MD's home: what's waiting on you, the company's pulse right now,
// each department's health, the team today, and what just happened.
export default function CommandCenter() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const { data } = usePerformanceData();
  const { profiles, allTasks, reload } = useCompanyData();
  const { entries, loading: feedLoading } = useActivityFeed(14);
  const unread = useUnreadComments(profile);
  const [modal, setModal] = useState<null | 'task' | 'announcement' | 'meeting'>(null);
  const [review, setReview] = useState<Task | null>(null);
  const t = today();

  const team = useMemo(() => profiles.filter((p) => p.role === 'employee' && p.is_active).map((p) => buildEmployeeStats(p, allTasks)).sort((a, b) => b.todayPct - a.todayPct || b.todayTotal - a.todayTotal), [profiles, allTasks]);
  const silent = team.filter((e) => e.todayTotal === 0);
  const totalToday = team.reduce((s, e) => s + e.todayTotal, 0);
  const doneToday = team.reduce((s, e) => s + e.todayCompleted, 0);
  const reviews = allTasks.filter((x) => x.completed && !x.review_status && x.assigned_by === profile?.id).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 6);

  const pulse = useMemo(() => {
    if (!data) return null;
    const p7 = periodOf(7);
    const fleet = fleetDays(data, addDays(t, -13), t);
    const now = fleet[fleet.length - 1];
    const drivers = driverRows(data, p7).filter((r) => !r.end && r.driver.vehicle_id);
    const notPaid = drivers.filter((r) => !r.standing.isCleared && !r.standing.pausedToday);
    const onShift = data.shifts.filter((s) => s.status === 'open');
    const openCases = data.tickets.filter((x) => ['open', 'in_progress', 'waiting_on_caller'].includes(x.status));
    const outreachToday = data.outreach.filter((o) => kDay(o.created_at) === t);
    return {
      carsWorking: now?.working ?? 0, cars: data.vehicles.length, carsSpark: fleet.map((d) => d.working), rest: now?.rest ?? 0,
      paidUp: drivers.length - notPaid.length, drivers: drivers.length, notPaid, owed: drivers.reduce((s, r) => s + r.standing.owes, 0),
      collectedToday: collected(data, t, t), collected7: collected(data, p7.from, p7.to), collectedPrev7: collected(data, p7.prevFrom, p7.prevTo),
      dailyCollected: Array.from({ length: 14 }, (_, i) => collected(data, addDays(t, i - 13), addDays(t, i - 13))),
      revenue30: kivuRevenue(data.transactions, addDays(t, -29), t),
      contactsToday: data.tickets.filter((x) => kDay(x.created_at) === t).length,
      onShift: onShift.length, openCases: openCases.length,
      overdueCases: openCases.filter((x) => !x.first_response_at && x.assigned_at && Date.now() - new Date(x.assigned_at).getTime() > 2 * 3600000).length,
      outreachToday: outreachToday.length, outreachYes: outreachToday.filter((o) => o.interested).length,
      pendingFinance: data.waiting.finance,
    };
  }, [data, t]);

  const w = data?.waiting;
  const waiting = w ? [
    { n: w.pauses, label: `driver pause${w.pauses === 1 ? '' : 's'} to approve`, icon: CalendarOff, to: '/fleet/days-off' },
    { n: w.emergencies, label: `emergenc${w.emergencies === 1 ? 'y' : 'ies'} to acknowledge`, icon: ShieldAlert, to: '/me/cases' },
    { n: w.finance, label: `finance entr${w.finance === 1 ? 'y' : 'ies'} waiting (${rwf(w.financeAmount)})`, icon: Receipt, to: '/finance/ledger' },
    { n: w.deposits, label: `deposit${w.deposits === 1 ? '' : 's'} to confirm`, icon: Coins, to: '/finance/confirmations' },
    { n: reviews.length, label: `finished task${reviews.length === 1 ? '' : 's'} to review`, icon: ClipboardCheck, to: '' },
    { n: unread, label: `new comment${unread === 1 ? '' : 's'}`, icon: MessageSquare, to: '/me/comments' },
  ].filter((x) => x.n) : [];

  return (
    <div className="animate-fade-in space-y-4">
      <section className="card p-5 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[240px]">
          <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">{formatDateFull(new Date())}</p>
          <h1 className="text-h1 font-semibold mt-0.5">{greeting()}, {profile?.full_name.split(' ')[0]}</h1>
          <p className="text-body text-fg-muted mt-1">
            {pulse ? <>{pulse.carsWorking} of {pulse.cars} cars working · {pulse.paidUp} of {pulse.drivers} drivers paid up · {pulse.onShift} agent{pulse.onShift === 1 ? '' : 's'} on shift · team {totalToday ? Math.round((doneToday / totalToday) * 100) : 0}% done today</> : 'Loading the company pulse…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setModal('task')} className="btn-primary"><ListTodo size={14} /> Assign a task</button>
          <button onClick={() => setModal('announcement')} className="btn-secondary"><Megaphone size={14} /> Announce</button>
          <button onClick={() => setModal('meeting')} className="btn-secondary"><CalendarPlus size={14} /> Meeting note</button>
          <Link to="/insights" className="btn-secondary"><Activity size={14} /> Insights</Link>
        </div>
      </section>

      <Box title="Waiting on you" icon={BadgeCheck} padded={waiting.length === 0}>
        {waiting.length === 0 ? <p className="text-body text-fg-muted flex items-center gap-2"><BellOff size={14} /> Nothing is waiting on you.</p> : (
          <div className="flex flex-wrap gap-2 p-3">
            {waiting.map((x) => {
              const inner = <><x.icon size={15} className="text-attention" /><span className="text-body"><b className="tabular-nums">{x.n}</b> {x.label}</span></>;
              return x.to
                ? <Link key={x.label} to={x.to} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 hover:border-line-strong hover:bg-hover/50">{inner}</Link>
                : <a key={x.label} href="#reviews" className="flex items-center gap-2 rounded-md border border-line px-3 py-2 hover:border-line-strong hover:bg-hover/50">{inner}</a>;
            })}
          </div>
        )}
      </Box>

      {pulse ? (
        <StatGrid cols={4}>
          <StatCard to="/fleet" icon={Gauge} label="Cars working now" value={`${pulse.carsWorking}/${pulse.cars}`} spark={pulse.carsSpark} sub={pulse.rest ? `${pulse.rest} on their rest day` : 'With a paid-up driver'} />
          <StatCard to="/fleet/deposits" icon={BadgeCheck} label="Drivers paid up" value={`${pulse.paidUp}/${pulse.drivers}`} tone={pulse.notPaid.length ? 'danger' : 'success'} sub={pulse.owed ? `${rwf(pulse.owed)} owed for days driven` : 'Nobody owes'} />
          <StatCard to="/insights" icon={Wallet} label="Collected (7 days)" value={rwfShort(pulse.collected7)} spark={pulse.dailyCollected}
            delta={pulse.collectedPrev7 ? { text: `${pulse.collected7 >= pulse.collectedPrev7 ? '▲' : '▼'} ${Math.abs(Math.round(((pulse.collected7 - pulse.collectedPrev7) / pulse.collectedPrev7) * 100))}%`, good: pulse.collected7 >= pulse.collectedPrev7 } : undefined} sub={`${rwf(pulse.collectedToday)} today`} />
          <StatCard to="/finance" icon={Coins} label="Kivu revenue (30 days)" value={rwfShort(pulse.revenue30)} sub="Margin, fees and other income" />
          <StatCard to="/call-center" icon={Radio} label="Agents on shift" value={pulse.onShift} sub={`${pulse.contactsToday} contacts logged today`} />
          <StatCard to="/call-center" icon={PhoneCall} label="Open cases" value={pulse.openCases} tone={pulse.overdueCases ? 'danger' : undefined} sub={pulse.overdueCases ? `${pulse.overdueCases} with no reply after 2 h` : 'All answered in time'} />
          <StatCard to="/call-center/outreach" icon={Target} label="Outreach today" value={pulse.outreachToday} sub={`${pulse.outreachYes} said yes to something`} />
          <StatCard to="/people" icon={ListTodo} label="Team tasks today" value={totalToday ? `${Math.round((doneToday / totalToday) * 100)}%` : '—'} sub={`${doneToday}/${totalToday} done · ${silent.length} with no tasks`} tone={silent.length ? 'attention' : undefined} />
        </StatGrid>
      ) : <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Box title="Team today" icon={Users2} padded={false} className="xl:col-span-2" right={<Link to="/people" className="text-caption link">People</Link>}>
          <ul className="divide-y divide-line-muted">
            {team.map((e) => (
              <li key={e.id} className="grid grid-cols-[minmax(120px,190px)_1fr_auto] items-center gap-3 px-4 py-2">
                <span className="truncate"><EntityLink type="person" id={e.id} label={e.full_name.trim()} /><span className="block text-caption text-fg-muted truncate">{(e as unknown as { department?: { name?: string } }).department?.name ?? ''}</span></span>
                <span className="h-2 rounded-full bg-inset overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${e.todayPct}%`, background: e.todayPct >= 80 ? 'rgb(var(--c-success))' : e.todayPct >= 40 ? 'rgb(var(--c-attention))' : 'rgb(var(--c-danger))' }} /></span>
                <span className="text-caption tabular-nums text-right w-28">{e.todayTotal ? `${e.todayCompleted}/${e.todayTotal} · ${Math.round(e.todayPct)}%` : <span className="text-attention flex items-center gap-1 justify-end"><Moon size={11} /> no tasks</span>}{e.streak > 1 ? <span className="block text-fg-subtle">{e.streak}-day streak</span> : null}</span>
              </li>
            ))}
            {team.length === 0 && <li className="px-4 py-8 text-center text-body text-fg-muted">No staff yet.</li>}
          </ul>
        </Box>
        <Box title="Departments" icon={Package} padded={false}>
          <ul className="divide-y divide-line-muted">
            {[
              { icon: Truck, label: 'Fleet', to: '/fleet', line: pulse ? `${pulse.carsWorking}/${pulse.cars} cars working · ${pulse.notPaid.length} not paid up` : '…', bad: !!pulse?.notPaid.length },
              { icon: Wallet, label: 'Finance', to: '/finance', line: pulse ? `${pulse.pendingFinance} entries waiting · ${rwfShort(pulse.collectedToday)} in today` : '…', bad: !!pulse?.pendingFinance },
              { icon: Headphones, label: 'Call Center', to: '/call-center', line: pulse ? `${pulse.openCases} open · ${pulse.onShift} on shift` : '…', bad: !!pulse?.overdueCases },
              { icon: Target, label: 'Growth', to: '/growth/campaigns', line: 'Campaigns, follow-ups and content', bad: false },
              { icon: Package, label: 'Product Hub', to: '/product/issues', line: 'Issues and products', bad: false },
              { icon: Car, label: 'Non-Insider', to: '/non-insider', line: pulse ? `${pulse.outreachToday} outreach calls today` : '…', bad: false },
            ].map((d) => (
              <li key={d.label}>
                <Link to={d.to} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                  <d.icon size={16} className="text-fg-muted" />
                  <span className="flex-1 min-w-0"><span className="text-body font-medium">{d.label}</span><span className="block text-caption text-fg-muted truncate">{d.line}</span></span>
                  {d.bad && <span className="w-2 h-2 rounded-full bg-danger" />}
                </Link>
              </li>
            ))}
          </ul>
        </Box>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title="Live activity" icon={Radio} right={<Link to="/people/activity" className="text-caption link">Full log</Link>}>
          <ActivityFeed entries={entries} loading={feedLoading} />
        </Box>
        <div id="reviews">
          <Box title="Finished tasks to review" icon={ClipboardCheck} padded={false}>
            {reviews.length === 0 ? <p className="p-4 text-body text-fg-muted">Nothing to review.</p> : (
              <ul className="divide-y divide-line-muted">
                {reviews.map((x) => {
                  const who = profiles.find((p) => p.id === x.user_id);
                  return (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0"><p className="text-body truncate">{x.title}</p><p className="text-caption text-fg-muted">{who ? <EntityLink type="person" id={who.id} label={who.full_name.trim()} /> : null}{x.completed_at ? ` · done ${new Date(x.completed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
                      <button onClick={() => setReview(x)} className="btn-secondary h-7">Review</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Box>
          {pulse && pulse.notPaid.length > 0 && (
            <Box title="Drivers not paid up" icon={Wallet} padded={false} className="mt-4">
              <ul className="divide-y divide-line-muted">
                {pulse.notPaid.slice(0, 8).map((r) => (
                  <li key={r.driver.id} className="flex items-center gap-2 px-4 py-2 text-body">
                    <EntityLink type="driver" id={r.driver.id} label={r.driver.full_name} />
                    {r.driver.vehicle && <span className="text-caption text-fg-muted font-mono">{r.driver.vehicle.plate_number}</span>}
                    <span className="ml-auto"><Label tone="danger">owes {rwf(r.standing.owes)}</Label></span>
                  </li>
                ))}
              </ul>
            </Box>
          )}
        </div>
      </div>

      <Suspense fallback={null}>
        {modal === 'task' && <AssignTaskHost onClose={() => { setModal(null); reload(); }} />}
        {modal === 'announcement' && <AnnouncementHost onClose={() => setModal(null)} />}
        {modal === 'meeting' && <MeetingHost onClose={() => setModal(null)} />}
      </Suspense>
      {review && <TaskReviewModal open task={review} onClose={() => setReview(null)} onReviewed={() => { reload(); setReview(null); nav('/'); }} />}
    </div>
  );
}
