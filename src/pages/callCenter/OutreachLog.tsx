import { useMemo, useState } from 'react';
import { PlatformDriver } from '../../lib/supabase';
import { ANSWER_LABEL, APP_STATUS_SHORT, OutreachCall, RESULT_LABEL } from '../../lib/outreach';

// Every outreach call, day by day: who called whom, what they answered.
// The per-agent summary at the top is the outreach report for that day.
export default function OutreachLog({ calls, drivers, names }: { calls: OutreachCall[]; drivers: PlatformDriver[]; names: Record<string, string> }) {
  const kigaliDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
  const today = kigaliDay(new Date().toISOString());
  const [day, setDay] = useState(today);
  const [agent, setAgent] = useState('');
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const dayCalls = calls.filter((c) => kigaliDay(c.created_at) === day);
  const shown = dayCalls.filter((c) => !agent || c.agent_id === agent);
  const agents = [...new Set(dayCalls.map((c) => c.agent_id ?? ''))];
  const summary = agents.map((id) => {
    const list = dayCalls.filter((c) => (c.agent_id ?? '') === id);
    return {
      id, name: names[id] ?? 'Unknown', calls: list.length,
      reached: list.filter((c) => c.result === 'reached').length,
      noAnswer: list.filter((c) => c.result === 'no_answer').length,
      yes: list.filter((c) => c.interested).length,
      device: list.filter((c) => c.device_answer === 'yes').length,
      branding: list.filter((c) => c.branding_answer === 'yes').length,
      coming: list.filter((c) => c.app_status === 'will_come').length,
    };
  }).sort((a, b) => b.calls - a.calls);
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="block text-[11px] text-gray-500 mb-1">Day</span>
            <input type="date" value={day} max={today} onChange={(e) => { setDay(e.target.value || today); setAgent(''); }} className="input py-1.5" />
          </label>
          <div className="flex gap-1">
            {[0, 1].map((back) => {
              const d = new Date(Date.now() - back * 86400000).toISOString();
              return <button key={back} onClick={() => { setDay(kigaliDay(d)); setAgent(''); }} className={`btn-ghost text-[11px] ${day === kigaliDay(d) ? 'text-brand-600 dark:text-brand-300' : ''}`}>{back ? 'Yesterday' : 'Today'}</button>;
            })}
          </div>
          <p className="text-[12px] text-gray-500 ml-auto">{dayCalls.length} outreach call{dayCalls.length === 1 ? '' : 's'} on {new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
        </div>

        {summary.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[560px]">
              <thead><tr className="text-left text-gray-500 text-[11px]">
                {['Agent', 'Calls', 'Reached', 'No answer', 'Said yes', 'Device yes', 'Branding yes', 'Coming to office'].map((h, i) => <th key={h} className={`py-1.5 pr-3 font-medium ${i ? 'text-right' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.id} onClick={() => setAgent(agent === s.id ? '' : s.id)} className={`border-t border-gray-100 dark:border-white/5 cursor-pointer ${agent === s.id ? 'bg-brand/5' : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]'}`}>
                    <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                    {[s.calls, s.reached, s.noAnswer, s.yes, s.device, s.branding, s.coming].map((n, i) => <td key={i} className="py-1.5 pr-3 text-right tabular-nums">{n}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-400 mt-1">Click an agent to see only their calls.</p>
          </div>
        )}
      </div>

      <div className="card p-4">
        {shown.length === 0 ? <p className="text-[12px] text-gray-400 text-center py-8">No outreach calls logged on this day.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[820px]">
              <thead><tr className="text-left text-gray-500 text-[11px]">
                {['Time', 'Agent', 'Driver', 'Round', 'Result', 'Updated app', 'Device', 'Branding', 'Note'].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {shown.map((c) => {
                  const d = driverById.get(c.platform_driver_id);
                  return (
                    <tr key={c.id} className="border-t border-gray-100 dark:border-white/5 align-top">
                      <td className="py-1.5 pr-3 tabular-nums">{time(c.created_at)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{c.agent_id ? names[c.agent_id] ?? '—' : '—'}</td>
                      <td className="py-1.5 pr-3"><span className="font-medium">{d?.full_name ?? '—'}</span><span className="block text-[10px] text-gray-500">{d?.car?.plate_number ?? ''} {d?.phone ?? ''}</span></td>
                      <td className="py-1.5 pr-3">R{c.round}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{RESULT_LABEL[c.result]}{c.result === 'callback' && c.callback_at ? <span className="block text-[10px] text-gray-500">→ {new Date(c.callback_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> : null}</td>
                      <td className="py-1.5 pr-3">{c.app_status ? APP_STATUS_SHORT[c.app_status] : '—'}</td>
                      <td className="py-1.5 pr-3">{c.device_answer ? ANSWER_LABEL[c.device_answer] : '—'}</td>
                      <td className="py-1.5 pr-3">{c.branding_answer ? ANSWER_LABEL[c.branding_answer] : '—'}</td>
                      <td className="py-1.5 text-gray-600 dark:text-gray-300 max-w-[260px]">{c.note ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
