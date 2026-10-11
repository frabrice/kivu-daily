import { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock, AlertTriangle, BadgeCheck, CalendarClock, CalendarOff, Car, CheckCircle2, CircleDot, CircleSlash, Clock, FileWarning, Gavel,
  Hourglass, ListTodo, Moon, Package, PhoneCall, Target, Trophy, Truck, Users2, Wallet,
} from 'lucide-react';
import { supabase, Driver, DriverDeposit, Vehicle } from '../lib/supabase';
import { computeDepositStanding, effectiveStage, pauseOn } from '../lib/fleet';
import { addDays, today } from '../lib/performance';
import { StatCard, StatGrid, rwf, rwfShort } from '../ui/kit';

// Number strips shown above list pages: the 3-4 numbers that matter for
// that list, each one a link where it makes sense.

const head = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

export function withStrip(Page: ComponentType, Strip: ComponentType): ComponentType {
  const Wrapped = () => <><Strip /><Page /></>;
  return Wrapped;
}

function useFleetCore() {
  return useQuery({
    queryKey: ['strip-fleet'], staleTime: 60_000,
    queryFn: async () => {
      const [d, v, dep, f, fp] = await Promise.all([
        supabase.from('drivers').select('*, pauses:driver_pauses(*)'),
        supabase.from('vehicles').select('id, plate_number, rura_license_expiry_date'),
        supabase.from('driver_deposits').select('driver_id, amount, paid_date, created_at, status'),
        supabase.from('driver_fines').select('id, amount, fine_date'),
        supabase.from('driver_fine_payments').select('fine_id, amount'),
      ]);
      return { drivers: (d.data as Driver[]) ?? [], vehicles: (v.data as Vehicle[]) ?? [], deposits: (dep.data as DriverDeposit[]) ?? [], fines: (f.data as { id: string; amount: number; fine_date: string }[]) ?? [], finePays: (fp.data as { fine_id: string; amount: number }[]) ?? [] };
    },
  });
}

const Skeleton = ({ n = 4 }: { n?: number }) => <div className={`grid grid-cols-2 ${n === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-3 mb-4`}>{Array.from({ length: n }, (_, i) => <div key={i} className="h-[92px] skeleton rounded-card" />)}</div>;

export function DriversStrip() {
  const q = useFleetCore();
  if (!q.data) return <Skeleton />;
  const { drivers } = q.data;
  const by = (s: string) => drivers.filter((d) => effectiveStage(d) === s).length;
  return (
    <StatGrid cols={4}>
      <StatCard icon={Truck} label="Active on a car" value={by('active')} sub={`${drivers.filter((d) => d.contract_status === 'active').length} on contract`} />
      <StatCard icon={BadgeCheck} label="Ready to start" value={by('ready')} sub="Waiting for a car" />
      <StatCard icon={CircleDot} label="In the pipeline" value={by('applying') + by('raw')} sub={`${by('applying')} applying · ${by('raw')} raw`} />
      <StatCard icon={AlertTriangle} label="Flagged" value={by('flagged')} tone={by('flagged') ? 'danger' : undefined} sub={`${drivers.filter((d) => d.contract_status === 'ended').length} contracts ended`} />
    </StatGrid>
  );
}

export function CarsStrip() {
  const q = useFleetCore();
  if (!q.data) return <Skeleton />;
  const { drivers, vehicles } = q.data;
  const t = today();
  const withDriver = vehicles.filter((v) => drivers.some((d) => d.vehicle_id === v.id && d.contract_status === 'active'));
  const garage = vehicles.filter((v) => drivers.some((d) => d.vehicle_id === v.id && ['garage', 'accident'].includes(pauseOn(d.pauses, t)?.reason ?? '')));
  const due = vehicles.filter((v) => v.rura_license_expiry_date && v.rura_license_expiry_date <= addDays(t, 30));
  return (
    <StatGrid cols={4}>
      <StatCard icon={Car} label="Cars" value={vehicles.length} sub={`${withDriver.length} with drivers`} />
      <StatCard icon={CircleSlash} label="No driver" value={vehicles.length - withDriver.length} tone={vehicles.length - withDriver.length ? 'danger' : undefined} sub="Earn nothing until assigned" />
      <StatCard icon={AlertTriangle} label="In the garage now" value={garage.length} sub="Driver paused: garage or accident" />
      <StatCard icon={FileWarning} label="Licences due (30 days)" value={due.length} tone={due.some((v) => (v.rura_license_expiry_date ?? '') < t) ? 'danger' : due.length ? 'attention' : undefined} />
    </StatGrid>
  );
}

