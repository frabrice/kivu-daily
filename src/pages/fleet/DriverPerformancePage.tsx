import { ReactNode, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, ChevronDown, Clock, Hand, Navigation, RefreshCw, Search, Timer, Wifi, XCircle } from 'lucide-react';
import { DriverStats, OUTCOME, Outcome, PERIOD_LABEL, Period, hm, pctText, useDriverPerformance } from '../../lib/driverPerformance';
import { kFormat } from '../../lib/kigali';
import { usePageTitle } from '../../os/workspace';
import { EntityLink } from '../../os/EntityLink';
import { PageHeader, rwfShort } from '../../ui/kit';
import { CardLines, DriverAvatar, HoverCard } from '../../components/fleet/driverUi';

// Driver performance (MD, 28 Nov 2026): every driver on a car we manage -
// time online during their shift, trips done, and what they do with the
// offers the app sends them. Ours On Shift stays the live "call them now"
// page; this one is the record over days.

type SortKey = 'least' | 'most' | 'trips' | 'ignored' | 'accept' | 'name';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'least', label: 'Least online first' },
  { key: 'most', label: 'Most online first' },
  { key: 'trips', label: 'Most trips' },
  { key: 'accept', label: 'Lowest acceptance' },
  { key: 'ignored', label: 'Most offers ignored' },
  { key: 'name', label: 'Name' },
];
const PERIODS: Period[] = ['today', 'yesterday', '7d', '30d'];
// Offer outcomes: status colours, always with their name next to them.
const OUT_FILL: Record<Exclude<Outcome, 'lost' | 'other'>, string> = { accepted: 'bg-success', dropped: 'bg-done', refused: 'bg-danger', ignored: 'bg-attention' };
const OUT_ORDER = ['accepted', 'dropped', 'refused', 'ignored'] as const;
const clock = (ms: number) => kFormat(ms, 'en-GB', { hour: '2-digit', minute: '2-digit' });
const dayShort = (day: string) => kFormat(Date.parse(`${day}T12:00:00+02:00`), 'en-GB', { weekday: 'short', day: 'numeric' });
const dayLong = (day: string) => kFormat(Date.parse(`${day}T12:00:00+02:00`), 'en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const seatOf = (x: DriverStats['d']) => (x.model === 'solo_car' ? 'Solo car' : x.shift === 'full' ? 'Day & night' : x.shift === 'day' ? 'Day shift' : x.shift === 'night' ? 'Night shift' : 'No shift');
const GRID = 'lg:grid-cols-[minmax(220px,1.35fr)_minmax(170px,1fr)_minmax(96px,0.55fr)_minmax(104px,0.6fr)_minmax(190px,1.1fr)_minmax(120px,0.7fr)_24px]';

export default function DriverPerformancePage() {
  usePageTitle('Driver performance');
  const [params, setParams] = useSearchParams();
  const period = (PERIODS.includes(params.get('p') as Period) ? params.get('p') : '7d') as Period;
  const setPeriod = (p: Period) => { const n = new URLSearchParams(params); n.set('p', p); setParams(n, { replace: true }); };
  const { data, error, reload } = useDriverPerformance(period);
  const [sort, setSort] = useState<SortKey>('least');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const one = period === 'today' || period === 'yesterday';

  const rows = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    const list = data.stats.filter((s) => !n || [s.d.name, s.d.plate, s.d.phone].join(' ').toLowerCase().includes(n));
    const share = (s: DriverStats) => s.total.shiftShare ?? (s.inApp ? -1 : -2);
    const by: Record<SortKey, (a: DriverStats, b: DriverStats) => number> = {
      least: (a, b) => (a.inApp === b.inApp ? 0 : a.inApp ? -1 : 1) || share(a) - share(b),
      most: (a, b) => share(b) - share(a),
      trips: (a, b) => b.total.trips - a.total.trips,
      accept: (a, b) => (a.total.acceptRate ?? 2) - (b.total.acceptRate ?? 2),
      ignored: (a, b) => b.total.ignored - a.total.ignored,
      name: () => 0,
    };
    return [...list].sort((a, b) => by[sort](a, b) || a.d.name.localeCompare(b.d.name));
  }, [data, q, sort]);

  const team = useMemo(() => {
    const s = (data?.stats ?? []).filter((x) => x.inApp);
    const t = s.reduce((a, x) => ({
      shift: a.shift + x.total.shiftMin, inShift: a.inShift + x.total.inShiftMin, online: a.online + x.total.onlineMin, trips: a.trips + x.total.trips, fare: a.fare + x.total.fare,
      dueDays: a.dueDays + x.total.dueDays, answered: a.answered + x.total.answered, offered: a.offered + x.total.offered, ignored: a.ignored + x.total.ignored, refused: a.refused + x.total.refused, dropped: a.dropped + x.total.dropped,
    }), { dueDays: 0, shift: 0, inShift: 0, online: 0, trips: 0, fare: 0, answered: 0, offered: 0, ignored: 0, refused: 0, dropped: 0 });
    const driverDays = s.reduce((a, x) => a + x.total.workDays, 0);
    return { ...t, drivers: s.length, working: s.filter((x) => x.total.shiftMin > 0).length, notInApp: (data?.stats.length ?? 0) - s.length, driverDays };
  }, [data]);

  const refresh = async () => { setBusy(true); await reload(); setBusy(false); };

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Activity} title="Driver performance"
        subtitle="Every driver on a car we manage: time online in their shift, trips done, and how they answer the app's offers."
        meta={data ? <>
          <span>{data.stats.length} drivers · {data.days.length === 1 ? dayLong(data.days[0]) : `${dayShort(data.days[0])} – ${dayShort(data.days[data.days.length - 1])}`}</span>
          <span>Updated {clock(data.now)} · every 2 minutes</span>
        </> : null}
        actions={<>
          <div className="inline-flex p-0.5 rounded-lg bg-inset border border-line" role="radiogroup" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} role="radio" aria-checked={period === p} onClick={() => setPeriod(p)}
                className={`h-7 px-3 rounded-md text-caption font-medium transition-colors ${period === p ? 'bg-surface text-fg shadow-sm border border-line' : 'text-fg-muted hover:text-fg'}`}>{PERIOD_LABEL[p]}</button>
            ))}
          </div>
          <button onClick={refresh} disabled={busy} className="btn-ghost" aria-label="Refresh"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button>
        </>} />

      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">Couldn't load the numbers: {error}</p>}
      {data && !data.offersReady && (
        <p className="mb-3 text-caption text-fg-muted bg-surface-2 border border-line rounded-md px-3 py-2 flex items-center gap-2">
          <Clock size={13} className="shrink-0" />
          <span>Offers (accepted, refused, ignored) start once the new trip reading is switched on. Online time and trips are already here.</span>
        </p>
      )}
      {data && data.offersPending > 0 && (
        <p className="mb-3 text-caption text-fg-muted bg-surface-2 border border-line rounded-md px-3 py-2 flex items-center gap-2">
          <Clock size={13} className="shrink-0" />
          <span>Offers are still being read from the app: {data.offersPending.toLocaleString('en-US')} older trips to go (about {Math.max(2, Math.ceil(data.offersPending / 20))} min). Offer numbers for earlier days fill in as they arrive.</span>
        </p>
      )}

      {!data ? <Skeleton /> : (<>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <Tile label={one ? 'Online so far, per driver' : 'Online a day'} icon={Wifi} value={team.dueDays >= 0.05 ? hm(one ? team.inShift / Math.max(1, team.working) : team.inShift / team.dueDays) : '—'}
            sub={team.shift ? `per driver · ${pctText(team.inShift / team.shift)} of their hours` : 'No working days yet'}
            card={<CardLines title="Online a day, per driver" lines={[{ label: 'Their hours', value: hm(team.shift) }, { label: 'Online during them', value: hm(team.inShift) }, { label: 'Working days', value: team.dueDays.toFixed(1) }]} note="Their hours: the whole day for a Solo car or day & night, else their shift. Rest days, approved days off and days before their start don't count. Today counts up to now." />} />
          <Tile label="Hours online" icon={Timer} value={hm(team.online)}
            sub="All drivers, any time of day"
            card={<CardLines title="Hours online" lines={[{ label: 'All drivers, any time of day', value: hm(team.online) }, { label: 'Driver-days with a shift', value: String(team.driverDays) }]} note="Online = switched online in the Kivu Ride driver app, on a trip or waiting for one." />} />
          <Tile label="Trips done" icon={Navigation} value={team.trips.toLocaleString('en-US')}
            sub={`${tripRate(team.trips, team.online)} · ${rwfShort(team.fare)} RWF`} />
          <Tile label="Offers accepted" icon={Hand} value={team.offered ? pctText(team.answered / team.offered) : '—'}
            sub={team.offered ? `${team.answered} of ${team.offered} offers` : 'No offers in this period'}
            card={<CardLines title="Offers the app sent them" lines={[
              { label: 'Accepted', value: String(team.answered - team.dropped) }, { label: 'Accepted, then dropped', value: String(team.dropped) },
              { label: 'Refused', value: String(team.refused) }, { label: 'Ignored', value: String(team.ignored) },
            ]} total={{ label: 'Offers', value: String(team.offered) }} note="Offers another driver took first are not counted: the driver had no chance to answer." />} />
          <Tile label="Offers ignored" icon={XCircle} value={String(team.ignored)} alarm={team.ignored > 0}
            sub={team.refused || team.dropped ? `+ ${team.refused} refused · ${team.dropped} dropped` : 'None refused or dropped'} />
        </div>

        <div className="card p-0">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line-muted">
            <h2 className="text-small font-semibold mr-auto">Drivers <span className="text-fg-muted font-normal">· {rows.length}{team.notInApp ? ` · ${team.notInApp} not linked to the app` : ''}</span></h2>
            <label className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, plate or phone" className="input h-8 !pl-7 w-48 text-caption" />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input h-8 w-auto text-caption" aria-label="Sort">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className={`hidden lg:grid ${GRID} gap-4 px-4 py-2 text-micro font-medium uppercase tracking-wide text-fg-subtle border-b border-line-muted bg-surface-2`}>
            <span>Driver</span><span>{one ? 'Online in their hours' : 'Online a day'}</span><span>Hours online</span><span>Trips</span><span>Offers</span><span>{one ? '24 hours' : 'Each day'}</span><span />
          </div>
          {rows.length ? (
            <ul className="divide-y divide-line-muted">
              {rows.map((s) => <DriverRow key={s.d.id} s={s} one={one} open={open === s.d.id} onToggle={() => setOpen(open === s.d.id ? null : s.d.id)} now={data.now} days={data.days} />)}
            </ul>
          ) : <p className="px-4 py-10 text-center text-small text-fg-muted">{q ? 'No driver matches.' : 'No driver is on a car we manage.'}</p>}
        </div>

        <div className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-caption text-fg-muted">
          <p><b className="text-fg font-medium">Online a day</b>: hours switched online in the driver app per working day — the whole day for a Solo car or day &amp; night, their shift otherwise. Rest days, days off and days before their start are left out.</p>
          <p><b className="text-fg font-medium">Offers</b>: each time the app offered them a trip. <b className="text-fg font-medium">Ignored</b> = no answer before it ran out; <b className="text-fg font-medium">dropped</b> = accepted, then cancelled.</p>
          <p><b className="text-fg font-medium">Trips</b>: completed trips, counted on the day they ended. Fares are what the app charged the rider.</p>
          <p>Offers another driver accepted first are left out. {data.offersSince ? `Offers go back to ${dayLong(data.offersSince.slice(0, 10))}.` : ''}</p>
        </div>
      </>)}
    </div>
  );
}

