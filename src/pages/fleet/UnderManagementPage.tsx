import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Ban, Building2, Car, CarFront, CheckCircle2, Clock, History, HelpCircle, Link2, ListChecks, Plus, Radio, RefreshCw, Search, UserMinus, UserPlus, Wifi, WifiOff, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { edgeFunctionError } from '../../lib/edgeFunctions';
import { APP_STATUS, LogEntry, kigaliDay, onlineMinutes } from '../../lib/onShift';
import { REST_DAYS } from '../../lib/fleet';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid, Tone, UnderlineTabs, fmtWhen } from '../../ui/kit';
import Modal from '../../components/Modal';
import OnShiftPage from './OnShiftPage';

// Under Management (migration 20261031110000, edge function fleet-sync):
// every car we manage (all fleet companies in the Kivu Ride app except the
// operator Secure) with its drivers, in Kivu Daily and in the app, side by
// side. "To confirm" lists every difference; the fleet manager decides each
// one (link, create in the app, keep one side, keep both phones, dismiss).
// Nothing changes in the app without a click by Fleet or the MD.

type Tab = 'cars' | 'now' | 'confirm' | 'companies' | 'history';
type CarFilter = 'all' | 'problems' | 'nodriver';

interface Company { id: number; name: string; fleet_code: string | null; driver_count: number | null; kind: 'managed' | 'operator' | 'ignore'; owner_id: string | null; owner_confirmed: boolean }
interface RosterEntry { driver_id: number; name: string | null; phone: string | null; label: string | null }
interface AppCar {
  id: number; plate: string; make: string | null; model: string | null; year: number | null; color: string | null; status: string | null; is_approved: boolean | null;
  fleet_company_id: number | null; current_driver_id: number | null; current_driver_name: string | null; roster: RosterEntry[]; kivu_vehicle_id: string | null; match_method: string | null;
}
interface Account {
  platform_driver_id: number; full_name: string | null; phone: string | null; vehicle_plate: string | null; is_online: boolean; driver_status: string | null; last_seen_at: string | null;
  kivu_driver_id: string | null; freelancer_id: string | null; match_method: string | null; is_approved: boolean | null; is_rejected: boolean | null;
}
interface KdCar { id: string; plate_number: string; make: string | null; model: string | null; color: string | null; owner_id: string | null }
interface KdDriver { id: string; full_name: string; phone: string | null; phone_alt: string | null; email: string | null; stage: string; contract_status: string; vehicle_id: string | null; shift: string | null; license_number: string | null; license_expiry: string | null }
interface Case {
  id: string; key: string; kind: string; title: string; driver_id: string | null; vehicle_id: string | null; platform_driver_id: number | null; platform_vehicle_id: number | null;
  kd_value: string | null; app_value: string | null; details: Record<string, unknown>; status: 'open' | 'dismissed' | 'resolved'; first_seen_at: string; resolution: string | null;
}
interface LogRow { id: string; at: string; action: string; summary: string; ok: boolean; steps: { call: string; status: number; ok: boolean; message?: string }[]; who: { full_name: string } | null }
interface AdminRequest { id: string; text: string; created_at: string; done_at: string | null }
interface SyncState { last_run_at: string | null; last_ok_at: string | null; last_error: string | null }
interface Dupe { id: number; full_name?: string; phone?: string | null; vehicle_plate?: string | null; plate?: string; make?: string | null; model?: string | null }
interface Result { ok: boolean; error?: string; message?: string; duplicates?: Dupe[]; steps?: { call: string; status: number; ok: boolean; message?: string }[] }

const MANAGED_STAGES = ['ready', 'active'];
const KIND: Record<Company['kind'], string> = { managed: 'Owner: we manage its cars', operator: 'Runs its own drivers', ignore: 'Training or test (not managed)' };
const CASE_GROUP: Record<string, 'drivers' | 'cars' | 'driving'> = {
  driver_not_in_app: 'drivers', phone_differs: 'drivers', name_differs: 'drivers', not_approved: 'drivers', driver_only_in_app: 'drivers', ended_still_in_app: 'drivers',
  car_not_in_app: 'cars', car_only_in_app: 'cars', car_wrong_owner: 'cars', not_on_car_in_app: 'driving', extra_on_car_in_app: 'driving',
};
const CASE_LABEL: Record<string, string> = {
  driver_not_in_app: 'Not in the app', phone_differs: 'Phone differs', name_differs: 'Name differs', not_approved: 'Approval', driver_only_in_app: 'In the app only', ended_still_in_app: 'Contract ended',
  car_not_in_app: 'Car not in the app', car_only_in_app: 'Car in the app only', car_wrong_owner: 'Owner differs', not_on_car_in_app: 'Not on the car in the app', extra_on_car_in_app: 'Extra on the car in the app',
};
const dur = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`);
const ago = (iso: string | null, now: number) => { if (!iso) return '—'; const m = Math.round((now - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m >= 2880 ? `${Math.floor(m / 1440)} days ago` : `${dur(m)} ago`; };
const shiftOf = (s: string | null) => (s === 'day' ? 'Day' : s === 'night' ? 'Night' : s === 'full' ? 'Day & night' : '—');
const RANK: Record<string, number> = { link: 0, phone: 1, plate_name: 2 };
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ data
let seq = 0;
function useUnderManagement() {
  const [d, setD] = useState<{
    companies: Company[]; appCars: AppCar[]; accounts: Account[]; members: Map<number, number>; cars: KdCar[]; drivers: KdDriver[];
    cases: Case[]; log: LogEntry[]; history: LogRow[]; sync: SyncState | null; owners: { id: string; full_name: string }[]; requests: AdminRequest[];
  } | null>(null);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    const today = Date.parse(`${kigaliDay(Date.now())}T00:00:00+02:00`);
    const [co, ac, acc, mem, cars, drv, cs, lg, hist, st, own, req] = await Promise.all([
      supabase.from('platform_fleet_companies').select('id, name, fleet_code, driver_count, kind, owner_id, owner_confirmed').order('name'),
      supabase.from('platform_vehicles').select('id, plate, make, model, year, color, status, is_approved, fleet_company_id, current_driver_id, current_driver_name, roster, kivu_vehicle_id, match_method'),
      supabase.from('platform_driver_status').select('platform_driver_id, full_name, phone, vehicle_plate, is_online, driver_status, last_seen_at, kivu_driver_id, freelancer_id, match_method, is_approved, is_rejected'),
      supabase.from('platform_fleet_members').select('platform_driver_id, fleet_company_id'),
      supabase.from('vehicles').select('id, plate_number, make, model, color, owner_id').order('plate_number'),
      supabase.from('drivers').select('id, full_name, phone, phone_alt, email, stage, contract_status, vehicle_id, shift, license_number, license_expiry'),
      supabase.from('fleet_sync_cases').select('*').in('status', ['open', 'dismissed']).order('first_seen_at', { ascending: false }),
      supabase.from('driver_online_log').select('platform_driver_id, is_online, at').gte('at', new Date(today - 86400000).toISOString()).order('at').limit(5000),
      supabase.from('fleet_sync_log').select('id, at, action, summary, ok, steps, who:profiles!fleet_sync_log_actor_fkey(full_name)').order('at', { ascending: false }).limit(100),
      supabase.from('platform_sync_state').select('last_run_at, last_ok_at, last_error').eq('key', 'fleet').maybeSingle(),
      // Owners are Finance's: the MD sees their names, Fleet sees the company only.
      supabase.from('vehicle_owners').select('id, full_name').order('full_name'),
      supabase.from('fleet_admin_requests').select('id, text, created_at, done_at').order('created_at'),
    ]);
    setD({
      companies: (co.data as Company[]) ?? [], appCars: (ac.data as AppCar[]) ?? [], accounts: (acc.data as Account[]) ?? [],
      members: new Map(((mem.data ?? []) as { platform_driver_id: number; fleet_company_id: number }[]).map((m) => [m.platform_driver_id, m.fleet_company_id])),
      cars: (cars.data as KdCar[]) ?? [], drivers: (drv.data as KdDriver[]) ?? [], cases: (cs.data as Case[]) ?? [], log: (lg.data as LogEntry[]) ?? [],
      history: (hist.data as unknown as LogRow[]) ?? [], sync: (st.data as SyncState | null) ?? null, owners: (own.data as { id: string; full_name: string }[]) ?? [],
      requests: (req.data as AdminRequest[]) ?? [],
    });
    setNow(Date.now());
  }, []);
  useEffect(() => {
    load();
    let t: number | undefined;
    const soon = () => { window.clearTimeout(t); t = window.setTimeout(load, 800); };
    const ch = supabase.channel(`under-management-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_sync_cases' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_vehicles' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_driver_status' }, soon)
      .subscribe();
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { supabase.removeChannel(ch); window.clearInterval(tick); window.clearTimeout(t); };
  }, [load]);
  return { d, now, load };
}