export function DepositsStrip() {
  const q = useFleetCore();
  if (!q.data) return <Skeleton />;
  const { drivers, deposits } = q.data;
  const t = today();
  const onRoad = drivers.filter((d) => d.contract_status === 'active' && d.vehicle_id && d.start_date);
  const st = onRoad.map((d) => computeDepositStanding(d, deposits.filter((x) => x.driver_id === d.id)));
  const notPaid = st.filter((s) => !s.isCleared && !s.pausedToday).length;
  const owed = st.reduce((s, x) => s + x.owes, 0);
  const week = deposits.filter((x) => x.paid_date > addDays(t, -7)).reduce((s, x) => s + Number(x.amount), 0);
  const daily = Array.from({ length: 14 }, (_, i) => deposits.filter((x) => x.paid_date === addDays(t, i - 13)).reduce((s, x) => s + Number(x.amount), 0));
  const pending = deposits.filter((x) => x.status === 'pending');
  return (
    <StatGrid cols={4}>
      <StatCard icon={BadgeCheck} label="Paid up" value={`${onRoad.length - notPaid}/${onRoad.length}`} tone={notPaid ? 'danger' : 'success'} sub={`${notPaid} not paid up`} />
      <StatCard icon={Wallet} label="Owed for days driven" value={rwf(owed)} tone={owed ? 'danger' : undefined} />
      <StatCard icon={Trophy} label="Collected (7 days)" value={rwfShort(week)} spark={daily} sub="Last 2 weeks, by day" />
      <StatCard icon={Hourglass} label="Waiting for Finance" value={pending.length} tone={pending.length ? 'attention' : undefined} sub={rwf(pending.reduce((s, x) => s + Number(x.amount), 0))} />
    </StatGrid>
  );
}

export function DaysOffStrip() {
  const q = useFleetCore();
  if (!q.data) return <Skeleton n={3} />;
  const { drivers } = q.data;
  const t = today();
  const pauses = drivers.flatMap((d) => d.pauses ?? []);
  const now = drivers.filter((d) => pauseOn(d.pauses, t));
  const pending = pauses.filter((p) => p.approval_status === 'pending');
  const recent = pauses.filter((p) => p.created_at.slice(0, 10) > addDays(t, -30));
  return (
    <StatGrid cols={3}>
      <StatCard icon={CalendarOff} label="Off today" value={now.length} sub="Days that don't count" />
      <StatCard icon={Hourglass} label="Waiting for approval" value={pending.length} tone={pending.length ? 'attention' : undefined} sub="MD or Finance approves" />
      <StatCard icon={Clock} label="Recorded (30 days)" value={recent.length} sub={`${recent.filter((p) => p.reason === 'garage').length} garage · ${recent.filter((p) => p.reason === 'sick').length} sick`} />
    </StatGrid>
  );
}

export function FinesStrip() {
  const q = useFleetCore();
  if (!q.data) return <Skeleton n={3} />;
  const { fines, finePays } = q.data;
  const t = today();
  const paidOf = (id: string) => finePays.filter((p) => p.fine_id === id).reduce((s, p) => s + Number(p.amount), 0);
  const unpaid = fines.reduce((s, f) => s + Math.max(0, f.amount - paidOf(f.id)), 0);
  const recent = fines.filter((f) => f.fine_date > addDays(t, -30));
  return (
    <StatGrid cols={3}>
      <StatCard icon={Gavel} label="Unpaid fines" value={rwf(unpaid)} tone={unpaid ? 'attention' : undefined} sub={`${fines.filter((f) => paidOf(f.id) < f.amount).length} fines open`} />
      <StatCard icon={Clock} label="Fines (30 days)" value={recent.length} sub={rwf(recent.reduce((s, f) => s + f.amount, 0))} />
      <StatCard icon={CheckCircle2} label="Paid back" value={rwf(finePays.reduce((s, p) => s + Number(p.amount), 0))} tone="success" />
    </StatGrid>
  );
}

export function CasesStrip() {
  const q = useQuery({
    queryKey: ['strip-cases'], refetchInterval: 60_000,
    queryFn: async () => {
      const t = today();
      const twoH = new Date(Date.now() - 2 * 3600000).toISOString();
      return {
        open: await head(supabase.from('call_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress', 'waiting_on_caller'])),
        noReply: await head(supabase.from('call_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']).is('first_response_at', null).lt('assigned_at', twoH)),
        callbacks: await head(supabase.from('call_tickets').select('id', { count: 'exact', head: true }).eq('status', 'resolved').lte('callback_at', new Date(Date.now() + 1800000).toISOString())),
        today: await head(supabase.from('call_tickets').select('id', { count: 'exact', head: true }).gte('created_at', `${t}T00:00:00+02:00`)),
      };
    },
  });
  if (!q.data) return <Skeleton />;
  const d = q.data;
  return (
    <StatGrid cols={4}>
      <StatCard icon={PhoneCall} label="Open cases" value={d.open} />
      <StatCard icon={AlarmClock} label="No reply after 2 hours" value={d.noReply} tone={d.noReply ? 'danger' : 'success'} />
      <StatCard icon={Clock} label="Call-backs due" value={d.callbacks} tone={d.callbacks ? 'attention' : undefined} />
      <StatCard icon={CalendarClock} label="Logged today" value={d.today} />
    </StatGrid>
  );
}

