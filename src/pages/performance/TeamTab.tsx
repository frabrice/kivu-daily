import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, ListTodo, Sparkles, XCircle, Zap } from 'lucide-react';
import { ChartCard, DailyBars, DailyLines, Kpi, MiniTable, longDay, pct, usePalette } from '../../components/charts/kit';
import { durationLabel } from '../../lib/shifts';
import { kDay, PerfData, Period, personRows, PersonRow, teamDaily, within } from '../../lib/performance';
import { EntityLink } from '../../os/EntityLink';

type SortKey = 'rate' | 'onTime' | 'given' | 'missed' | 'smart' | 'reply';

// Everyone's tasks: how many they get, finish, finish on time or miss, and
// how fast they answer the cases the Call Center hands them.
export default function TeamTab({ data, period: p }: { data: PerfData; period: Period }) {
  const c = usePalette();
  const [sort, setSort] = useState<SortKey>('rate');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => personRows(data, p), [data, p]);
  const daily = useMemo(() => teamDaily(data, p.from, p.to), [data, p.from, p.to]);

  const cases = useMemo(() => {
    const m = new Map<string, { n: number; replied: number; within2h: number; mins: number }>();
    for (const t of data.tickets) {
      if (!t.assignee_id || !within(kDay(t.assigned_at ?? t.created_at), p.from, p.to)) continue;
      const r = m.get(t.assignee_id) ?? { n: 0, replied: 0, within2h: 0, mins: 0 };
      r.n += 1;
      if (t.first_response_at) {
        const mins = (new Date(t.first_response_at).getTime() - new Date(t.assigned_at ?? t.created_at).getTime()) / 60000;
        if (mins >= 0) { r.replied += 1; r.mins += mins; if (mins <= 120) r.within2h += 1; }
      }
      m.set(t.assignee_id, r);
    }
    return m;
  }, [data.tickets, p.from, p.to]);

  const sum = (f: (r: PersonRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const given = sum((r) => r.given), done = sum((r) => r.done), onTime = sum((r) => r.onTime), missed = sum((r) => r.missed);
  const smartItems = sum((r) => r.smartItems), smartDone = sum((r) => r.smartDone), auto = sum((r) => r.auto);
  const urgent = sum((r) => r.urgent), urgentDone = sum((r) => r.urgentDone);

  const replyAvg = (id: string) => { const x = cases.get(id); return x && x.replied ? x.mins / x.replied : null; };
  const sorted = [...rows].sort((a, b) => {
    const v = (r: PersonRow) => sort === 'rate' ? r.done / r.given : sort === 'onTime' ? r.onTime / r.given : sort === 'given' ? r.given : sort === 'missed' ? -r.missed : sort === 'smart' ? r.smartDone : -(replyAvg(r.id) ?? 1e9);
    return v(b) - v(a);
  });
  const stack = daily.map((d) => ({ day: d.day, done: d.done, not_done: d.given - d.done }));
  const th = (k: SortKey | null, label: string, right = true) => (
    <th className={`py-1.5 pr-3 font-medium ${right ? 'text-right' : ''}`}>
      {k ? <button onClick={() => setSort(k)} className={`hover:text-brand-600 ${sort === k ? 'text-brand-600 dark:text-brand-300' : ''}`}>{label}{sort === k ? ' ↓' : ''}</button> : label}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={ListTodo} label="Tasks given" value={given} sub={`${rows.length} people with tasks in this period`} />
        <Kpi icon={CheckCircle2} label="Done" value={given ? `${pct(done, given)}%` : '—'} sub={`${done} done · ${given ? pct(onTime, given) : 0}% on time (by the day and hour due)`} />
        <Kpi icon={XCircle} label="Missed" value={missed} tone={missed ? 'bad' : undefined} sub="Past their day and never done" />
        <Kpi icon={Sparkles} label="Smart task items" value={smartItems ? `${smartDone}/${smartItems}` : '—'} sub={`${auto} smart task${auto === 1 ? '' : 's'} finished themselves when the work was done · ${urgentDone}/${urgent} urgent done`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Team completion per day" subtitle="Share of each day's tasks that got done"
          table={<MiniTable head={['Day', 'Given', 'Done', 'Rate']} rows={[...daily].reverse().filter((d) => d.given).map((d) => [longDay(d.day), d.given, d.done, `${d.rate}%`])} />}>
          {given === 0 ? <p className="text-small text-fg-subtle text-center py-10">No tasks in this period.</p> : <DailyLines data={daily} series={[{ key: 'rate', label: 'Done', color: c.blue }]} c={c} domain={[0, 100]} format={(n) => `${n}%`} />}
        </ChartCard>
        <ChartCard title="Tasks per day" subtitle="Done and not done" legend={[{ key: 'done', label: 'Done', color: c.blue }, { key: 'not_done', label: 'Not done', color: c.orange }]}>
          {given === 0 ? <p className="text-small text-fg-subtle text-center py-10">No tasks in this period.</p> : <DailyBars data={stack} series={[{ key: 'done', label: 'Done', color: c.blue }, { key: 'not_done', label: 'Not done', color: c.orange }]} c={c} />}
        </ChartCard>
      </div>

      <div className="card p-4 space-y-2">
        <div>
          <p className="text-body font-semibold">Everyone</p>
          <p className="text-caption text-fg-muted">Click a column to sort, a name to see their tasks. Cases = Call Center cases handed to them; first reply is the target of 2 hours.</p>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-caption min-w-[900px]">
            <thead><tr className="text-left text-fg-muted">
              {th(null, 'Person', false)}{th(null, 'Department', false)}{th('given', 'Tasks')}{th('rate', 'Done')}{th('onTime', 'On time')}<th className="py-1.5 pr-3 font-medium text-right">Late</th>{th('missed', 'Missed')}
              <th className="py-1.5 pr-3 font-medium text-right">Carried over</th>{th('smart', 'Smart items')}<th className="py-1.5 pr-3 font-medium text-right">Cases</th>{th('reply', 'First reply')}
            </tr></thead>
            <tbody>
              {sorted.map((r) => {
                const cs = cases.get(r.id);
                const reply = replyAvg(r.id);
                const rate = pct(r.done, r.given) ?? 0;
                return (
                  <FragmentRow key={r.id} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} cols={11}
                    cells={[
                      <EntityLink type="person" id={r.id} label={r.name} />,
                      <span className="text-fg-muted">{r.dept}</span>,
                      r.given,
                      <span className={rate < 60 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>{rate}%</span>,
                      `${pct(r.onTime, r.given)}%`,
                      r.late || '—',
                      <span className={r.missed ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-fg-subtle'}>{r.missed || '—'}</span>,
                      r.carried || '—',
                      r.smartItems ? `${r.smartDone}/${r.smartItems}` : '—',
                      cs ? `${cs.n}${cs.replied ? ` · ${pct(cs.within2h, cs.replied)}% in 2h` : ''}` : '—',
                      reply === null ? '—' : <span className={reply > 120 ? 'text-red-600 dark:text-red-400' : ''}>{durationLabel(reply)}</span>,
                    ]}>
                    <PersonTasks data={data} period={p} id={r.id} />
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="text-small text-fg-subtle text-center py-6">No tasks in this period.</p>}
      </div>
    </div>
  );
}

function FragmentRow({ cells, open, onToggle, cols, children }: { cells: React.ReactNode[]; open: boolean; onToggle: () => void; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr onClick={onToggle} className={`border-t border-line-muted cursor-pointer ${open ? 'bg-brand/5' : 'hover:bg-hover '}`}>
        {cells.map((v, i) => <td key={i} className={`py-2 pr-3 ${i > 1 ? 'text-right tabular-nums' : ''} whitespace-nowrap`}>{v}</td>)}
      </tr>
      {open && <tr><td colSpan={cols} className="pb-3">{children}</td></tr>}
    </>
  );
}

function PersonTasks({ data, period: p, id }: { data: PerfData; period: Period; id: string }) {
  const list = data.tasks.filter((t) => t.user_id === id && within(t.date, p.from, p.to)).sort((a, b) => b.date.localeCompare(a.date));
  const today = kDay(new Date().toISOString());
  return (
    <div className="rounded-lg border border-line-muted p-2 max-h-72 overflow-y-auto">
      <table className="w-full text-caption">
        <tbody>
          {list.map((t) => {
            const late = t.completed && t.completed_at && kDay(t.completed_at) > t.date;
            return (
              <tr key={t.id} className="border-t first:border-t-0 border-line-muted ">
                <td className="py-1 pr-3 whitespace-nowrap text-fg-muted">{longDay(t.date)}{t.due_time ? ` · ${t.due_time.slice(0, 5)}` : ''}</td>
                <td className="py-1 pr-3">{t.title}{t.smart_key && <span className="ml-1.5 text-micro font-semibold text-violet-700 dark:text-violet-300"><Zap size={9} className="inline -mt-0.5" /> {t.smart_done ?? 0}/{t.smart_total ?? 0}</span>}</td>
                <td className="py-1 text-right whitespace-nowrap">
                  {t.completed
                    ? <span className={late ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>{t.auto_completed ? 'Done by itself' : late ? `Done late (${longDay(kDay(t.completed_at!))})` : 'Done'}</span>
                    : t.date < today ? <span className="text-red-600 dark:text-red-400">Missed</span> : <span className="text-fg-muted flex items-center gap-1 justify-end"><Clock size={10} /> Open</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