// Every change goes through the fleet-sync edge function (checks, the app, the log).
async function run(action: string, payload: Record<string, unknown>): Promise<Result> {
  const { data, error } = await supabase.functions.invoke('fleet-sync', { body: { action, ...payload } });
  if (error) return { ok: false, error: await edgeFunctionError(error) };
  return (data as Result) ?? { ok: false, error: 'No answer' };
}

// ------------------------------------------------------------------ page
export default function UnderManagementPage() {
  usePageTitle('Under Management');
  const a = useAccess();
  const canAct = a.isMd || a.dept === 'fleet';
  const { d, now, load } = useUnderManagement();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'cars';
  const setTab = (t: Tab) => { const p = new URLSearchParams(params); p.set('tab', t); p.delete('car'); setParams(p, { replace: true }); };
  const carFilter = params.get('car');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const checkNow = async () => {
    setBusy(true); setError('');
    const r = await run('sync', {});
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'The check failed');
    await load();
  };
  const done = async (r: Result) => { if (r.ok) setNotice(r.message ?? 'Done'); await load(); };

  const view = useMemo(() => (d ? build(d, now) : null), [d, now]);
  if (!d || !view) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
  const open = d.cases.filter((c) => c.status === 'open');
  const lastOk = d.sync?.last_ok_at ?? null;
  const late = !lastOk || now - Date.parse(lastOk) > 25 * 60000;

  return (
    <div className="animate-fade-in">
      <PageHeader icon={CarFront} title="Under Management"
        subtitle="Every car we manage and its drivers, in Kivu Daily and in the Kivu Ride app. What differs between the two waits in To confirm."
        meta={<><span className={late ? 'text-danger' : ''}>App read {ago(lastOk, now)}{late ? ' — the check is late' : ' · every 10 minutes'}</span>{!canAct && <span>Fleet and the MD make the changes</span>}</>}
        actions={<button onClick={checkNow} disabled={busy} className="btn-secondary"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Reading the app…' : 'Check now'}</button>} />
      {(error || d.sync?.last_error) && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">Couldn't read the app: {error || d.sync?.last_error}</p>}
      {notice && <p className="mb-3 text-small bg-success-muted text-success rounded-md px-3 py-2 flex items-center gap-2"><CheckCircle2 size={14} /> <span className="flex-1">{notice}</span><button onClick={() => setNotice('')} aria-label="Close"><X size={14} /></button></p>}

      <UnderlineTabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: 'cars', label: 'Cars & drivers', icon: Car, count: view.rows.length },
        { key: 'now', label: 'On shift now', icon: Radio },
        { key: 'confirm', label: 'To confirm', icon: ListChecks, count: open.length, tone: 'danger' },
        { key: 'companies', label: 'Fleet companies', icon: Building2 },
        { key: 'history', label: 'History', icon: History },
      ]} />

      {tab === 'cars' && <CarsTab view={view} d={d} now={now} openCases={open} onConfirm={(car) => { const p = new URLSearchParams(params); p.set('tab', 'confirm'); p.set('car', car); setParams(p, { replace: true }); }} />}
      {tab === 'now' && <OnShiftPage embedded />}
      {tab === 'confirm' && <ConfirmTab d={d} cases={d.cases} canAct={canAct} car={carFilter} clearCar={() => { const p = new URLSearchParams(params); p.delete('car'); setParams(p, { replace: true }); }} onDone={done} />}
      {tab === 'companies' && <CompaniesTab d={d} canAct={canAct} onDone={done} />}
      {tab === 'history' && <HistoryTab rows={d.history} />}
    </div>
  );
}

// ------------------------------------------------------------------ the table
type Data = NonNullable<ReturnType<typeof useUnderManagement>['d']>;
interface Person { key: string; name: string; phone: string | null; shift: string | null; account: Account | null; kd: KdDriver | null; onCarInApp: boolean; drivingNow: boolean; appOnly: boolean; todayMin: number }
interface CarRow { key: string; kd: KdCar | null; app: AppCar | null; company: Company | null; people: Person[]; plate: string }

function build(d: Data, now: number) {
  const company = new Map(d.companies.map((c) => [c.id, c]));
  const accountOf = new Map<string, Account>();
  for (const x of d.accounts) {
    if (!x.kivu_driver_id) continue;
    const p = accountOf.get(x.kivu_driver_id);
    if (!p || (RANK[x.match_method ?? ''] ?? 9) < (RANK[p.match_method ?? ''] ?? 9)) accountOf.set(x.kivu_driver_id, x);
  }
  const byPid = new Map(d.accounts.map((x) => [x.platform_driver_id, x]));
  const today = Date.parse(`${kigaliDay(now)}T00:00:00+02:00`);
  const todayMin = (x: Account | null) => (x ? onlineMinutes(x.platform_driver_id, d.log, x.is_online, today, now) : 0);
  const working = d.drivers.filter((x) => x.contract_status === 'active' && (x.vehicle_id || MANAGED_STAGES.includes(x.stage)));
  const managed = (id: number | null) => !!id && company.get(id)?.kind === 'managed';
  const order: Record<string, number> = { day: 0, full: 1, night: 2 };

  const rowOf = (kd: KdCar | null, app: AppCar | null): CarRow => {
    const people: Person[] = [];
    const inApp = (pid: number) => !!app && (app.current_driver_id === pid || app.roster.some((r) => r.driver_id === pid));
    for (const x of working.filter((w) => kd && w.vehicle_id === kd.id).sort((p, q) => (order[p.shift ?? ''] ?? 3) - (order[q.shift ?? ''] ?? 3))) {
      const acc = accountOf.get(x.id) ?? null;
      people.push({ key: x.id, name: clean(x.full_name), phone: x.phone, shift: x.shift, account: acc, kd: x, onCarInApp: !!acc && inApp(acc.platform_driver_id), drivingNow: !!acc && app?.current_driver_id === acc.platform_driver_id, appOnly: false, todayMin: todayMin(acc) });
    }
    if (app) {
      const pids = [...new Set([...app.roster.map((r) => r.driver_id), ...(app.current_driver_id ? [app.current_driver_id] : [])])];
      for (const pid of pids) {
        if (people.some((p) => p.account?.platform_driver_id === pid)) continue;
        const acc = byPid.get(pid) ?? null;
        const r = app.roster.find((y) => y.driver_id === pid);
        people.push({ key: `app:${pid}`, name: clean(acc?.full_name ?? r?.name ?? app.current_driver_name), phone: acc?.phone ?? r?.phone ?? null, shift: null, account: acc, kd: null, onCarInApp: true, drivingNow: app.current_driver_id === pid, appOnly: true, todayMin: todayMin(acc) });
      }
    }
    return { key: kd?.id ?? `app:${app!.id}`, kd, app, company: app?.fleet_company_id ? company.get(app.fleet_company_id) ?? null : null, people, plate: kd?.plate_number ?? app!.plate };
  };
  const rows: CarRow[] = d.cars.map((kd) => rowOf(kd, d.appCars.find((x) => x.kivu_vehicle_id === kd.id) ?? null));
  for (const app of d.appCars) if (!app.kivu_vehicle_id && managed(app.fleet_company_id) && app.status !== 'decommissioned') rows.push(rowOf(null, app));
  return { rows, company, accountOf, byPid };
}

function presence(acc: Account | null, now: number): { tone: Tone; text: string; icon: typeof Wifi } {
  if (!acc) return { tone: 'neutral', text: 'Not in the app', icon: HelpCircle };
  if (acc.is_online) {
    const seen = acc.last_seen_at ? Math.round((now - Date.parse(acc.last_seen_at)) / 60000) : null;
    if (seen !== null && seen >= 15) return { tone: 'attention', text: `No sign of the app for ${dur(seen)}`, icon: WifiOff };
    return { tone: 'success', text: APP_STATUS[acc.driver_status ?? 'online'] ?? 'Online', icon: Wifi };
  }
  return { tone: 'neutral', text: `Offline${acc.last_seen_at ? ` · seen ${ago(acc.last_seen_at, now)}` : ''}`, icon: WifiOff };
}