export function GrowthStrip() {
  const q = useQuery({
    queryKey: ['strip-growth'],
    queryFn: async () => {
      const [c, k] = await Promise.all([supabase.from('campaigns').select('status'), supabase.from('contacts').select('stage, next_follow_up')]);
      return { campaigns: (c.data as { status: string }[]) ?? [], contacts: (k.data as { stage: string; next_follow_up: string | null }[]) ?? [] };
    },
  });
  if (!q.data) return <Skeleton />;
  const t = today();
  const { campaigns, contacts } = q.data;
  const live = contacts.filter((x) => x.stage !== 'won' && x.stage !== 'lost');
  const overdue = live.filter((x) => x.next_follow_up && x.next_follow_up < t).length;
  const week = live.filter((x) => x.next_follow_up && x.next_follow_up >= t && x.next_follow_up <= addDays(t, 7)).length;
  const won = contacts.filter((x) => x.stage === 'won').length;
  return (
    <StatGrid cols={4}>
      <StatCard to="/growth/campaigns" icon={Target} label="Active campaigns" value={campaigns.filter((c) => c.status === 'active').length} sub={`${campaigns.length} in total`} />
      <StatCard icon={Users2} label="Contacts in play" value={live.length} sub={`${contacts.filter((x) => x.stage === 'negotiating').length} negotiating`} />
      <StatCard to="/growth/follow-ups" icon={CalendarClock} label="Follow-ups overdue" value={overdue} tone={overdue ? 'danger' : 'success'} sub={`${week} due this week`} />
      <StatCard icon={Trophy} label="Won" value={won} tone="success" sub={contacts.length ? `${Math.round((won / contacts.length) * 100)}% of contacts` : undefined} />
    </StatGrid>
  );
}

export function ProductStrip() {
  const q = useQuery({
    queryKey: ['strip-product'],
    queryFn: async () => ((await supabase.from('user_stories').select('status, source, updated_at')).data as { status: string; source: string; updated_at: string }[]) ?? [],
  });
  if (!q.data) return <Skeleton />;
  const s = q.data;
  const month = today().slice(0, 7);
  return (
    <StatGrid cols={4}>
      <StatCard to="/product/issues" icon={AlertTriangle} label="Open issues from departments" value={s.filter((x) => x.source === 'flagged' && x.status !== 'done').length} tone={s.some((x) => x.source === 'flagged' && x.status !== 'done') ? 'attention' : undefined} />
      <StatCard icon={ListTodo} label="Backlog" value={s.filter((x) => x.status === 'backlog').length} />
      <StatCard icon={Package} label="In progress or review" value={s.filter((x) => x.status === 'in_progress' || x.status === 'review').length} />
      <StatCard icon={CheckCircle2} label="Done this month" value={s.filter((x) => x.status === 'done' && x.updated_at.slice(0, 7) === month).length} tone="success" />
    </StatGrid>
  );
}

export function PeopleStrip() {
  const q = useQuery({
    queryKey: ['strip-people'],
    queryFn: async () => {
      const t = today();
      const [p, tk] = await Promise.all([
        supabase.from('profiles').select('id, role, is_active'),
        supabase.from('tasks').select('user_id, completed').eq('date', t),
      ]);
      return { people: (p.data as { id: string; role: string; is_active: boolean }[]) ?? [], tasks: (tk.data as { user_id: string; completed: boolean }[]) ?? [] };
    },
  });
  if (!q.data) return <Skeleton />;
  const staff = q.data.people.filter((p) => p.role === 'employee' && p.is_active);
  const tasks = q.data.tasks.filter((x) => staff.some((s) => s.id === x.user_id));
  const silent = staff.filter((s) => !tasks.some((x) => x.user_id === s.id)).length;
  const done = tasks.filter((x) => x.completed).length;
  return (
    <StatGrid cols={4}>
      <StatCard icon={Users2} label="Staff" value={staff.length} />
      <StatCard icon={ListTodo} label="Tasks today" value={tasks.length} sub={`${done} done`} />
      <StatCard icon={CheckCircle2} label="Done today" value={tasks.length ? `${Math.round((done / tasks.length) * 100)}%` : '—'} tone={tasks.length && done / tasks.length >= 0.8 ? 'success' : undefined} />
      <StatCard icon={Moon} label="No tasks today" value={silent} tone={silent ? 'attention' : undefined} sub="Give them work" />
    </StatGrid>
  );
}
