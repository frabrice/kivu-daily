import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { supabase, DriverCarAssignment } from '../../lib/supabase';
import { useFinanceData } from '../../lib/finance';
import { PerfEvent, today as kigaliToday } from '../../lib/performance';
import { mondayOf, shiftDay } from '../../lib/fleet';
import { CAUSES, computeLeakage, isManaged, shareOf, targetShareOf } from '../../lib/financeOverview';
import { Box } from '../../ui/kit';

// What the managed cars should earn Kivu Ride vs what they did, week by
// week (each car: 360,000 a week collected, 240,000 to its owner, 120,000
// ours) - the same calculation as the Finance overview, so they never
// disagree. For the MD and Finance (the 3-month "every franc" focus).

const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

export function ShouldVsDid({ weeks = 6, compact = false }: { weeks?: number; compact?: boolean }) {
  const fin = useFinanceData();
  const t = kigaliToday();
  const [extra, setExtra] = useState<{ events: PerfEvent[]; assignments: DriverCarAssignment[] } | null>(null);
  const load = useCallback(async () => {
    const [ev, as] = await Promise.all([
      supabase.from('driver_contract_events').select('driver_id, event_type, event_date'),
      supabase.from('driver_car_assignments').select('*').order('from_date'),
    ]);
    setExtra({ events: (ev.data as PerfEvent[]) ?? [], assignments: (as.data as DriverCarAssignment[]) ?? [] });
  }, []);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => {
    if (fin.loading || !extra) return [];
    const input = { vehicles: fin.vehicles, drivers: fin.drivers, deposits: fin.deposits, transactions: fin.transactions, assignments: extra.assignments, events: extra.events, owners: fin.owners };
    const thisMonday = mondayOf(t);
    return Array.from({ length: weeks }, (_, k) => {
      const from = shiftDay(thisMonday, -7 * k), to = k === 0 ? t : shiftDay(from, 6);
      const l = computeLeakage(input, { from, to }, t);
      return { from, to, current: k === 0, should: targetShareOf(l), did: shareOf(l), lost: l.lost, byCause: l.byCause, cars: l.cars.length };
    });
  }, [fin.loading, fin.vehicles, fin.drivers, fin.deposits, fin.transactions, fin.owners, extra, t, weeks]);
  if (!rows.length) return <div className="h-32 skeleton rounded-card" />;
  const cars = fin.vehicles.filter(isManaged).length;
  const full = rows.filter((r) => !r.current);
  const pct = (r: (typeof rows)[number]) => (r.should > 0 ? Math.round((r.did / r.should) * 100) : null);
  const label = (r: (typeof rows)[number]) => (r.current ? 'This week so far' : `${new Date(`${r.from}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(`${r.to}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
  const totalShould = full.reduce((s, r) => s + r.should, 0), totalDid = full.reduce((s, r) => s + r.did, 0);
  return (
    <Box title="Every franc: what the cars should earn us vs what they did" icon={Target} padded={false} right={<Link to="/finance" className="text-caption link">Per car in Finance</Link>}>
      <p className="px-4 pt-3 text-small">
        {cars} managed car{cars === 1 ? '' : 's'} · each should bring <b>120,000 a week</b> to Kivu Ride (360,000 collected − 240,000 to the owner).
        {full.length > 0 && <> Over the last {full.length} full weeks we kept <b>{short(totalDid)}</b> of <b>{short(totalShould)}</b> ({totalShould ? Math.round((totalDid / totalShould) * 100) : 0}%) — <b className="text-danger">{short(totalShould - totalDid)} lost</b>.</>}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-small min-w-[620px] mt-2">
          <thead><tr className="text-caption text-fg-muted text-left bg-inset"><th className="px-3 py-2">Week</th><th className="px-3 py-2 text-right">Should</th><th className="px-3 py-2 text-right">Did</th><th className="px-3 py-2 text-right">Kept</th>{!compact && CAUSES.map((c) => <th key={c.key} className="px-3 py-2 text-right" title={c.help}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r) => {
            const p = pct(r);
            return (
              <tr key={r.from} className={`border-t border-line-muted ${r.current ? 'bg-inset/50' : ''}`}>
                <td className="px-3 py-2 whitespace-nowrap">{label(r)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{short(r.should)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{short(r.did)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${p === null ? '' : p >= 98 ? 'text-success' : p >= 85 ? 'text-attention' : 'text-danger'}`}>{p === null ? '—' : `${p}%`}</td>
                {!compact && CAUSES.map((c) => <td key={c.key} className="px-3 py-2 text-right tabular-nums text-fg-muted">{r.byCause[c.key] ? short(r.byCause[c.key]) : '—'}</td>)}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-caption text-fg-muted border-t border-line-muted">Goal for the 3 months: 98% kept every week. "Drivers owing" can still be recovered; the rest is gone.</p>
    </Box>
  );
}
