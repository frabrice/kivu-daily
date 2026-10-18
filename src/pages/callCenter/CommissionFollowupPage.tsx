import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Coins, PhoneCall, Save, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { addDays } from '../../lib/it';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import type { Tone } from '../../ui/kit';

// Commission follow-up: the commissions are in the Kivu Ride dashboard;
// every morning the Call Center calls each driver with yesterday's unpaid
// commission and records the outcome here (migration 20261026110000).

type Outcome = 'paid' | 'promised' | 'no_answer' | 'refused' | 'wrong_number';
interface Followup { id: string; day: string; driver_name: string; driver_phone: string | null; amount_owed: number; outcome: Outcome; promised_date: string | null; amount_paid: number | null; note: string | null; agent_id: string | null; created_at: string }
const OUTCOME: Record<Outcome, { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'success' }, promised: { label: 'Promised', tone: 'attention' }, no_answer: { label: 'No answer', tone: 'neutral' },
  refused: { label: 'Refused', tone: 'danger' }, wrong_number: { label: 'Wrong number', tone: 'neutral' },
};
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const key = (n: string) => n.trim().toLowerCase();

export default function CommissionFollowupPage() {
  usePageTitle('Commission follow-up');
  const { profile } = useAuth();
  const a = useAccess();
  const t = today();
  const [rows, setRows] = useState<Followup[]>([]);
  const [drivers, setDrivers] = useState<{ name: string; phone: string }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [f, setF] = useState({ driver_name: '', driver_phone: '', amount_owed: '', outcome: 'paid' as Outcome, promised_date: addDays(t, 1), amount_paid: '', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canLog = a.isMd || a.dept === 'call_center';
  const load = useCallback(async () => {
    const [r, p, d, ppl] = await Promise.all([
      supabase.from('commission_followups').select('*').gte('day', addDays(t, -30)).order('created_at', { ascending: false }),
      supabase.from('platform_drivers').select('full_name, phone'),
      supabase.from('drivers').select('full_name, phone, contract_status'),
      supabase.from('profiles').select('id, full_name'),
    ]);
    setRows(((r.data as Followup[]) ?? []).sort((x, y) => y.created_at.localeCompare(x.created_at)));
    const list = [...((p.data ?? []) as { full_name: string; phone: string }[]), ...((d.data ?? []) as { full_name: string; phone: string; contract_status: string }[]).filter((x) => x.contract_status === 'active')]
      .map((x) => ({ name: x.full_name.trim(), phone: x.phone })).filter((x, i, arr) => arr.findIndex((y) => key(y.name) === key(x.name)) === i).sort((x, y) => x.name.localeCompare(y.name));
    setDrivers(list);
    setNames(Object.fromEntries(((ppl.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name.trim()])));
  }, [t]);
  useEffect(() => {
    load();
    const ch = supabase.channel('commission-followups').on('postgres_changes', { event: '*', schema: 'public', table: 'commission_followups' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  // The latest outcome per driver tells who still owes.
  const latest = useMemo(() => {
    const m = new Map<string, Followup>();
    for (const r of rows) if (!m.has(key(r.driver_name))) m.set(key(r.driver_name), r);
    return [...m.values()];
  }, [rows]);
  const callAgain = latest.filter((r) => (r.outcome === 'promised' && (r.promised_date ?? t) <= t) || ((r.outcome === 'no_answer' || r.outcome === 'wrong_number') && r.day < t));
  const escalate = latest.filter((r) => r.outcome !== 'paid' && rows.filter((x) => key(x.driver_name) === key(r.driver_name) && x.outcome !== 'paid').length >= 2 && (r.outcome === 'refused' || rows.filter((x) => key(x.driver_name) === key(r.driver_name)).some((x) => x.day <= addDays(t, -2))));
  const todays = rows.filter((r) => r.day === t);
  const week = rows.filter((r) => r.day >= addDays(t, -6));
  const collectedWeek = week.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0);
  const owedOpen = latest.filter((r) => r.outcome !== 'paid').reduce((s, r) => s + Number(r.amount_owed), 0);
  const pick = (name: string) => { const d = drivers.find((x) => key(x.name) === key(name)); setF({ ...f, driver_name: name, driver_phone: d?.phone ?? f.driver_phone }); };
  const save = async () => {
    if (!f.driver_name.trim()) { setError('Which driver?'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.from('commission_followups').insert({
      driver_name: f.driver_name.trim(), driver_phone: f.driver_phone.trim() || null, amount_owed: Number(f.amount_owed) || 0, outcome: f.outcome,
      promised_date: f.outcome === 'promised' ? f.promised_date : null, amount_paid: f.outcome === 'paid' ? Number(f.amount_paid || f.amount_owed) || 0 : null, note: f.note.trim() || null, agent_id: profile?.id,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setF({ driver_name: '', driver_phone: '', amount_owed: '', outcome: 'paid', promised_date: addDays(t, 1), amount_paid: '', note: '' });
    load();
  };
  const again = (r: Followup) => setF({ driver_name: r.driver_name, driver_phone: r.driver_phone ?? '', amount_owed: String(r.amount_owed), outcome: 'paid', promised_date: addDays(t, 1), amount_paid: '', note: '' });
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Coins} title="Commission follow-up" subtitle="Every morning: open yesterday's unpaid commissions in the Kivu Ride dashboard, call each driver, and record what they said here. Nobody should owe commission for more than a day." />
      <StatGrid cols={4}>
        <StatCard icon={PhoneCall} label="Followed up today" value={todays.length} sub={`${todays.filter((r) => r.outcome === 'paid').length} paid · ${todays.filter((r) => r.outcome === 'promised').length} promised`} />
        <StatCard label="Collected this week" value={rwf(collectedWeek)} sub="after a call" />
        <StatCard label="Still owed" value={rwf(owedOpen)} sub={`${latest.filter((r) => r.outcome !== 'paid').length} drivers, last call not paid`} tone={owedOpen ? 'attention' : undefined} />
        <StatCard icon={AlertTriangle} label="For the MD" value={escalate.length} sub="2+ days unpaid, or refused" tone={escalate.length ? 'danger' : undefined} />
      </StatGrid>
      {canLog && (
        <Box title="Record a call" icon={PhoneCall} className="mb-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <label className="block md:col-span-2"><span className="text-caption text-fg-muted">Driver *</span><input value={f.driver_name} onChange={(e) => pick(e.target.value)} list="cf-drivers" className="input" placeholder="Name as in the dashboard" /><datalist id="cf-drivers">{drivers.map((d) => <option key={d.name} value={d.name} />)}</datalist></label>
            <label className="block"><span className="text-caption text-fg-muted">Phone</span><input value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} className="input" /></label>
            <label className="block"><span className="text-caption text-fg-muted">Owed (RWF)</span><input value={f.amount_owed} onChange={(e) => setF({ ...f, amount_owed: e.target.value.replace(/[^\d]/g, '') })} className="input" inputMode="numeric" /></label>
            <div className="md:col-span-2"><span className="text-caption text-fg-muted">What happened</span><div className="flex flex-wrap gap-1 mt-1">{(Object.keys(OUTCOME) as Outcome[]).map((o) => <button key={o} type="button" onClick={() => setF({ ...f, outcome: o })} className={`px-2.5 py-1 rounded-full text-caption border ${f.outcome === o ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{OUTCOME[o].label}</button>)}</div></div>
            {f.outcome === 'paid' && <label className="block"><span className="text-caption text-fg-muted">Paid (RWF)</span><input value={f.amount_paid} onChange={(e) => setF({ ...f, amount_paid: e.target.value.replace(/[^\d]/g, '') })} className="input" placeholder={f.amount_owed || 'amount'} inputMode="numeric" /></label>}
            {f.outcome === 'promised' && <label className="block"><span className="text-caption text-fg-muted">Promised for</span><input type="date" value={f.promised_date} min={t} onChange={(e) => setF({ ...f, promised_date: e.target.value })} className="input" /></label>}
            <label className="block md:col-span-4"><span className="text-caption text-fg-muted">Note</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="input" /></label>
            <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50"><Save size={14} /> Save</button>
          </div>
          {error && <p className="mt-2 text-caption text-danger">{error}</p>}
        </Box>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Box title={`Call again (${callAgain.length})`} icon={PhoneCall} padded={false}>
          {callAgain.length ? <ul className="divide-y divide-line-muted">{callAgain.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-small"><span className="flex-1"><b>{r.driver_name}</b>{r.driver_phone ? ` · ${r.driver_phone}` : ''}<span className="block text-caption text-fg-muted">{OUTCOME[r.outcome].label}{r.promised_date ? ` for ${r.promised_date}` : ''} · {rwf(Number(r.amount_owed))}</span></span>{canLog && <button onClick={() => again(r)} className="btn-secondary h-7">Record</button>}</li>
          ))}</ul> : <p className="p-5 text-small text-fg-muted">Nobody to call again.</p>}
        </Box>
        <Box title={`For the MD (${escalate.length})`} icon={AlertTriangle} padded={false}>
          {escalate.length ? <ul className="divide-y divide-line-muted">{escalate.map((r) => (
            <li key={r.id} className="px-4 py-2 text-small"><b>{r.driver_name}</b> · {rwf(Number(r.amount_owed))} · last: {OUTCOME[r.outcome].label} ({r.day}){r.note ? <span className="block text-caption text-fg-muted">{r.note}</span> : null}</li>
          ))}</ul> : <p className="p-5 text-small text-fg-muted">Nobody is 2 days late.</p>}
        </Box>
      </div>
      <Box title="Calls recorded (30 days)" icon={Check} padded={false}>
        <div className="overflow-x-auto"><table className="w-full text-small min-w-[700px]">
          <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Day', 'Driver', 'Owed', 'Outcome', 'Paid', 'Agent', 'Note', ''].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 150).map((r) => (
            <tr key={r.id} className="border-t border-line-muted"><td className="px-3 py-2 whitespace-nowrap">{r.day}</td><td className="px-3 py-2">{r.driver_name}</td><td className="px-3 py-2 tabular-nums">{rwf(Number(r.amount_owed))}</td><td className="px-3 py-2"><Label tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Label>{r.promised_date ? <span className="text-caption text-fg-muted"> {r.promised_date}</span> : null}</td>
              <td className="px-3 py-2 tabular-nums">{r.amount_paid !== null ? rwf(Number(r.amount_paid)) : '—'}</td><td className="px-3 py-2 text-caption">{(names[r.agent_id ?? ''] ?? '—').split(' ')[0]}</td><td className="px-3 py-2 text-caption text-fg-muted max-w-[220px] truncate">{r.note}</td>
              <td className="px-3 py-2">{(a.isMd || (r.agent_id === profile?.id && r.day === t)) && <button onClick={async () => { await supabase.from('commission_followups').delete().eq('id', r.id); load(); }} className="btn-ghost p-1" aria-label="Delete"><X size={12} /></button>}</td></tr>
          ))}</tbody>
        </table></div>
        {!rows.length && <p className="p-5 text-small text-fg-muted">No calls recorded yet.</p>}
      </Box>
    </div>
  );
}