function CarsTab({ view, d, now, openCases, onConfirm }: { view: ReturnType<typeof build>; d: Data; now: number; openCases: Case[]; onConfirm: (car: string) => void }) {
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState<string>('all');
  const [filter, setFilter] = useState<CarFilter>('all');
  const casesOf = (r: CarRow) => openCases.filter((c) => (r.kd && c.vehicle_id === r.kd.id) || (r.app && c.platform_vehicle_id === r.app.id) || (c.driver_id && r.people.some((p) => p.kd?.id === c.driver_id)));
  const ownerName = new Map(d.owners.map((o) => [o.id, o.full_name]));
  const managedCos = d.companies.filter((c) => c.kind === 'managed' && view.rows.some((r) => r.company?.id === c.id));
  const list = view.rows.filter((r) => {
    const n = q.trim().toLowerCase();
    if (n && ![r.plate, r.app?.plate, r.company?.name, ...r.people.map((p) => `${p.name} ${p.phone ?? ''}`)].join(' ').toLowerCase().includes(n)) return false;
    if (owner !== 'all' && String(r.company?.id ?? 'none') !== owner) return false;
    if (filter === 'problems' && !casesOf(r).length) return false;
    if (filter === 'nodriver' && r.people.length) return false;
    return true;
  });
  const people = view.rows.flatMap((r) => r.people);
  const online = people.filter((p) => p.account?.is_online).length;
  return (
    <>
      <StatGrid cols={4}>
        <StatCard icon={Car} label="Cars under management" value={view.rows.length} sub={`${view.rows.filter((r) => !r.app).length} not in the app · ${view.rows.filter((r) => !r.kd).length} only in the app`} />
        <StatCard icon={UserPlus} label="Drivers on them" value={people.length} sub={`${people.filter((p) => p.appOnly).length} only in the app`} />
        <StatCard icon={Wifi} label="Online now" value={online} tone={online ? 'success' : undefined} sub={people.length ? `${Math.round((online / people.length) * 100)}% of them` : '—'} />
        <StatCard icon={ListChecks} label="To confirm" value={openCases.length} tone={openCases.length ? 'attention' : 'success'} sub={openCases.length ? 'Differences to decide' : 'Kivu Daily = the app'} />
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Plate, driver, phone or company" /></div>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="input !w-auto" aria-label="Owner">
          <option value="all">All owners</option>
          {managedCos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">Not in a company in the app</option>
        </select>
        {(['all', 'problems', 'nodriver'] as CarFilter[]).map((f) => <button key={f} onClick={() => setFilter(f)} className={`h-8 px-3 rounded-full text-small border ${filter === f ? 'bg-accent/15 border-accent text-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{f === 'all' ? 'All' : f === 'problems' ? 'To confirm' : 'No driver'}</button>)}
      </div>
      <Box padded={false} className="mb-4">
        {list.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-small min-w-[860px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">
                <th className="px-3 py-2 w-44">Car</th><th className="px-3 py-2 w-48">Owner (company in the app)</th><th className="px-3 py-2">Drivers · online now · online today</th><th className="px-3 py-2 w-32" />
              </tr></thead>
              <tbody>{list.map((r) => {
                const cs = casesOf(r);
                return (
                  <tr key={r.key} className="border-t border-line-muted align-top">
                    <td className="px-3 py-2.5">
                      <span className="font-semibold tabular-nums">{r.plate}</span>
                      <span className="block text-caption text-fg-muted">{[r.kd?.make ?? r.app?.make, r.kd?.model ?? r.app?.model].filter(Boolean).join(' ') || '—'}</span>
                      <span className="flex flex-wrap gap-1 mt-1">
                        {!r.app && <Label tone="attention">Not in the app</Label>}
                        {!r.kd && <Label tone="attention">Only in the app</Label>}
                        {r.app && r.app.status && r.app.status !== 'active' && <Label tone="neutral">{r.app.status}</Label>}
                        {r.app && r.app.is_approved === false && <Label tone="attention">Not approved</Label>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.company ? <span>{r.company.name}{r.company.kind !== 'managed' && <span className="block"><Label tone="danger">{KIND[r.company.kind]}</Label></span>}</span> : <span className="text-fg-muted">{r.app ? "An independent driver's car" : '—'}</span>}
                      {r.kd?.owner_id && ownerName.get(r.kd.owner_id) && <span className="block text-caption text-fg-muted">Owner in Kivu Daily: {ownerName.get(r.kd.owner_id)}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.people.length ? <ul className="space-y-1.5">{r.people.map((p) => {
                        const pr = presence(p.account, now);
                        return (
                          <li key={p.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium min-w-[150px]">{p.name}</span>
                            {p.shift && <span className="text-caption text-fg-muted w-20">{shiftOf(p.shift)}</span>}
                            <Label tone={pr.tone} icon={pr.icon}>{pr.text}</Label>
                            {p.account && <span className="text-caption text-fg-muted tabular-nums">{p.todayMin ? `${dur(p.todayMin)} online today` : 'not online today'}</span>}
                            {p.drivingNow && <Label tone="info">Driving it in the app</Label>}
                            {p.appOnly && <Label tone="attention">Only in the app</Label>}
                            {!p.appOnly && p.account && r.app && !p.onCarInApp && <Label tone="attention">Not on this car in the app</Label>}
                            {p.account?.is_approved === false && <Label tone="attention">Waiting for KivuRide approval</Label>}
                          </li>
                        );
                      })}</ul> : <span className="text-fg-subtle">No driver</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">{cs.length ? <button onClick={() => onConfirm(r.kd?.id ?? `app:${r.app!.id}`)} className="btn-ghost h-8 text-attention inline-flex items-center gap-1 whitespace-nowrap"><AlertTriangle size={13} /> {cs.length} to confirm</button> : <span className="text-caption text-success inline-flex items-center gap-1"><CheckCircle2 size={13} /> In step</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState icon={Car} title="No car here" body="Change the search or the filters." />}
      </Box>
      <p className="text-caption text-fg-muted">Under management = our cars in Kivu Daily, plus every car of a fleet company in the app except those that run their own drivers (see Fleet companies). Drivers come from Kivu Daily (the car and shift) and from the app (the car's roster and who is driving it). Online today counts from midnight.</p>
    </>
  );
}

// ------------------------------------------------------------------ To confirm
function ConfirmTab({ d, cases, canAct, car, clearCar, onDone }: { d: Data; cases: Case[]; canAct: boolean; car: string | null; clearCar: () => void; onDone: (r: Result) => Promise<void> }) {
  const [group, setGroup] = useState<'all' | 'drivers' | 'cars' | 'driving'>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [modal, setModal] = useState<ReactNode>(null);
  const close = () => setModal(null);
  const finish = async (r: Result) => { if (r.ok) close(); await onDone(r); };
  const carCase = (c: Case) => {
    if (!car) return true;
    if (car.startsWith('app:')) return c.platform_vehicle_id === Number(car.slice(4));
    const driversOn = d.drivers.filter((x) => x.vehicle_id === car).map((x) => x.id);
    return c.vehicle_id === car || (!!c.driver_id && driversOn.includes(c.driver_id));
  };
  const scoped = cases.filter(carCase);
  const list = scoped.filter((c) => (showDismissed ? c.status === 'dismissed' : c.status === 'open') && (group === 'all' || CASE_GROUP[c.kind] === group));
  const count = (g: string) => scoped.filter((c) => c.status === 'open' && (g === 'all' || CASE_GROUP[c.kind] === g)).length;
  const plateOf = car ? (car.startsWith('app:') ? d.appCars.find((x) => x.id === Number(car.slice(4)))?.plate : d.cars.find((x) => x.id === car)?.plate_number) : null;
  const ended = cases.filter((c) => c.status === 'open' && c.kind === 'ended_still_in_app' && c.driver_id);
  const removeAll = () => setModal(<ConfirmModal title={`Take ${ended.length} ended drivers out of the app`} app onClose={close}
    body={<>Their contracts have ended: each one comes off any car and out of their fleet company in the Kivu Ride app, so they get no more requests. Their app accounts stay, and they stay in Kivu Daily with no car.<span className="block mt-1 text-fg-muted">{[...new Set(ended.map((c) => clean(d.drivers.find((x) => x.id === c.driver_id)?.full_name ?? '')))].join(', ')}</span></>}
    onRun={async () => {
      let last: Result = { ok: true, message: 'Done' };
      const failed: string[] = [];
      for (const id of [...new Set(ended.map((c) => c.driver_id as string))]) { const r = await run('offboard', { driver_id: id }); if (!r.ok) { failed.push(r.error ?? 'failed'); last = r; } }
      const r: Result = failed.length ? { ...last, ok: false, error: `${failed.length} not done: ${failed.join(' · ')}` } : { ok: true, message: `${ended.length} ended drivers taken out of the app` };
      await finish(r);
      return r;
    }} />);
  return (
    <>
      <AdminRequestsBox d={d} canAct={canAct} onDone={onDone} />
      {canAct && ended.length > 1 && !showDismissed && (
        <div className="mb-3 rounded-card border border-line bg-surface px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-small flex-1 min-w-[220px]"><b>{ended.length}</b> drivers whose contract ended are still in a fleet company in the app, so they can still get requests.</span>
          <button onClick={removeAll} className="btn-primary h-8 text-small"><UserMinus size={13} /> Take them all out of the app<span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">changes the app</span></button>
        </div>
      )}
      {car && <p className="mb-3 text-small bg-inset rounded-md px-3 py-2 flex items-center gap-2">Showing {plateOf ?? 'one car'} only <button onClick={clearCar} className="link ml-auto">Show all</button></p>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {([['all', 'All'], ['drivers', 'Drivers'], ['cars', 'Cars'], ['driving', 'Who drives which car']] as const).map(([g, l]) => (
          <button key={g} onClick={() => setGroup(g)} className={`h-8 px-3 rounded-full text-small border ${group === g ? 'bg-accent/15 border-accent text-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{l}{!showDismissed && count(g) ? ` · ${count(g)}` : ''}</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-small text-fg-muted cursor-pointer"><input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Show dismissed</label>
      </div>
      {list.length ? <div className="space-y-2">{list.map((c) => <CaseCard key={c.id} c={c} d={d} canAct={canAct} open={setModal} finish={finish} close={close} />)}</div>
        : <EmptyState icon={CheckCircle2} title={showDismissed ? 'Nothing dismissed' : 'Nothing to confirm'} body={showDismissed ? undefined : 'Kivu Daily and the Kivu Ride app agree here.'} />}
      <p className="mt-4 text-caption text-fg-muted">Each difference is decided here, one at a time. Buttons marked <b>changes the app</b> change the Kivu Ride app with our live key; every change is in History. Approving, suspending and deleting drivers and moving a car to another company stay in the KivuRide dashboard.</p>
      {modal}
    </>
  );
}

function CaseCard({ c, d, canAct, open, finish, close }: { c: Case; d: Data; canAct: boolean; open: (m: ReactNode) => void; finish: (r: Result) => Promise<void>; close: () => void }) {
  const det = c.details as Record<string, unknown>;
  const kd = c.driver_id ? d.drivers.find((x) => x.id === c.driver_id) ?? null : null;
  const kdCar = c.vehicle_id ? d.cars.find((x) => x.id === c.vehicle_id) ?? null : null;
  const appCar = c.platform_vehicle_id ? d.appCars.find((x) => x.id === c.platform_vehicle_id) ?? null : null;
  const ids = { case_id: c.id, driver_id: c.driver_id, platform_driver_id: c.platform_driver_id };
  const confirm = (title: string, body: ReactNode, action: string, payload: Record<string, unknown>, app = true) =>
    open(<ConfirmModal title={title} body={body} app={app} onClose={close} onRun={async () => { const r = await run(action, payload); await finish(r); return r; }} />);
  const dismiss = () => open(<DismissModal c={c} onClose={close} onDone={finish} />);
  const B = ({ onClick, children, primary, app }: { onClick: () => void; children: ReactNode; primary?: boolean; app?: boolean }) =>
    <button onClick={onClick} className={`${primary ? 'btn-primary' : 'btn-secondary'} h-8 text-small`}>{children}{app && <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">changes the app</span>}</button>;

  let actions: ReactNode = null;
  if (canAct && c.status === 'open') {
    switch (c.kind) {
      case 'driver_not_in_app':
        actions = <>
          <B primary onClick={() => open(<PickAccount title={`Link ${kd?.full_name ?? 'the driver'} to an app account`} d={d} kd={kd} suggestions={(det.suggestions as Dupe[]) ?? []} onClose={close} onPick={async (pid) => { const r = await run('link_driver', { ...ids, platform_driver_id: pid }); await finish(r); return r; }} />)}><Link2 size={13} /> Link to an app account</B>
          {kd && <B app onClick={() => open(<CreateDriverModal kd={kd} d={d} companyId={(det.company_id as number | null) ?? null} caseId={c.id} onClose={close} onDone={finish} />)}><UserPlus size={13} /> Create in the app</B>}
        </>;
        break;
      case 'phone_differs':
        actions = <>
          <B app onClick={() => confirm('Keep the phone in Kivu Daily', <>The app's phone for {kd?.full_name} becomes <b>{kd?.phone}</b> (now {c.app_value}). The driver logs in with the new number.</>, 'keep_kd_phone', { ...ids, phone: kd?.phone })}>Keep Kivu Daily</B>
          <B onClick={() => confirm("Keep the app's phone", <>{kd?.full_name}'s main phone in Kivu Daily becomes <b>{c.app_value}</b>; {kd?.phone ?? 'the old one'} stays as the second phone.</>, 'keep_app_phone', ids, false)}>Keep the app</B>
          <B primary onClick={() => confirm('Keep both phones', <>{kd?.full_name} keeps <b>{kd?.phone}</b> as the main phone and gets <b>{c.app_value}</b> (from the app) as the second. Both are shown and both are used to find them in the app.</>, 'keep_both_phones', ids, false)}>Keep both</B>
          <B onClick={() => confirm('Not the same person', <>App account #{c.platform_driver_id} ({String(det.app_name ?? '')}, {c.app_value}) is not {kd?.full_name}. They will never be matched again.</>, 'reject_match', ids, false)}>Not the same person</B>
        </>;
        break;
      case 'name_differs':
        actions = <>
          <B app onClick={() => confirm('Keep the name in Kivu Daily', <>The name in the app becomes <b>{c.kd_value}</b> (now {c.app_value}).</>, 'keep_kd_name', ids)}>Keep Kivu Daily</B>
          <B onClick={() => confirm("Keep the app's name", <>The name in Kivu Daily becomes <b>{c.app_value}</b> (now {c.kd_value}).</>, 'keep_app_name', ids, false)}>Keep the app</B>
          <B onClick={() => confirm('Not the same person', <>App account #{c.platform_driver_id} ({c.app_value}) is not {c.kd_value}. They will never be matched again.</>, 'reject_match', ids, false)}>Not the same person</B>
        </>;
        break;
      case 'car_not_in_app':
        actions = <>
          <B primary onClick={() => open(<PickAppCar d={d} kdCar={kdCar!} onClose={close} onPick={async (pvid) => { const r = await run('link_vehicle', { case_id: c.id, vehicle_id: c.vehicle_id, platform_vehicle_id: pvid }); await finish(r); return r; }} />)}><Link2 size={13} /> Link to an app car</B>
          {kdCar && <B app onClick={() => open(<CreateCarModal kdCar={kdCar} d={d} companyId={(det.company_id as number | null) ?? null} caseId={c.id} onClose={close} onDone={finish} />)}><Plus size={13} /> Add to the app</B>}
        </>;
        break;
      case 'car_wrong_owner': {
        const pid = appCar?.current_driver_id ?? null;
        const known = pid ? d.accounts.find((x) => x.platform_driver_id === pid)?.kivu_driver_id : null;
        actions = pid && !known
          ? <B onClick={() => open(<AddToKdModal d={d} pid={pid} vehicleId={c.vehicle_id} caseId={null} onClose={close} onDone={finish} />)}><UserPlus size={13} /> Add {clean(appCar?.current_driver_name ?? 'the driver')} to Kivu Daily</B>
          : null;
        break;
      }
      case 'car_only_in_app':
        actions = <B primary onClick={() => open(<PickKdCar d={d} appCar={appCar} onClose={close} onPick={async (vid) => { const r = await run('link_vehicle', { case_id: c.id, vehicle_id: vid, platform_vehicle_id: c.platform_vehicle_id }); await finish(r); return r; }} />)}><Link2 size={13} /> Link to a Kivu Daily car</B>;
        break;
      case 'not_on_car_in_app':
        actions = <B primary app onClick={() => open(<PutOnCarModal c={c} kd={kd} onClose={close} onDone={finish} />)}><CarFront size={13} /> Put on the car in the app</B>;
        break;
      case 'extra_on_car_in_app':
        actions = <>
          <B app onClick={() => open(<TakeOffModal c={c} appCar={appCar} kd={kd} onClose={close} onDone={finish} />)}><UserMinus size={13} /> Take off the car in the app</B>
          {!c.driver_id && <B onClick={() => open(<PickKdDriver d={d} pid={c.platform_driver_id!} onClose={close} onPick={async (did) => { const r = await run('link_driver', { case_id: c.id, driver_id: did, platform_driver_id: c.platform_driver_id }); await finish(r); return r; }} />)}><Link2 size={13} /> Link to a Kivu Daily driver</B>}
          {!c.driver_id && <B onClick={() => open(<AddToKdModal d={d} pid={c.platform_driver_id!} vehicleId={c.vehicle_id} caseId={c.id} onClose={close} onDone={finish} />)}><UserPlus size={13} /> Add to Kivu Daily</B>}
        </>;
        break;
      case 'driver_only_in_app':
        actions = <>
          <B primary onClick={() => open(<AddToKdModal d={d} pid={c.platform_driver_id!} vehicleId={null} caseId={c.id} onClose={close} onDone={finish} />)}><UserPlus size={13} /> Add to Kivu Daily</B>
          <B onClick={() => open(<PickKdDriver d={d} pid={c.platform_driver_id!} onClose={close} onPick={async (did) => { const r = await run('link_driver', { case_id: c.id, driver_id: did, platform_driver_id: c.platform_driver_id }); await finish(r); return r; }} />)}><Link2 size={13} /> Link to a Kivu Daily driver</B>
          <B app onClick={() => confirm(`Remove from ${String(det.company ?? 'the company')}`, <>App account #{c.platform_driver_id} leaves {String(det.company ?? 'the company')} in the app. Their account stays; they become a driver without a fleet.</>, 'remove_from_company', { case_id: c.id, platform_driver_id: c.platform_driver_id, fleet_company_id: det.company_id })}><UserMinus size={13} /> Remove from the company</B>
        </>;
        break;
      case 'ended_still_in_app': {
        const onCar = d.appCars.find((x) => x.current_driver_id === c.platform_driver_id || x.roster.some((r) => r.driver_id === c.platform_driver_id));
        actions = c.driver_id
          ? <B primary app onClick={() => confirm('Take out of the app', <>{kd?.full_name}'s contract has ended: in the Kivu Ride app they come off {onCar ? onCar.plate : 'any car'} (refused while on a trip) and out of {String(det.company ?? 'the company')}, so they get no more requests. Their account stays, and they stay in Kivu Daily with no car.</>, 'offboard', { driver_id: c.driver_id })}><UserMinus size={13} /> Take out of the app</B>
          : onCar
          ? <B app onClick={() => confirm(`Take off ${onCar.plate} and out of ${String(det.company ?? 'the company')}`, <>{kd?.full_name}'s contract has ended: they stop driving {onCar.plate} in the app (refused while on a trip), come off its roster and leave {String(det.company ?? 'the company')}. Their account stays.</>, 'take_off_car', { case_id: c.id, platform_driver_id: c.platform_driver_id, platform_vehicle_id: onCar.id, leave_company: true })}><UserMinus size={13} /> Take off the car and the company</B>
          : <B app onClick={() => confirm(`Remove from ${String(det.company ?? 'the company')}`, <>{kd?.full_name}'s contract has ended: they leave {String(det.company ?? 'the company')} in the app. Their account stays; they become a driver without a fleet.</>, 'remove_from_company', { case_id: c.id, platform_driver_id: c.platform_driver_id, fleet_company_id: det.company_id })}><UserMinus size={13} /> Remove from the company</B>;
        break;
      }
    }
  }
  const hint = c.kind === 'not_approved' ? 'Approval is done by KivuRide in their dashboard; this closes by itself once approved.'
    : c.kind === 'car_wrong_owner' ? 'Moving a car to another owner or company is done in the KivuRide admin dashboard (never open to API keys): put it on the "For the admin dashboard" list above. Or correct the owner in Kivu Daily.'
    : c.kind === 'not_on_car_in_app' && det.roster_full ? `The car already has 2 drivers in the app (${(det.roster as string[] | undefined)?.join(', ')}): take one off first.`
    : null;
  return (
    <div className={`rounded-card border ${c.status === 'dismissed' ? 'border-line-muted opacity-75' : 'border-line'} bg-surface px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <Label tone={CASE_GROUP[c.kind] === 'cars' ? 'info' : CASE_GROUP[c.kind] === 'driving' ? 'accent' : 'neutral'}>{CASE_LABEL[c.kind] ?? c.kind}</Label>
        <span className="font-medium flex-1 min-w-[200px]">{c.title}</span>
        <span className="text-caption text-fg-subtle">since {fmtWhen(c.first_seen_at)}</span>
      </div>
      {(c.kd_value || c.app_value) && (
        <div className="grid sm:grid-cols-2 gap-2 mt-2 text-small">
          <div className="rounded-md bg-inset px-3 py-1.5"><span className="text-caption text-fg-muted block">Kivu Daily</span>{c.kd_value ?? '—'}</div>
          <div className="rounded-md bg-inset px-3 py-1.5"><span className="text-caption text-fg-muted block">The Kivu Ride app</span>{c.app_value ?? '—'}</div>
        </div>
      )}
      {hint && <p className="mt-2 text-caption text-fg-muted">{hint}</p>}
      {c.status === 'dismissed' && <p className="mt-2 text-caption text-fg-muted">Dismissed: {c.resolution}</p>}
      {canAct && (
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          {actions}
          {c.status === 'open' ? <button onClick={dismiss} className="btn-ghost h-8 text-small ml-auto">Dismiss</button>
            : <button onClick={async () => { const r = await run('reopen', { case_id: c.id }); await finish(r); }} className="btn-ghost h-8 text-small ml-auto">Reopen</button>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ modals
function Steps({ r }: { r: Result | null }) {
  if (!r) return null;
  return (
    <div className={`rounded-md px-3 py-2 text-small ${r.ok ? 'bg-success-muted text-success' : 'bg-danger-muted text-danger'}`}>
      {r.ok ? r.message : r.error}
      {!!r.steps?.length && <ul className="mt-1.5 space-y-0.5 text-caption text-fg-muted">{r.steps.map((s, i) => <li key={i}>{s.ok ? '✓' : '✗'} {s.call}{s.ok ? '' : ` — ${s.message}`}</li>)}</ul>}
    </div>
  );
}

function ConfirmModal({ title, body, app, onClose, onRun }: { title: string; body: ReactNode; app: boolean; onClose: () => void; onRun: () => Promise<Result> }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const go = async () => { setBusy(true); const x = await onRun(); setBusy(false); if (!x.ok) setR(x); };
  return (
    <Modal open onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-3 text-small">
        <p>{body}</p>
        {app && <p className="text-caption text-attention flex items-center gap-1.5"><AlertTriangle size={13} /> This changes the Kivu Ride app.</p>}
        <Steps r={r} />
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={go} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Working…' : 'Confirm'}</button></div>
      </div>
    </Modal>
  );
}

function DismissModal({ c, onClose, onDone }: { c: Case; onClose: () => void; onDone: (r: Result) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  return (
    <Modal open onClose={onClose} title="Dismiss" subtitle={c.title} maxWidth="max-w-md">
      <div className="space-y-3">
        <label className="block"><span className="text-caption text-fg-muted">Why (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="e.g. a test car, not ours, fine as it is" /></label>
        <p className="text-caption text-fg-muted">It won't come back while it stays the same. You can reopen it from "Show dismissed".</p>
        <Steps r={r} />
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button>
          <button disabled={busy} onClick={async () => { setBusy(true); const x = await run('dismiss', { case_id: c.id, note }); setBusy(false); if (!x.ok) setR(x); await onDone(x); }} className="btn-primary disabled:opacity-50">Dismiss</button></div>
      </div>
    </Modal>
  );
}

function PickList<T>({ items, render, keyOf, onPick, empty, busy }: { items: T[]; render: (x: T) => ReactNode; keyOf: (x: T) => string | number; onPick: (x: T) => void; empty: string; busy: boolean }) {
  return items.length ? (
    <ul className="max-h-[320px] overflow-y-auto rounded-md border border-line-muted divide-y divide-line-muted">{items.map((x) => (
      <li key={keyOf(x)} className="flex items-center gap-3 px-3 py-2 text-small"><span className="flex-1 min-w-0">{render(x)}</span><button onClick={() => onPick(x)} disabled={busy} className="btn-secondary h-8 disabled:opacity-50"><Link2 size={13} /> Link</button></li>
    ))}</ul>
  ) : <p className="text-small text-fg-muted rounded-md bg-inset px-3 py-2">{empty}</p>;
}

function usePick(onPick: (x: never) => Promise<Result>) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const pick = async (x: never) => { setBusy(true); const res = await onPick(x); setBusy(false); if (!res.ok) setR(res); };
  return { busy, r, pick };
}

function PickAccount({ title, d, kd, suggestions, onClose, onPick }: { title: string; d: Data; kd: KdDriver | null; suggestions: Dupe[]; onClose: () => void; onPick: (pid: number) => Promise<Result> }) {
  const [q, setQ] = useState('');
  const { busy, r, pick } = usePick(onPick as (x: never) => Promise<Result>);
  const n = q.trim().toLowerCase();
  const items = n ? d.accounts.filter((x) => [x.full_name, x.phone, x.vehicle_plate, `#${x.platform_driver_id}`].join(' ').toLowerCase().includes(n)).slice(0, 30)
    : suggestions.map((s) => d.accounts.find((x) => x.platform_driver_id === s.id)).filter(Boolean) as Account[];
  return (
    <Modal open onClose={onClose} title={title} subtitle={kd ? `In Kivu Daily: ${kd.phone ?? '—'}${kd.phone_alt ? ` · ${kd.phone_alt}` : ''}` : undefined} maxWidth="max-w-xl">
      <div className="space-y-3">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search the app: name, phone or plate" /></div>
        {!n && <p className="text-caption text-fg-muted">{items.length ? 'Likely accounts (same name, phone or car):' : ''}</p>}
        <PickList items={items} keyOf={(x) => x.platform_driver_id} busy={busy} onPick={(x) => pick(x.platform_driver_id as never)} empty={n ? 'No account in the app matches.' : 'No likely account. Search by name, phone or plate.'}
          render={(x) => <><b>{clean(x.full_name)}</b> <span className="text-caption text-fg-muted">#{x.platform_driver_id}</span><span className="block text-caption text-fg-muted">{x.phone ?? 'no phone'} · {x.vehicle_plate ?? 'no car'}{x.kivu_driver_id || x.freelancer_id ? ' · already linked to someone in Kivu Daily' : ''}</span></>} />
        <Steps r={r} />
        <div className="flex justify-end pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Close</button></div>
      </div>
    </Modal>
  );
}

function PickKdDriver({ d, pid, onClose, onPick }: { d: Data; pid: number; onClose: () => void; onPick: (driverId: string) => Promise<Result> }) {
  const [q, setQ] = useState('');
  const { busy, r, pick } = usePick(onPick as (x: never) => Promise<Result>);
  const acc = d.accounts.find((x) => x.platform_driver_id === pid);
  const n = q.trim().toLowerCase();
  const items = d.drivers.filter((x) => (n ? [x.full_name, x.phone, x.phone_alt].join(' ').toLowerCase().includes(n) : x.contract_status === 'active')).sort((p, q2) => p.full_name.localeCompare(q2.full_name)).slice(0, 40);
  return (
    <Modal open onClose={onClose} title="Link to a Kivu Daily driver" subtitle={`App account #${pid}${acc ? `: ${clean(acc.full_name)} · ${acc.phone ?? '—'}` : ''}`} maxWidth="max-w-xl">
      <div className="space-y-3">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search Kivu Daily: name or phone" /></div>
        <PickList items={items} keyOf={(x) => x.id} busy={busy} onPick={(x) => pick(x.id as never)} empty="No driver matches."
          render={(x) => <><b>{clean(x.full_name)}</b><span className="block text-caption text-fg-muted">{[x.phone, x.phone_alt].filter(Boolean).join(' · ') || 'no phone'} · {x.contract_status === 'ended' ? 'contract ended' : x.stage}</span></>} />
        <Steps r={r} />
        <div className="flex justify-end pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Close</button></div>
      </div>
    </Modal>
  );
}

function PickAppCar({ d, kdCar, onClose, onPick }: { d: Data; kdCar: KdCar; onClose: () => void; onPick: (pvid: number) => Promise<Result> }) {
  const { busy, r, pick } = usePick(onPick as (x: never) => Promise<Result>);
  const company = new Map(d.companies.map((c) => [c.id, c.name]));
  const items = d.appCars.filter((x) => !x.kivu_vehicle_id && x.status !== 'decommissioned').sort((a, b) => a.plate.localeCompare(b.plate));
  return (
    <Modal open onClose={onClose} title={`Link ${kdCar.plate_number} to a car in the app`} subtitle="Cars of fleet companies in the app not linked to a Kivu Daily car." maxWidth="max-w-xl">
      <div className="space-y-3">
        <PickList items={items} keyOf={(x) => x.id} busy={busy} onPick={(x) => pick(x.id as never)} empty="Every fleet car in the app is already linked. Add this car to the app instead."
          render={(x) => <><b>{x.plate}</b> <span className="text-caption text-fg-muted">#{x.id}</span><span className="block text-caption text-fg-muted">{[x.make, x.model].filter(Boolean).join(' ')} · {x.fleet_company_id ? company.get(x.fleet_company_id) ?? '' : 'independent'}{x.current_driver_name ? ` · ${clean(x.current_driver_name)}` : ''}</span></>} />
        <Steps r={r} />
        <div className="flex justify-end pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Close</button></div>
      </div>
    </Modal>
  );
}

function PickKdCar({ d, appCar, onClose, onPick }: { d: Data; appCar: AppCar | null; onClose: () => void; onPick: (vehicleId: string) => Promise<Result> }) {
  const { busy, r, pick } = usePick(onPick as (x: never) => Promise<Result>);
  const linked = new Set(d.appCars.map((x) => x.kivu_vehicle_id).filter(Boolean));
  const items = d.cars.filter((x) => !linked.has(x.id));
  return (
    <Modal open onClose={onClose} title={`Link ${appCar?.plate ?? 'the app car'} to a Kivu Daily car`} subtitle="Kivu Daily cars not linked to a car in the app." maxWidth="max-w-xl">
      <div className="space-y-3">
        <PickList items={items} keyOf={(x) => x.id} busy={busy} onPick={(x) => pick(x.id as never)} empty="Every Kivu Daily car is already linked. If this car is ours, add it in Fleet → Cars first."
          render={(x) => <><b>{x.plate_number}</b><span className="block text-caption text-fg-muted">{[x.make, x.model].filter(Boolean).join(' ')}</span></>} />
        <Steps r={r} />
        <div className="flex justify-end pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Close</button></div>
      </div>
    </Modal>
  );
}

function Duplicates({ r, onLink, what }: { r: Result | null; onLink: (id: number) => void; what: 'driver' | 'car' }) {
  if (!r?.duplicates?.length) return <Steps r={r} />;
  return (
    <div className="rounded-md border border-attention/40 bg-attention-muted/40 px-3 py-2 text-small space-y-2">
      <p className="font-medium">Already in the app: not created. Link instead:</p>
      <ul className="space-y-1">{r.duplicates.map((x) => (
        <li key={x.id} className="flex items-center gap-2"><span className="flex-1">{what === 'driver' ? <><b>{x.full_name}</b> #{x.id} · {x.phone} · {x.vehicle_plate ?? 'no car'}</> : <><b>{x.plate}</b> #{x.id} · {[x.make, x.model].filter(Boolean).join(' ')}</>}</span><button onClick={() => onLink(x.id)} className="btn-secondary h-7 text-caption"><Link2 size={12} /> Link</button></li>
      ))}</ul>
    </div>
  );
}

function CompanySelect({ d, value, onChange, allowNone }: { d: Data; value: number | null; onChange: (v: number | null) => void; allowNone?: string }) {
  // Managed companies, plus the one already chosen (e.g. the car's company), so what shows is what is sent.
  const list = d.companies.filter((c) => c.kind === 'managed' || c.id === value);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className="input">
      {allowNone ? <option value="">{allowNone}</option> : <option value="" disabled>Choose the owner's company</option>}
      {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function CreateDriverModal({ kd, d, companyId, caseId, onClose, onDone }: { kd: KdDriver; d: Data; companyId: number | null; caseId: string; onClose: () => void; onDone: (r: Result) => Promise<void> }) {
  const [phone, setPhone] = useState(kd.phone ?? '');
  const [email, setEmail] = useState(kd.email ?? '');
  const [licence, setLicence] = useState(kd.license_number ?? '');
  const [expiry, setExpiry] = useState(kd.license_expiry ?? '');
  const [company, setCompany] = useState<number | null>(companyId);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const create = async () => { setBusy(true); const x = await run('create_driver', { case_id: caseId, driver_id: kd.id, phone, email, license_number: licence, license_expiry: expiry, fleet_company_id: company }); setBusy(false); if (x.ok) await onDone(x); else setR(x); };
  const link = async (pid: number) => { setBusy(true); const x = await run('link_driver', { case_id: caseId, driver_id: kd.id, platform_driver_id: pid }); setBusy(false); if (x.ok) await onDone(x); else setR(x); };
  return (
    <Modal open onClose={onClose} title={`Create ${clean(kd.full_name)} in the app`} subtitle="The app is checked first: if this phone or licence is already there, nothing is created and you link instead." maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className="text-caption text-fg-muted">Phone (their login)</span>
            {kd.phone_alt ? <select value={phone} onChange={(e) => setPhone(e.target.value)} className="input">{[kd.phone, kd.phone_alt].filter(Boolean).map((p) => <option key={p!} value={p!}>{p}</option>)}</select>
              : <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="07X XXX XXXX" />}</label>
          <label className="block"><span className="text-caption text-fg-muted">Email (the login details go here)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Driving licence number</span><input value={licence} onChange={(e) => setLicence(e.target.value)} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Licence expires</span><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="input" /></label>
        </div>
        <label className="block"><span className="text-caption text-fg-muted">Fleet company</span><CompanySelect d={d} value={company} onChange={setCompany} allowNone="No fleet: a driver without a car (KivuRide approves them)" /></label>
        <p className="text-caption text-fg-muted">{company ? 'In a fleet company the driver is ready at once; they get temporary login details to finish their profile in the driver app.' : 'Without a fleet the driver waits for KivuRide\'s approval.'} The licence is saved in Kivu Daily too.</p>
        <Duplicates r={r} onLink={link} what="driver" />
        <p className="text-caption text-attention flex items-center gap-1.5"><AlertTriangle size={13} /> This creates an account in the Kivu Ride app.</p>
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={create} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Checking the app…' : 'Check & create'}</button></div>
      </div>
    </Modal>
  );
}

function CreateCarModal({ kdCar, d, companyId, caseId, onClose, onDone }: { kdCar: KdCar; d: Data; companyId: number | null; caseId: string; onClose: () => void; onDone: (r: Result) => Promise<void> }) {
  const [company, setCompany] = useState<number | null>(companyId);
  const [f, setF] = useState({ make: kdCar.make ?? '', model: kdCar.model ?? '', year: String(new Date().getFullYear()), color: kdCar.color ?? '', seats: '4', fuel_type: 'electric' });
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    if (!company) { setR({ ok: false, error: "Choose the owner's company." }); return; }
    setBusy(true); const x = await run('create_vehicle', { case_id: caseId, vehicle_id: kdCar.id, fleet_company_id: company, ...f, year: Number(f.year), seats: Number(f.seats) }); setBusy(false);
    if (x.ok) await onDone(x); else setR(x);
  };
  const link = async (pvid: number) => { setBusy(true); const x = await run('link_vehicle', { case_id: caseId, vehicle_id: kdCar.id, platform_vehicle_id: pvid }); setBusy(false); if (x.ok) await onDone(x); else setR(x); };
  return (
    <Modal open onClose={onClose} title={`Add ${kdCar.plate_number} to the app`} subtitle="The app is checked first: if this plate is already there, nothing is created and you link instead." maxWidth="max-w-lg">
      <div className="space-y-3">
        <label className="block"><span className="text-caption text-fg-muted">Owner (fleet company in the app)</span><CompanySelect d={d} value={company} onChange={setCompany} /></label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="block"><span className="text-caption text-fg-muted">Make</span><input value={f.make} onChange={set('make')} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Model</span><input value={f.model} onChange={set('model')} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Year</span><input type="number" value={f.year} onChange={set('year')} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Colour (shown to riders)</span><input value={f.color} onChange={set('color')} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Seats</span><input type="number" value={f.seats} onChange={set('seats')} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Fuel</span><select value={f.fuel_type} onChange={set('fuel_type')} className="input"><option value="electric">Electric</option><option value="hybrid">Hybrid</option><option value="petrol">Petrol</option><option value="diesel">Diesel</option></select></label>
        </div>
        <p className="text-caption text-fg-muted">A fleet company's car is ready at once in the app. Insurance and registration documents can be added in the app after.</p>
        <Duplicates r={r} onLink={link} what="car" />
        <p className="text-caption text-attention flex items-center gap-1.5"><AlertTriangle size={13} /> This adds a car to the Kivu Ride app.</p>
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={create} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Checking the app…' : 'Check & add'}</button></div>
      </div>
    </Modal>
  );
}

function PutOnCarModal({ c, kd, onClose, onDone }: { c: Case; kd: KdDriver | null; onClose: () => void; onDone: (r: Result) => Promise<void> }) {
  const det = c.details as Record<string, unknown>;
  const nowDriving = (det.now_driving as string | null) ?? null;
  const [label, setLabel] = useState(kd?.shift === 'night' ? 'night shift' : kd?.shift === 'full' ? 'day and night' : 'day shift');
  const [current, setCurrent] = useState(!nowDriving);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const moving = det.member_of && det.member_of !== det.car_company;
  const go = async () => { setBusy(true); const x = await run('put_on_car', { case_id: c.id, platform_driver_id: c.platform_driver_id, platform_vehicle_id: c.platform_vehicle_id, label, make_current: current || replace, replace }); setBusy(false); if (x.ok) await onDone(x); else setR(x); };
  return (
    <Modal open onClose={onClose} title={`Put ${kd ? clean(kd.full_name) : 'the driver'} on the car in the app`} subtitle={c.kd_value ?? undefined} maxWidth="max-w-md">
      <div className="space-y-3 text-small">
        <ol className="list-decimal pl-5 space-y-1 text-fg-muted">
          <li>{moving ? <>Leaves <b>{String(det.member_of)}</b> and joins <b>{String(det.car_company)}</b> (a driver is in one company only).</> : <>In <b>{String(det.car_company ?? "the car's company")}</b>.</>}</li>
          <li>Added to the car's roster (up to 2 drivers) as:</li>
        </ol>
        <select value={label} onChange={(e) => setLabel(e.target.value)} className="input"><option value="day shift">Day shift</option><option value="night shift">Night shift</option><option value="day and night">Day and night</option></select>
        {nowDriving ? <>
          <p className="text-fg-muted">{nowDriving} is driving the car in the app now.</p>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace {nowDriving} as the driver now (refused during a trip)</label>
        </> : <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} /> Make them the car's driver now</label>}
        <Steps r={r} />
        <p className="text-caption text-attention flex items-center gap-1.5"><AlertTriangle size={13} /> This changes the Kivu Ride app.</p>
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={go} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Working…' : 'Put on the car'}</button></div>
      </div>
    </Modal>
  );
}

function TakeOffModal({ c, appCar, kd, onClose, onDone }: { c: Case; appCar: AppCar | null; kd: KdDriver | null; onClose: () => void; onDone: (r: Result) => Promise<void> }) {
  const det = c.details as Record<string, unknown>;
  const [leave, setLeave] = useState(!kd || kd.contract_status === 'ended');
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const name = c.title.split(' is on ')[0];
  const go = async () => { setBusy(true); const x = await run('take_off_car', { case_id: c.id, platform_driver_id: c.platform_driver_id, platform_vehicle_id: c.platform_vehicle_id, leave_company: leave }); setBusy(false); if (x.ok) await onDone(x); else setR(x); };
  return (
    <Modal open onClose={onClose} title={`Take ${name} off ${appCar?.plate ?? 'the car'} in the app`} maxWidth="max-w-md">
      <div className="space-y-3 text-small">
        <p>{det.driving_now ? 'They stop driving it now (refused during a trip) and come off its roster.' : 'They come off its roster.'} Their account stays.</p>
        {kd && <p className="text-fg-muted">In Kivu Daily: {c.kd_value}.</p>}
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={leave} onChange={(e) => setLeave(e.target.checked)} /> Also remove them from {String(det.company ?? 'the company')}</label>
        <Steps r={r} />
        <p className="text-caption text-attention flex items-center gap-1.5"><AlertTriangle size={13} /> This changes the Kivu Ride app.</p>
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={go} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Working…' : 'Take off'}</button></div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ companies & history
function CompaniesTab({ d, canAct, onDone }: { d: Data; canAct: boolean; onDone: (r: Result) => Promise<void> }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const save = async (id: number, patch: Record<string, unknown>) => { setBusy(id); setError(''); const r = await run('set_company', { id, ...patch }); setBusy(null); if (!r.ok) setError(r.error ?? 'Not saved'); await onDone({ ...r, message: r.ok ? 'Saved' : r.message }); };
  const cars = (id: number) => d.appCars.filter((x) => x.fleet_company_id === id && x.status !== 'decommissioned').length;
  const ownerName = new Map(d.owners.map((o) => [o.id, o.full_name]));
  const [modal, setModal] = useState<ReactNode>(null);
  // Owners of our cars with no company of theirs in the app yet.
  const withCompany = new Set(d.companies.filter((c) => c.kind === 'managed' && c.owner_id).map((c) => c.owner_id));
  const missing = [...new Set(d.cars.map((c) => c.owner_id).filter((x): x is string => !!x && !withCompany.has(x)))]
    .map((id) => ({ id, name: ownerName.get(id) ?? null, plates: d.cars.filter((c) => c.owner_id === id).map((c) => c.plate_number) }));
  const create = (o: (typeof missing)[number]) => setModal(<CreateCompanyModal owner={o} onClose={() => setModal(null)} onDone={async (r) => { if (r.ok) setModal(null); await onDone(r); }} />);
  return (
    <>
      {missing.length > 0 && (
        <Box title="Owners with no company in the app" icon={Building2} className="mb-3">
          <div className="space-y-2">
            {missing.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 text-small">
                <span className="flex-1 min-w-[220px]"><b>{o.name ?? 'Owner'}</b> <span className="text-fg-muted">· {o.plates.join(', ')}</span></span>
                {canAct && <button onClick={() => create(o)} className="btn-primary h-8 text-small"><Plus size={13} /> Create their company in the app<span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">changes the app</span></button>}
              </div>
            ))}
          </div>
          <p className="text-caption text-fg-muted mt-2">Their cars can then be added to the app under it, and their drivers put on them, from To confirm.</p>
        </Box>
      )}
      {modal}
      <Box padded={false} className="mb-3">
        <div className="overflow-x-auto">
          <table className="w-full text-small min-w-[720px]">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset"><th className="px-3 py-2">Company in the app</th><th className="px-3 py-2">Cars · drivers</th><th className="px-3 py-2">What it is</th><th className="px-3 py-2">Owner in Kivu Daily</th></tr></thead>
            <tbody>{d.companies.map((c) => (
              <tr key={c.id} className="border-t border-line-muted">
                <td className="px-3 py-2"><b>{c.name}</b><span className="block text-caption text-fg-muted">#{c.id}{c.fleet_code ? ` · ${c.fleet_code}` : ''}</span></td>
                <td className="px-3 py-2 tabular-nums">{cars(c.id)} · {c.driver_count ?? 0}</td>
                <td className="px-3 py-2">{canAct ? <select value={c.kind} disabled={busy === c.id} onChange={(e) => save(c.id, { kind: e.target.value })} className="input !w-auto">{(Object.keys(KIND) as Company['kind'][]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select> : KIND[c.kind]}</td>
                <td className="px-3 py-2">{canAct && d.owners.length ? (
                  <select value={c.owner_id ?? ''} disabled={busy === c.id} onChange={(e) => save(c.id, { owner_id: e.target.value || null })} className="input !w-auto">
                    <option value="">— none —</option>{d.owners.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                ) : c.owner_id ? (ownerName.get(c.owner_id) ?? 'Linked') : <span className="text-fg-subtle">—</span>}
                  {c.owner_id && !c.owner_confirmed && <span className="block text-caption text-attention">Guessed from the name: confirm</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Box>
      {error && <p className="text-caption text-danger mb-2">{error}</p>}
      <p className="text-caption text-fg-muted">Cars of companies marked "Owner: we manage its cars" are under management. "Runs its own drivers" (Secure) and "Training or test" are left out; a driver whose contract ended is still taken out of a training or test company. The owner links a company to the car owner in Finance → Vehicle owners, so a car in the wrong company shows in To confirm.{!d.owners.length && ' Owner names are visible to the MD and Finance.'}</p>
    </>
  );
}

function HistoryTab({ rows }: { rows: LogRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!rows.length) return <EmptyState icon={History} title="Nothing done yet" body="Every link, creation and change made from here is listed, with who did it and what the app answered." />;
  return (
    <Box padded={false}>
      <ul className="divide-y divide-line-muted">{rows.map((r) => (
        <li key={r.id} className="px-4 py-2.5 text-small">
          <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="w-full flex flex-wrap items-center gap-2 text-left">
            {r.ok ? <CheckCircle2 size={14} className="text-success" /> : <Ban size={14} className="text-danger" />}
            <span className="flex-1 min-w-[220px]">{r.summary}</span>
            <span className="text-caption text-fg-muted">{r.who?.full_name ?? 'System'} · <Clock size={11} className="inline" /> {fmtWhen(r.at)}</span>
          </button>
          {openId === r.id && !!r.steps?.length && <ul className="mt-1.5 ml-6 space-y-0.5 text-caption text-fg-muted">{r.steps.map((s, i) => <li key={i}>{s.ok ? '✓' : '✗'} {s.call} · {s.status}{s.message ? ` — ${s.message}` : ''}</li>)}</ul>}
        </li>
      ))}</ul>
    </Box>
  );
}

// A driver who is only in the app becomes a Kivu Daily driver (linked to that account).
function AddToKdModal({ d, pid, vehicleId, caseId, onClose, onDone }: { d: Data; pid: number; vehicleId: string | null; caseId: string | null; onClose: () => void; onDone: (r: Result) => Promise<void> }) {
  const acc = d.accounts.find((x) => x.platform_driver_id === pid) ?? null;
  const [car, setCar] = useState<string>(vehicleId ?? '');
  const [shift, setShift] = useState('');
  const [start, setStart] = useState(kigaliDay(Date.now()));
  const [rest, setRest] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    const r = await run('add_to_kd', { case_id: caseId, platform_driver_id: pid, vehicle_id: car || null, shift: shift || null, start_date: car ? start : null, rest_day: rest || null });
    setBusy(false);
    if (r.ok) await onDone(r); else setErr(r.error ?? 'Not added');
  };
  const onCar = (id: string) => d.drivers.filter((x) => x.vehicle_id === id && x.contract_status === 'active').map((x) => `${clean(x.full_name)} (${shiftOf(x.shift)})`).join(', ');
  return (
    <Modal open onClose={onClose} title={`Add ${clean(acc?.full_name ?? `app account #${pid}`)} to Kivu Daily`} subtitle="Name, phone and licence come from the app; Kivu Daily links them to this app account." maxWidth="max-w-lg">
      <div className="space-y-3 text-small">
        <p className="rounded-md bg-inset px-3 py-2">{clean(acc?.full_name ?? '—')} · {acc?.phone ?? 'no phone'}{acc?.vehicle_plate ? ` · drives ${acc.vehicle_plate} in the app` : ''}</p>
        <label className="block"><span className="text-caption text-fg-muted">Car in Kivu Daily</span>
          <select value={car} onChange={(e) => setCar(e.target.value)} className="input">
            <option value="">No car yet (stays in the pipeline as raw)</option>
            {d.cars.map((c) => <option key={c.id} value={c.id}>{c.plate_number}{onCar(c.id) ? ` · ${onCar(c.id)}` : ' · no driver'}</option>)}
          </select></label>
        {car && (
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block"><span className="text-caption text-fg-muted">Shift</span>
              <select value={shift} onChange={(e) => setShift(e.target.value)} className="input"><option value="">Choose…</option><option value="day">Day</option><option value="night">Night</option><option value="full">Day & night</option></select></label>
            <label className="block"><span className="text-caption text-fg-muted">Start date (payments count from it)</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input" /></label>
            <label className="block"><span className="text-caption text-fg-muted">Rest day</span>
              <select value={rest} onChange={(e) => setRest(e.target.value)} className="input"><option value="">Choose…</option>{REST_DAYS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          </div>
        )}
        {car && <p className="text-caption text-attention">From the start date the driver owes 30,000 a working day (60,000 on day & night), like every driver on a car.</p>}
        {err && <p className="text-caption text-danger">{err}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={busy || (!!car && (!shift || !rest || !start))} className="btn-primary disabled:opacity-50">{busy ? 'Adding…' : 'Add to Kivu Daily'}</button></div>
      </div>
    </Modal>
  );
}

// The owner's fleet company in the app, from the owner's name, email and phone in Kivu Daily.
function CreateCompanyModal({ owner, onClose, onDone }: { owner: { id: string; name: string | null; plates: string[] }; onClose: () => void; onDone: (r: Result) => Promise<void> }) {
  const [address, setAddress] = useState('Kigali');
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const go = async () => { setBusy(true); const x = await run('create_company', { owner_id: owner.id, address }); setBusy(false); setR(x); if (x.ok) await onDone(x); };
  return (
    <Modal open onClose={onClose} title={`Create ${owner.name ?? 'the owner'}'s company in the app`} subtitle={`For ${owner.plates.join(', ')}`} maxWidth="max-w-md">
      <div className="space-y-3 text-small">
        <p>The company is named after the owner and uses the owner's <b>email and phone from Kivu Daily</b> (Finance → Vehicle owners). It is linked to the owner here, so their cars count as under management.</p>
        <label className="block"><span className="text-caption text-fg-muted">Address</span><input value={address} onChange={(e) => setAddress(e.target.value)} className="input" /></label>
        {r && !r.ok && <p className="text-caption text-danger">{r.error}</p>}
        <Steps r={r} />
        <p className="text-caption text-attention flex items-center gap-1.5"><AlertTriangle size={13} /> This creates a fleet company in the Kivu Ride app.</p>
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={go} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Creating…' : 'Create the company'}</button></div>
      </div>
    </Modal>
  );
}

// Changes only the KivuRide admin dashboard can make (API keys never may):
// a list for Baptiste / an admin, ticked when done.
function AdminRequestsBox({ d, canAct, onDone }: { d: Data; canAct: boolean; onDone: (r: Result) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const open = d.requests.filter((x) => !x.done_at);
  const done = d.requests.filter((x) => x.done_at).slice(-3);
  if (!open.length && !canAct) return null;
  const add = async () => { setBusy(true); const { error } = await supabase.from('fleet_admin_requests').insert({ text: text.trim() }); setBusy(false); if (!error) setText(''); await onDone(error ? { ok: false, error: error.message } : { ok: true, message: 'Added to the list' }); };
  const tick = async (id: string) => { const { error } = await supabase.from('fleet_admin_requests').update({ done_at: new Date().toISOString(), done_by: (await supabase.auth.getUser()).data.user?.id }).eq('id', id); await onDone(error ? { ok: false, error: error.message } : { ok: true, message: 'Marked done' }); };
  const copy = async () => { try { await navigator.clipboard.writeText(`Kivu Ride app changes for the admin dashboard:\n${open.map((x, i) => `${i + 1}. ${x.text}`).join('\n')}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };
  return (
    <Box title={`For the admin dashboard${open.length ? ` · ${open.length}` : ''}`} icon={ListChecks} className="mb-3"
      right={open.length ? <button onClick={copy} className="btn-ghost text-caption">{copied ? 'Copied' : 'Copy for Baptiste'}</button> : undefined}>
      <p className="text-caption text-fg-muted mb-2">Moving a car to another owner or company and decommissioning a car are never open to API keys: Baptiste or an admin does them in the KivuRide dashboard. Tick each one when it is done; the next sync shows the result.</p>
      {open.length === 0 ? <p className="text-small text-fg-muted">Nothing waiting.</p> : (
        <ul className="space-y-1.5">{open.map((x) => (
          <li key={x.id} className="flex items-start gap-2 text-small">
            {canAct && <button onClick={() => tick(x.id)} className="btn-ghost h-7 px-2 text-caption shrink-0 inline-flex items-center gap-1 whitespace-nowrap" title="Mark done"><CheckCircle2 size={13} /> Done</button>}
            <span className="pt-1">{x.text}</span>
          </li>
        ))}</ul>
      )}
      {done.length > 0 && <p className="text-caption text-fg-subtle mt-2">Done lately: {done.map((x) => x.text).join(' · ')}</p>}
      {canAct && (
        <div className="flex gap-2 mt-2">
          <input value={text} onChange={(e) => setText(e.target.value)} className="input flex-1" placeholder="e.g. Move RAX 123 A into NAYA SOLUTIONS LTD" />
          <button onClick={add} disabled={busy || text.trim().length < 4} className="btn-secondary h-9 text-small disabled:opacity-50"><Plus size={13} /> Add</button>
        </div>
      )}
    </Box>
  );
}
