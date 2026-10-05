import { useEffect, useMemo, useState } from 'react';
import { Timer, AlertTriangle } from 'lucide-react';
import { supabase, Profile } from '../../lib/supabase';
import { CallCenterShift, durationLabel, INCOMING_TYPES, OUTGOING_TYPES, SLOT_LABEL } from '../../lib/shifts';
import Modal from '../../components/Modal';

// MD: every Call Center shift - time on shift, lateness, what the agent
// reported (calls received / made / missed) against what they logged in
// Kivu Daily - and a per-agent summary over 7 or 30 days.
export default function ShiftsPerformancePage() {
  const [shifts, setShifts] = useState<CallCenterShift[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [days, setDays] = useState<7 | 30>(7);
  const [open, setOpen] = useState<CallCenterShift | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    Promise.all([
      supabase.from('call_center_shifts').select('*').gte('started_at', since).order('started_at', { ascending: false }),
      supabase.from('profiles').select('*'),
    ]).then(([s, p]) => {
      setShifts((s.data as CallCenterShift[]) ?? []);
      setProfiles((p.data as Profile[]) ?? []);
      setLoading(false);
    });
  }, []);

  const name = (id: string | null) => profiles.find((p) => p.id === id)?.full_name.trim() ?? '—';
  const minutesOf = (s: CallCenterShift) => (s.stats.minutes ?? (new Date(s.ended_at ?? Date.now()).getTime() - new Date(s.started_at).getTime()) / 60000);
  const inRange = shifts.filter((s) => Date.now() - new Date(s.started_at).getTime() <= days * 86400000);

  const perAgent = useMemo(() => {
    const m = new Map<string, CallCenterShift[]>();
    for (const s of inRange) m.set(s.agent_id, [...(m.get(s.agent_id) ?? []), s]);
    return [...m].map(([id, list]) => {
      const sum = (f: (s: CallCenterShift) => number) => list.reduce((a, s) => a + f(s), 0);
      const contacts = sum((s) => s.stats.contacts_logged ?? 0);
      const solved = sum((s) => s.stats.solved_on_call ?? 0);
      return {
        id, shifts: list.length, minutes: sum(minutesOf), late: list.filter((s) => s.late_minutes > 10).length,
        received: sum((s) => Number(s.report.calls_received ?? 0)), made: sum((s) => Number(s.report.calls_made ?? 0)),
        missed: sum((s) => Number(s.report.calls_missed ?? 0)), contacts, solvedPct: contacts ? Math.round((solved / contacts) * 100) : null,
        driverCalls: sum((s) => s.stats.driver_calls ?? 0), closed: sum((s) => s.stats.cases_closed ?? 0),
        notClosed: list.filter((s) => s.status === 'auto_closed').length,
      };
    }).sort((a, b) => b.minutes - a.minutes);
  }, [inRange]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>;

  const th = 'px-3 py-2 font-medium text-left';
  const td = 'px-3 py-2';
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Timer size={16} className="text-brand-600 dark:text-brand-300" /> Shifts & performance</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Agents start a shift when they sign in and must end it with a report before signing out. "Reported" numbers are the agent's; "Logged" are what Kivu Daily recorded.</p>
        </div>
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg" role="tablist">
          {([7, 30] as const).map((d) => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)} className={`px-3 py-1 rounded-md text-[12px] font-medium ${days === d ? 'bg-white dark:bg-navy-800 shadow-sm' : 'text-gray-500'}`}>Last {d} days</button>
          ))}
        </div>
      </div>

      {perAgent.length === 0 ? (
        <div className="card p-10 text-center text-[12px] text-gray-400">No shifts in the last {days} days.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[12px] min-w-[760px]">
            <thead><tr className="text-[11px] text-gray-400 border-b border-gray-100 dark:border-white/5">
              <th className={th}>Agent</th><th className={th}>Shifts</th><th className={th}>Time on shift</th><th className={th}>Late starts</th>
              <th className={th}>Calls in / out / missed (reported)</th><th className={th}>Contacts logged</th><th className={th}>Solved on the spot</th><th className={th}>Driver calls</th><th className={th}>Cases closed</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {perAgent.map((a) => (
                <tr key={a.id}>
                  <td className={`${td} font-medium`}>{name(a.id)}{a.notClosed > 0 && <span className="ml-1.5 text-[10px] text-red-600" title="Shifts not ended properly">⚠ {a.notClosed}</span>}</td>
                  <td className={td}>{a.shifts}</td>
                  <td className={td}>{durationLabel(a.minutes)}</td>
                  <td className={`${td} ${a.late ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-400'}`}>{a.late || '—'}</td>
                  <td className={td}>{a.received} / {a.made} / {a.missed}</td>
                  <td className={td}>{a.contacts}</td>
                  <td className={td}>{a.solvedPct === null ? '—' : `${a.solvedPct}%`}</td>
                  <td className={td}>{a.driverCalls}</td>
                  <td className={td}>{a.closed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card divide-y divide-gray-100 dark:divide-white/5">
        {inRange.map((s) => (
          <button key={s.id} onClick={() => setOpen(s)} className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.03] flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <p className="text-[12px] font-medium">{name(s.agent_id)}{s.partner_id ? <span className="text-gray-400 font-normal"> with {name(s.partner_id)}</span> : null}</p>
              <p className="text-[11px] text-gray-400">{new Date(s.started_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {SLOT_LABEL[s.slot]} · {s.station}</p>
            </div>
            <span className="text-[11px] text-gray-500">{new Date(s.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}–{s.ended_at ? new Date(s.ended_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'now'} · {durationLabel(minutesOf(s))}</span>
            {s.late_minutes > 10 && <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">{s.late_minutes} min late</span>}
            {s.status === 'open' && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">On shift now</span>}
            {s.status === 'auto_closed' && <span className="text-[10px] font-medium text-red-600 flex items-center gap-0.5"><AlertTriangle size={10} /> Not ended properly</span>}
            {s.status === 'closed' && <span className="text-[11px] text-gray-500">{s.report.calls_received ?? 0} in · {s.report.calls_made ?? 0} out · {s.stats.contacts_logged ?? 0} logged</span>}
          </button>
        ))}
      </div>

      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${name(open.agent_id)} — ${SLOT_LABEL[open.slot]}`} subtitle={`${new Date(open.started_at).toLocaleString('en-GB')} · ${durationLabel(minutesOf(open))} · ${open.station}`} maxWidth="max-w-lg">
          <div className="space-y-3 text-[12px]">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {[['Calls received', open.report.calls_received], ['Calls made', open.report.calls_made], ['Missed', open.report.calls_missed], ['WhatsApp/SMS', open.report.messages_handled],
                ['Contacts logged', open.stats.contacts_logged], ['Solved on the spot', open.stats.solved_on_call], ['Handed on', open.stats.handed_on], ['Cases closed', open.stats.cases_closed],
                ['Outreach calls', open.stats.outreach_calls], ['Bookings', open.stats.bookings], ['Emergencies', open.stats.emergencies], ['Late (min)', open.late_minutes]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-2 text-center"><p className="text-[14px] font-bold">{(v as number | undefined) ?? '—'}</p><p className="text-[10px] text-gray-500">{l}</p></div>
              ))}
            </div>
            {open.report.in_passengers !== undefined && (
              <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
                {([['Received', INCOMING_TYPES], ['Made', OUTGOING_TYPES]] as const).map(([l, types]) => (
                  <div key={l} className="rounded-lg border border-gray-100 dark:border-white/10 p-2">
                    <p className="font-semibold mb-0.5">{l}</p>
                    {types.map((t) => <p key={t.key} className="flex justify-between text-gray-600 dark:text-gray-300"><span>{t.label}</span><b>{open.report[t.key] ?? 0}</b></p>)}
                  </div>
                ))}
              </div>
            )}
            {([['Worked on', open.report.worked_on], ['Resolved', open.report.resolved_summary], ['Still unresolved', open.report.unresolved_summary], ['Problems', open.report.problems], ['Caller feedback', open.report.feedback], ['Suggestions', open.report.suggestions]] as [string, string | undefined][])
              .filter(([, v]) => v && v.trim()).map(([l, v]) => (
                <div key={l}><p className="text-[11px] font-semibold text-gray-500">{l}</p><p className="whitespace-pre-wrap">{v}</p></div>
              ))}
            {open.status === 'auto_closed' && <p className="text-red-600">This shift wasn't ended — it was closed automatically after 10 hours, so there's no report.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
