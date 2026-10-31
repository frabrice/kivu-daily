import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Clock, FileText, Printer, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { CallCenterShift, durationLabel, SLOT_LABEL } from '../../lib/shifts';
import { Dispatch, FOR_LABEL, fmtRwf, kTime, statusOf } from '../../lib/dispatch';
import { EmptyState, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import Modal from '../../components/Modal';
import LiveTrip from '../../components/dispatch/LiveTrip';
import { ShiftReportBody, shiftMinutes } from '../../components/callCenter/ShiftReportModal';

// Daily report (/call-center/daily-report): for one agent and a day or a
// range, each shift's end-of-shift report and every trip they dispatched
// on it (from Dispatch, which records who booked). Agents see their own;
// the MD picks any agent (also from the agent's page).

const todayK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

interface Person { id: string; full_name: string; is_active: boolean; dept: string | null }

export default function DailyReportPage() {
  usePageTitle('Daily report');
  const { profile } = useAuth();
  const a = useAccess();
  const [params, setParams] = useSearchParams();
  const today = todayK();
  const agentId = a.isMd ? params.get('agent') ?? profile?.id ?? null : profile?.id ?? null;
  const from = isDay(params.get('from')) ? params.get('from')! : today;
  const to = isDay(params.get('to')) && params.get('to')! >= from ? params.get('to')! : from;
  const setQ = (patch: Record<string, string>) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => n.set(k, v)); return n; }, { replace: true });

  const [people, setPeople] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<CallCenterShift[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Dispatch | null>(null);

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, is_active, department:departments(slug)').then(({ data }) => setPeople(((data ?? []) as unknown as { id: string; full_name: string; is_active: boolean; department: { slug: string } | null }[])
      .map((p) => ({ id: p.id, full_name: p.full_name.trim(), is_active: p.is_active, dept: p.department?.slug ?? null }))));
  }, []);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    const start = `${from}T00:00:00+02:00`, end = `${addDays(to, 1)}T00:00:00+02:00`;
    (async () => {
      const { data: s } = await supabase.from('call_center_shifts').select('*').eq('agent_id', agentId).gte('started_at', start).lt('started_at', end).order('started_at');
      const list = (s as CallCenterShift[]) ?? [];
      // Trips booked in the days, plus those booked on these shifts after midnight (night shift).
      const [inDays, onShifts] = await Promise.all([
        supabase.from('dispatches').select('*').eq('created_by', agentId).gte('created_at', start).lt('created_at', end),
        list.length ? supabase.from('dispatches').select('*').in('shift_id', list.map((x) => x.id)) : Promise.resolve({ data: [] }),
      ]);
      const all = new Map<string, Dispatch>();
      for (const d of [...((inDays.data as Dispatch[]) ?? []), ...((onShifts.data as Dispatch[]) ?? [])]) all.set(d.id, d);
      setShifts(list);
      setDispatches([...all.values()].sort((x, y) => x.created_at.localeCompare(y.created_at)));
      setLoading(false);
    })();
  }, [agentId, from, to]);

  // Keep running trips fresh.
  useEffect(() => {
    if (!agentId) return;
    const ch = supabase.channel(`daily-report-${agentId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dispatches', filter: `created_by=eq.${agentId}` }, (p) => setDispatches((ds) => ds.map((d) => (d.id === (p.new as Dispatch).id ? (p.new as Dispatch) : d))))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [agentId]);

  // Which shift a trip belongs to: the shift it was booked on, else the one running at that time.
  const shiftOf = useMemo(() => (d: Dispatch) => shifts.find((s) => s.id === d.shift_id)
    ?? shifts.find((s) => d.created_at >= s.started_at && d.created_at <= (s.ended_at ?? new Date().toISOString())) ?? null, [shifts]);
  const days = useMemo(() => {
    const set = new Set<string>([...shifts.map((s) => dayOf(s.started_at)), ...dispatches.filter((d) => !shiftOf(d)).map((d) => dayOf(d.created_at))]);
    return [...set].sort().reverse();
  }, [shifts, dispatches, shiftOf]);

  const agents = people.filter((p) => p.dept === 'call_center' || p.id === agentId).sort((x, y) => Number(y.is_active) - Number(x.is_active) || x.full_name.localeCompare(y.full_name));
  const agentName = people.find((p) => p.id === agentId)?.full_name ?? profile?.full_name ?? 'Agent';
  const real = dispatches.filter((d) => !d.sandbox && d.status !== 'failed');
  const done = real.filter((d) => d.status === 'completed');
  const sum = (f: (s: CallCenterShift) => number) => shifts.reduce((n, s) => n + f(s), 0);
  const quick: [string, string, string][] = [['Today', today, today], ['Yesterday', addDays(today, -1), addDays(today, -1)], ['Last 7 days', addDays(today, -6), today], ['This month', `${today.slice(0, 8)}01`, today]];

  return (
    <div className="space-y-4 print:space-y-2">
      <PageHeader icon={FileText} title={`Daily report · ${agentName}`} subtitle={from === to ? longDay(from) : `${longDay(from)} to ${longDay(to)}`}
        actions={<button className="btn-secondary print:hidden" onClick={() => window.print()}><Printer size={14} /> Print</button>} />

      <div className="card p-3 flex flex-wrap items-center gap-2 text-small print:hidden">
        {a.isMd && (
          <select className="input py-1" value={agentId ?? ''} onChange={(e) => setQ({ agent: e.target.value })}>
            {agents.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.is_active ? '' : ' (left)'}</option>)}
          </select>
        )}
        {quick.map(([l, f, t]) => (
          <button key={l} className={`px-2 py-1 rounded-md border ${from === f && to === t ? 'border-brand text-brand bg-brand/5' : 'border-line text-fg-muted'}`} onClick={() => setQ({ from: f, to: t })}>{l}</button>
        ))}
        <span className="flex items-center gap-1.5 ml-auto">
          <CalendarDays size={14} className="text-fg-subtle" />
          <input type="date" className="input py-1" value={from} max={today} onChange={(e) => e.target.value && setQ({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} />
          <span className="text-fg-subtle">to</span>
          <input type="date" className="input py-1" value={to} min={from} max={today} onChange={(e) => e.target.value && setQ({ to: e.target.value })} />
        </span>
      </div>

      <StatGrid cols={5}>
        <StatCard label="Shifts" value={shifts.length} sub={shifts.length ? durationLabel(sum(shiftMinutes)) : undefined} />
        <StatCard label="Calls received" value={sum((s) => Number(s.report.calls_received ?? 0))} sub={`${sum((s) => Number(s.report.calls_missed ?? 0))} missed`} />
        <StatCard label="Calls made" value={sum((s) => Number(s.report.calls_made ?? 0))} />
        <StatCard label="Trips dispatched" value={real.length} sub={`${done.length} completed`} />
        <StatCard label="Fares, completed" value={fmtRwf(done.reduce((n, d) => n + Number(d.fare ?? 0), 0))} />
      </StatGrid>

      {loading ? <div className="h-40 skeleton rounded-xl" /> : days.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing in these days" body="No shift and no dispatched trip. Pick other days above." />
      ) : days.map((day) => {
        const dayShifts = shifts.filter((s) => dayOf(s.started_at) === day);
        const loose = dispatches.filter((d) => !shiftOf(d) && dayOf(d.created_at) === day);
        return (
          <section key={day} className="space-y-3 break-inside-avoid">
            <h2 className="text-ui font-semibold flex items-center gap-2 pt-2"><CalendarDays size={15} className="text-fg-subtle" />{longDay(day)}</h2>
            {dayShifts.map((s) => {
              const trips = dispatches.filter((d) => shiftOf(d)?.id === s.id);
              return (
                <div key={s.id} className="card p-4 space-y-3 break-inside-avoid">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ui font-semibold">{SLOT_LABEL[s.slot]}</p>
                    <span className="text-caption text-fg-muted flex items-center gap-1"><Clock size={12} /> {kTime(s.started_at)} – {s.ended_at ? kTime(s.ended_at) : 'still on shift'} · {durationLabel(shiftMinutes(s))} · {s.station}</span>
                    {s.late_minutes > 10 && <Label tone={s.late_minutes > 30 ? 'danger' : 'attention'}>{s.late_minutes} min late</Label>}
                    {s.status === 'auto_closed' && <Label tone="danger">Not ended</Label>}
                    {s.partner_id && <span className="text-caption text-fg-muted">with {people.find((p) => p.id === s.partner_id)?.full_name ?? '—'}</span>}
                  </div>
                  <ShiftReportBody shift={s} />
                  <Trips title={`Trips dispatched on this shift (${trips.length})`} trips={trips} onOpen={setOpen} />
                </div>
              );
            })}
            {loose.length > 0 && (
              <div className="card p-4 break-inside-avoid">
                <Trips title={`Trips dispatched outside a shift (${loose.length})`} trips={loose} onOpen={setOpen} />
              </div>
            )}
          </section>
        );
      })}

      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.client_name} subtitle={`Booked ${kTime(open.created_at)}`} maxWidth="max-w-lg">
          <LiveTrip d={open} onChange={setOpen} onBookAgain={() => { window.location.href = '/dispatch'; }} canCancel={open.created_by === profile?.id || a.isMd || a.dept === 'call_center'} bare />
        </Modal>
      )}
    </div>
  );
}

function Trips({ title, trips, onOpen }: { title: string; trips: Dispatch[]; onOpen: (d: Dispatch) => void }) {
  return (
    <div>
      <p className="text-caption font-semibold text-fg-muted mb-1 flex items-center gap-1.5"><Send size={12} /> {title}</p>
      {trips.length === 0 ? <p className="text-small text-fg-subtle">None.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-small min-w-[640px]">
            <thead><tr className="text-caption text-fg-subtle text-left border-b border-line-muted">
              {['Time', 'Client', 'From → to', 'Car', 'Status', 'Driver', 'Fare'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line-muted">
              {trips.map((d) => {
                const st = statusOf(d.status);
                return (
                  <tr key={d.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(d)}>
                    <td className="px-2 py-1.5 tabular-nums">{kTime(d.created_at)}</td>
                    <td className="px-2 py-1.5"><p className="font-medium">{d.client_name}</p><p className="text-caption text-fg-muted">{FOR_LABEL[d.for_kind]}</p></td>
                    <td className="px-2 py-1.5 max-w-[240px]"><p className="truncate">{d.pickup_address}</p><p className="truncate text-fg-muted">→ {d.destination_address}</p></td>
                    <td className="px-2 py-1.5 capitalize">{d.vehicle_type}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><Label tone={st.tone}>{st.label}</Label>{d.sandbox && <span className="ml-1"><Label tone="info">Test</Label></span>}</td>
                    <td className="px-2 py-1.5">{d.driver_name ?? '—'}{d.vehicle_plate && <p className="text-caption text-fg-muted">{d.vehicle_plate}</p>}</td>
                    <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{fmtRwf(d.fare ?? d.estimated_fare)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