function Tile({ label, value, sub, icon: Icon, card, alarm }: { label: string; value: ReactNode; sub: ReactNode; icon: typeof Wifi; card?: ReactNode; alarm?: boolean }) {
  const v = <span className="text-h2 font-semibold leading-none tabular-nums text-fg">{value}</span>;
  return (
    <div className="card p-3.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-medium text-fg-muted truncate flex items-center gap-1.5">{alarm && <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" aria-hidden />}{label}</span>
        <Icon size={14} className="text-fg-subtle shrink-0" />
      </div>
      <div className="mt-2">{card ? <HoverCard card={card} width="w-72">{v}</HoverCard> : v}</div>
      <p className="text-caption text-fg-muted mt-1.5 truncate">{sub}</p>
    </div>
  );
}

function DriverRow({ s, one, open, onToggle, now, days }: { s: DriverStats; one: boolean; open: boolean; onToggle: () => void; now: number; days: string[] }) {
  const t = s.total;
  const share = t.shiftShare;
  return (
    <li>
      <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        aria-expanded={open}
        className={`grid grid-cols-2 ${GRID} gap-x-4 gap-y-3 px-4 py-3 items-center cursor-pointer transition-colors ${open ? 'bg-surface-2' : 'hover:bg-hover/40'}`}>
        <div className="col-span-2 lg:col-span-1 flex items-center gap-3 min-w-0">
          <DriverAvatar name={s.d.name} size={34} />
          <div className="min-w-0">
            <span onClick={(e) => e.stopPropagation()}><EntityLink type="driver" id={s.d.id} label={s.d.name} className="!text-fg leading-snug break-words" /></span>
            <p className="text-caption text-fg-muted truncate">{s.d.plate ?? 'No car'} · {seatOf(s.d)}</p>
          </div>
        </div>

        {!s.inApp ? (
          <p className="col-span-2 lg:col-span-5 text-caption text-fg-muted flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-attention" aria-hidden /> Not linked to an account in the Kivu Ride app — link them on Ours On Shift to see their numbers.</p>
        ) : (<>
          <Cell label="Online a day">
            {t.shiftMin ? (<>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-small font-semibold tabular-nums">{one ? hm(t.inShiftMin) : t.perDayMin !== null ? hm(t.perDayMin) : '—'}</span>
                <span className="text-caption text-fg-muted tabular-nums" title={`${hm(t.inShiftMin)} online of ${hm(t.shiftMin)}`}>{pctText(share)} of {s.d.shift === 'full' ? (one ? 'the day so far' : '24h') : 'shift'}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-inset overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((share ?? 0) * 100)}%` }} /></div>
            </>) : <span className="text-caption text-fg-subtle">{s.d.roster.start_date && s.d.roster.start_date > s.days[s.days.length - 1].day ? `Starts ${dayShort(s.d.roster.start_date)}` : 'Rest day or day off'}</span>}
          </Cell>
          <Cell label="Hours online">
            <span className="text-small font-semibold tabular-nums">{hm(t.onlineMin)}</span>
            <p className="text-caption text-fg-muted tabular-nums">{one ? 'that day' : t.workDays ? `in ${t.workDays} day${t.workDays === 1 ? '' : 's'}` : 'no working day'}</p>
          </Cell>
          <Cell label="Trips">
            <span className="text-small font-semibold tabular-nums">{t.trips}</span>
            <p className="text-caption text-fg-muted tabular-nums truncate" title={tripRate(t.trips, t.onlineMin)}>{t.trips ? `${rwfShort(t.fare)} RWF` : 'no trips'}</p>
          </Cell>
          <Cell label="Offers"><OffersCell s={s} /></Cell>
          <Cell label={one ? '24 hours' : 'Each day'}>
            {one ? <MiniTimeline s={s} day={days[0]} /> : <DaySpark s={s} />}
          </Cell>
        </>)}
        <ChevronDown size={16} className={`hidden lg:block text-fg-subtle transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </div>
      {open && s.inApp && <Detail s={s} one={one} days={days} now={now} />}
    </li>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><span className="lg:hidden block text-micro uppercase tracking-wide text-fg-subtle mb-0.5">{label}</span>{children}</div>;
}

// A thin stacked bar of what they did with their offers, with a 2px gap between parts.
function OfferBar({ s, h = 6 }: { s: DriverStats; h?: number }) {
  const t = s.total;
  const parts = OUT_ORDER.map((k) => ({ k, n: k === 'accepted' ? t.accepted : t[k] })).filter((p) => p.n > 0);
  if (!t.offered) return <div className="rounded-full bg-inset" style={{ height: h }} />;
  return (
    <div className="flex gap-[2px]" style={{ height: h }}>
      {parts.map((p, i) => <span key={p.k} className={`${OUT_FILL[p.k]} ${i === 0 ? 'rounded-l-full' : ''} ${i === parts.length - 1 ? 'rounded-r-full' : ''}`} style={{ flexGrow: p.n, minWidth: 3 }} title={`${OUTCOME[p.k].label}: ${p.n}`} />)}
    </div>
  );
}

function OffersCell({ s }: { s: DriverStats }) {
  const t = s.total;
  if (!t.offered) return <span className="text-caption text-fg-subtle">No offers{t.lost ? ` · ${t.lost} taken by others` : ''}</span>;
  return (
    <HoverCard width="w-64" align="right" card={<CardLines title="Offers" lines={[
      { label: 'Accepted', value: String(t.accepted) }, { label: 'Accepted, then dropped', value: String(t.dropped) },
      { label: 'Refused', value: String(t.refused) }, { label: 'Ignored', value: String(t.ignored) },
    ]} total={{ label: 'Accepted', value: pctText(t.acceptRate) }} note={t.lost ? `${t.lost} more were taken by another driver first (not counted).` : undefined} />}>
      <span className="block w-full">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-small font-semibold tabular-nums">{pctText(t.acceptRate)}</span>
          <span className="text-caption text-fg-muted tabular-nums">{t.answered}/{t.offered}{t.ignored ? <> · <span className="text-fg">{t.ignored} ignored</span></> : ''}</span>
        </span>
        <span className="block mt-1"><OfferBar s={s} /></span>
      </span>
    </HoverCard>
  );
}

// Daily online hours in shift, as small bars (multi-day).
function DaySpark({ s }: { s: DriverStats }) {
  const max = Math.max(60, ...s.days.map((d) => d.shiftMin));
  const w = 120, h = 26, gap = 2;
  const bw = Math.max(2, (w - gap * (s.days.length - 1)) / s.days.length);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block" role="img" aria-label="Online in shift, each day">
      {s.days.map((d, i) => {
        const x = i * (bw + gap);
        const th = d.shiftMin ? Math.max(2, (d.shiftMin / max) * h) : 2;
        const fh = d.shiftMin ? (d.inShiftMin / max) * h : 0;
        return (
          <g key={d.day}>
            <title>{`${dayShort(d.day)}: ${d.shiftMin ? `${hm(d.inShiftMin)} of ${hm(d.shiftMin)} online` : 'not a working day'}${d.trips ? ` · ${d.trips} trip${d.trips === 1 ? '' : 's'}` : ''}`}</title>
            <rect x={x} y={h - th} width={bw} height={th} rx={1.5} fill="rgb(var(--c-line))" />
            {fh > 0 && <rect x={x} y={h - fh} width={bw} height={fh} rx={1.5} fill="rgb(var(--c-accent))" />}
          </g>
        );
      })}
    </svg>
  );
}

// One day at a glance: shift hours shaded, online stretches filled.
function MiniTimeline({ s, day }: { s: DriverStats; day: string }) {
  const start = Date.parse(`${day}T00:00:00+02:00`);
  const pos = (ms: number) => `${((ms - start) / 86400_000) * 100}%`;
  const len = (a: number, b: number) => `${((b - a) / 86400_000) * 100}%`;
  return (
    <div className="relative h-4 w-[120px] rounded bg-inset overflow-hidden" title="Shift hours shaded, online in blue">
      {s.windows.map(([a, b], i) => <span key={`w${i}`} className="absolute inset-y-0 bg-line" style={{ left: pos(a), width: len(a, b) }} />)}
      {s.segments.map(([a, b], i) => <span key={`s${i}`} className="absolute inset-y-1 bg-accent rounded-sm" style={{ left: pos(a), width: len(a, b), minWidth: 1 }} />)}
    </div>
  );
}

// ------------------------------------------------------------------ detail
function Detail({ s, one, days, now }: { s: DriverStats; one: boolean; days: string[]; now: number }) {
  return (
    <div className="px-4 pb-5 pt-1 bg-surface-2 border-t border-line-muted">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] pt-3">
        <section className="card p-4 min-w-0">
          <h3 className="text-caption font-semibold text-fg-muted uppercase tracking-wide mb-3">{one ? `${dayLong(days[0])} · hour by hour` : 'Online, day by day'}</h3>
          {one ? <DayTimeline s={s} day={days[0]} now={now} /> : <DayBars s={s} />}
        </section>
        <section className="card p-4 min-w-0">
          <h3 className="text-caption font-semibold text-fg-muted uppercase tracking-wide mb-3">Offers</h3>
          <OfferSummary s={s} />
          <OfferList s={s} />
        </section>
      </div>
      <section className="card p-4 mt-4 min-w-0">
        <h3 className="text-caption font-semibold text-fg-muted uppercase tracking-wide mb-2">Trips done <span className="normal-case tracking-normal font-normal">· {s.total.trips}{s.total.km ? ` · ${Math.round(s.total.km)} km` : ''}{s.total.tripMin ? ` · ${hm(s.total.tripMin)} driving riders` : ''}</span></h3>
        {s.trips.length ? (
          <ul className="divide-y divide-line-muted text-small">
            {s.trips.slice(0, 12).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className="text-caption text-fg-muted tabular-nums w-28 shrink-0">{dayShort(kDay(t.completed_at ?? t.created_at))} {clock(Date.parse(t.completed_at ?? t.created_at))}</span>
                <span className="flex-1 min-w-[200px] truncate">{t.pickup_address ?? '—'} <span className="text-fg-subtle">→</span> {t.destination_address ?? '—'}</span>
                <span className="tabular-nums text-fg-muted">{t.actual_distance_km ? `${Number(t.actual_distance_km).toFixed(1)} km · ` : ''}<span className="text-fg font-medium">{Math.round(Number(t.total_fare ?? 0)).toLocaleString('en-US')} RWF</span></span>
              </li>
            ))}
          </ul>
        ) : <p className="text-caption text-fg-muted">No completed trip in this period.</p>}
        {s.trips.length > 12 && <p className="text-caption text-fg-subtle mt-1.5">+ {s.trips.length - 12} earlier trips</p>}
      </section>
    </div>
  );
}
// How often a trip comes, against time online ("1 per 3h 20 online").
const tripRate = (trips: number, onlineMin: number) => (!trips ? 'no trips' : onlineMin < 30 ? `${trips} trip${trips === 1 ? '' : 's'}` : `1 per ${hm(onlineMin / trips)} online`);
const kDay = (iso: string) => kFormat(Date.parse(iso), 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });

// Day by day: shift hours as the track, online in shift as the bar, trips under it.
function DayBars({ s }: { s: DriverStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(60, ...s.days.map((d) => Math.max(d.shiftMin, d.onlineMin)));
  const many = s.days.length > 10;
  const h = 140;
  const d = hover === null ? null : s.days[hover];
  return (
    <div className="relative">
      <div className="flex items-center gap-4 text-caption text-fg-muted mb-2">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent" /> Online</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-line" /> {s.d.shift === 'full' ? 'The whole day' : 'Shift hours'}</span>
        <span className="ml-auto">trips under each day</span>
      </div>
      <div className="relative flex items-end gap-[3px]" style={{ height: h }} onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((f) => <span key={f} className="absolute inset-x-0 border-t border-dashed border-line-muted" style={{ bottom: f * h }} aria-hidden />)}
        {s.days.map((x, i) => (
          <div key={x.day} className="relative flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)}>
            <div className={`w-full rounded-t-[4px] ${x.shiftMin ? 'bg-line' : 'bg-transparent border-t-2 border-dashed border-line'}`} style={{ height: x.shiftMin ? `${(x.shiftMin / max) * 100}%` : 2 }}>
              <div className="w-full h-full flex items-end">
                {x.inShiftMin > 0 && <div className={`w-full rounded-t-[4px] bg-accent ${hover === i ? 'opacity-100' : 'opacity-90'}`} style={{ height: `${(x.inShiftMin / x.shiftMin) * 100}%` }} />}
              </div>
            </div>
            {hover === i && <span className="absolute inset-0 rounded-t bg-fg/5 pointer-events-none" />}
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {s.days.map((x, i) => (
          <div key={x.day} className="flex-1 text-center min-w-0">
            <span className="block text-caption font-medium tabular-nums">{x.trips || <span className="text-fg-subtle">·</span>}</span>
            {(!many || i % 3 === 0 || i === s.days.length - 1) && <span className="block text-micro text-fg-subtle truncate">{many ? dayShort(x.day).split(' ')[1] : dayShort(x.day)}</span>}
          </div>
        ))}
      </div>
      {d && (
        <div className="absolute top-6 z-20 w-60 rounded-lg border border-line bg-surface shadow-lg p-3 text-caption pointer-events-none"
          style={{ left: `clamp(0px, calc(${((hover! + 0.5) / s.days.length) * 100}% - 120px), calc(100% - 240px))` }}>
          <CardLines title={dayLong(d.day)} lines={[
            { label: 'Online in their hours', value: d.shiftMin ? `${hm(d.inShiftMin)} of ${hm(d.shiftMin)}` : 'Not a working day' },
            { label: 'Online all day', value: hm(d.onlineMin) },
            { label: 'Trips', value: `${d.trips}${d.fare ? ` · ${Math.round(d.fare).toLocaleString('en-US')} RWF` : ''}` },
            { label: 'Offers accepted', value: `${d.accepted + d.dropped} of ${d.accepted + d.dropped + d.refused + d.ignored}` },
            ...(d.ignored ? [{ label: 'Ignored', value: String(d.ignored) }] : []),
            ...(d.refused ? [{ label: 'Refused', value: String(d.refused) }] : []),
          ]} />
        </div>
      )}
    </div>
  );
}

// One day, 00:00-24:00: shift hours shaded, online in blue, trips and offers as marks.
function DayTimeline({ s, day, now }: { s: DriverStats; day: string; now: number }) {
  const start = Date.parse(`${day}T00:00:00+02:00`);
  const x = (ms: number) => `${Math.max(0, Math.min(100, ((ms - start) / 86400_000) * 100))}%`;
  const w = (a: number, b: number) => `${((b - a) / 86400_000) * 100}%`;
  const nowIn = now > start && now < start + 86400_000;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-muted mb-3">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent" /> Online</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-line" /> Shift hours</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-fg" /> Trip done</span>
        {OUT_ORDER.map((k) => <span key={k} className="flex items-center gap-1.5"><span className={`w-[3px] h-2.5 rounded-sm ${OUT_FILL[k]}`} /> {OUTCOME[k].label}</span>)}
      </div>
      <div className="relative">
        <div className="relative h-9 rounded-md bg-inset overflow-hidden">
          {s.windows.map(([a, b], i) => <span key={i} className="absolute inset-y-0 bg-line" style={{ left: x(a), width: w(a, b) }} />)}
          {s.segments.map(([a, b], i) => <span key={i} className="absolute top-2 bottom-2 bg-accent rounded-[3px]" style={{ left: x(a), width: w(a, b), minWidth: 2 }} title={`Online ${clock(a)}–${clock(b)} (${hm((b - a) / 60000)})`} />)}
          {nowIn && <span className="absolute inset-y-0 border-l-2 border-fg/60" style={{ left: x(now) }} title={`Now ${clock(now)}`} />}
        </div>
        <div className="relative h-4 mt-1">
          {s.trips.map((t) => { const at = Date.parse(t.completed_at ?? t.created_at); return <span key={t.id} className="absolute top-1 w-2 h-2 -ml-1 rounded-full bg-fg" style={{ left: x(at) }} title={`Trip ended ${clock(at)} · ${Math.round(Number(t.total_fare ?? 0)).toLocaleString('en-US')} RWF`} />; })}
        </div>
        <div className="relative h-4">
          {s.offers.filter((o) => o.outcome !== 'lost' && o.outcome !== 'other').map((o) => { const at = Date.parse(o.offered_at); return <span key={`${o.trip_id}-${o.offered_at}`} className={`absolute top-0.5 w-[3px] h-3 -ml-px rounded-sm ${OUT_FILL[o.outcome as keyof typeof OUT_FILL]}`} style={{ left: x(at) }} title={`${clock(at)} · ${OUTCOME[o.outcome].label}${o.rejection_reason ? ` — ${o.rejection_reason}` : ''}`} />; })}
        </div>
        <div className="relative h-4 mt-1 text-micro text-fg-subtle tabular-nums">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hr) => <span key={hr} className={`absolute ${hr === 0 ? '' : hr === 24 ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: `${(hr / 24) * 100}%` }}>{String(hr % 24).padStart(2, '0')}:00</span>)}
        </div>
      </div>
      <p className="mt-3 text-caption text-fg-muted">
        {s.total.shiftMin ? <>Online <b className="text-fg">{hm(s.total.inShiftMin)}</b> of {hm(s.total.shiftMin)} {s.d.shift === 'full' ? 'so far' : 'shift hours so far'} ({pctText(s.total.shiftShare)}).</> : <>Not a working day for them · {hm(s.total.onlineMin)} online.</>}
      </p>
    </div>
  );
}

function OfferSummary({ s }: { s: DriverStats }) {
  const t = s.total;
  return (
    <div className="mb-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-h2 font-semibold tabular-nums leading-none">{pctText(t.acceptRate)}</span>
        <span className="text-caption text-fg-muted">accepted · {t.answered} of {t.offered} offers{t.lost ? ` · ${t.lost} taken by others first` : ''}</span>
      </div>
      <OfferBar s={s} h={8} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5">
        {OUT_ORDER.map((k) => (
          <div key={k} className="min-w-0">
            <span className="flex items-center gap-1.5 text-caption text-fg-muted"><span className={`w-2 h-2 rounded-sm ${OUT_FILL[k]}`} />{OUTCOME[k].label}</span>
            <span className="text-small font-semibold tabular-nums">{k === 'accepted' ? t.accepted : t[k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OfferList({ s }: { s: DriverStats }) {
  const list = s.offers.filter((o) => o.outcome !== 'other');
  if (!list.length) return <p className="text-caption text-fg-muted border-t border-line-muted pt-3">No offers in this period.</p>;
  return (
    <ul className="border-t border-line-muted divide-y divide-line-muted max-h-64 overflow-y-auto -mx-1 px-1">
      {list.slice(0, 40).map((o) => {
        const at = Date.parse(o.offered_at);
        const secs = o.responded_at ? Math.round((Date.parse(o.responded_at) - at) / 1000) : null;
        return (
          <li key={`${o.trip_id}-${o.offered_at}`} className="flex items-center gap-3 py-1.5 text-caption">
            <span className="text-fg-muted tabular-nums w-24 shrink-0">{dayShort(kDay(o.offered_at))} {clock(at)}</span>
            <span className="flex items-center gap-1.5 w-28 shrink-0">
              <span className={`w-2 h-2 rounded-sm ${o.outcome === 'lost' ? 'bg-line-strong' : OUT_FILL[o.outcome as keyof typeof OUT_FILL]}`} />
              <span className={o.outcome === 'lost' ? 'text-fg-muted' : 'text-fg font-medium'}>{OUTCOME[o.outcome].label}</span>
            </span>
            <span className="flex-1 min-w-0 truncate text-fg-muted" title={o.rejection_reason ?? undefined}>
              {o.rejection_reason && o.rejection_reason !== 'Driver declined' ? `“${o.rejection_reason}”` : ''}
              {o.outcome === 'accepted' && secs !== null ? `in ${secs < 60 ? `${secs}s` : `${Math.round(secs / 60)} min`}` : ''}
            </span>
            <span className="text-fg-subtle tabular-nums shrink-0">{o.distance_km ? `${Number(o.distance_km).toFixed(1)} km` : ''} · #{o.trip_id}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[92px] skeleton rounded-card" />)}</div>
      <div className="h-80 skeleton rounded-card" />
    </div>
  );
}
