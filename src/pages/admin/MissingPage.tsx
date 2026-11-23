import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Car, FileWarning, Plus, Search, Truck, UserX } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { computeMissing, loadMissingData, MissingData, MissingRow, MissingSubject, MissingThing } from '../../lib/missing';
import { EntityLink } from '../../os/EntityLink';
import { AddLegalDocModal } from '../../components/legal/LegalDocFields';
import { Label, PageHeader, StatCard, StatGrid, UnderlineTabs } from '../../ui/kit';

// Admin -> Missing (MD, 23 Nov 2026): papers and details still missing on
// every car, car owner and driver. Papers are optional when something is
// created, so nothing is blocked; it is listed here until it's added.
// Papers can be added straight from here; details open the car, owner or
// driver to fill in.

type Tab = 'cars' | 'owners' | 'drivers' | 'ended';
const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2 align-top';

const TAB_OF = (r: MissingRow): Tab => (r.subject === 'car' ? 'cars' : r.subject === 'owner' ? 'owners' : r.ended ? 'ended' : 'drivers');

export default function MissingPage() {
  const [data, setData] = useState<MissingData | null>(null);
  const [tab, setTab] = useState<Tab>('cars');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<{ row: MissingRow; thing: MissingThing } | null>(null);

  const load = useCallback(async () => setData(await loadMissingData()), []);
  useEffect(() => {
    load();
    // Anything added anywhere (a paper, a car's owner, a driver's car) updates the list.
    const ch = supabase.channel('admin-missing')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contract_documents' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_owners' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const rows = useMemo(() => (data ? computeMissing(data) : []), [data]);
  const by = (t: Tab) => rows.filter((r) => TAB_OF(r) === t);
  const counts: Record<Tab, number> = { cars: by('cars').length, owners: by('owners').length, drivers: by('drivers').length, ended: by('ended').length };
  const papers = rows.reduce((n, r) => n + r.things.filter((t) => t.paper).length, 0);
  const needle = q.trim().toLowerCase();
  const shown = by(tab).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.context.toLowerCase().includes(needle) || r.things.some((t) => t.label.toLowerCase().includes(needle)));

  const link = (r: MissingRow) => {
    const type: Record<MissingSubject, 'car' | 'owner' | 'driver'> = { car: 'car', owner: 'owner', driver: 'driver' };
    return <EntityLink type={type[r.subject]} id={r.id} label={r.name} className={r.subject === 'car' ? 'font-mono' : ''} />;
  };

  return (
    <div className="animate-fade-in">
      <PageHeader icon={FileWarning} title="Missing"
        subtitle="Everything still missing on a car, a car owner or a driver. Nothing stops them being created; it stays on this list until it's added." />

      {!data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-card" />)}</div>
      ) : (
        <>
          <StatGrid cols={4}>
            <StatCard label="Cars" icon={Car} value={counts.cars} sub="with something missing" tone={counts.cars ? 'attention' : 'success'} onClick={() => setTab('cars')} />
            <StatCard label="Car owners" icon={Building2} value={counts.owners} sub="with something missing" tone={counts.owners ? 'attention' : 'success'} onClick={() => setTab('owners')} />
            <StatCard label="Drivers" icon={Truck} value={counts.drivers} sub="on contract, something missing" tone={counts.drivers ? 'attention' : 'success'} onClick={() => setTab('drivers')} />
            <StatCard label="Papers missing" icon={FileWarning} value={papers} sub="inspections, agreements, contracts, letters" tone={papers ? 'danger' : 'success'} />
          </StatGrid>

          <UnderlineTabs<Tab> value={tab} onChange={setTab}
            tabs={[
              { key: 'cars', label: 'Cars', icon: Car, count: counts.cars, tone: 'danger' },
              { key: 'owners', label: 'Car owners', icon: Building2, count: counts.owners, tone: 'danger' },
              { key: 'drivers', label: 'Drivers', icon: Truck, count: counts.drivers, tone: 'danger' },
              { key: 'ended', label: 'Ended contracts', icon: UserX, count: counts.ended },
            ]}
            right={<label className="relative block"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8 !py-1.5 w-48" placeholder="Search" aria-label="Search" /></label>} />

          {shown.length ? (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-body min-w-[720px]">
                <thead><tr className="text-caption text-fg-muted text-left bg-inset">
                  {[tab === 'cars' ? 'Car' : tab === 'owners' ? 'Owner' : 'Driver', 'Missing', 'Details', ''].map((h) => <th key={h} className={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} className="border-t border-line-muted">
                      <td className={`${td} whitespace-nowrap`}>{link(r)}</td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          {r.things.map((t) => <Label key={t.label} tone={t.paper ? 'danger' : 'attention'} icon={t.paper ? FileWarning : undefined}>{t.label}</Label>)}
                        </div>
                      </td>
                      <td className={`${td} text-caption text-fg-muted`}>{r.context}</td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        <div className="flex justify-end gap-1.5">
                          {r.things.filter((t) => t.paper).map((t) => (
                            <button key={t.label} onClick={() => setAdding({ row: r, thing: t })} className="btn-primary text-caption"><Plus size={13} /> {t.label}</button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card p-10 text-center text-body text-fg-muted">{needle ? 'No match.' : 'Nothing missing here.'}</div>
          )}
          <p className="text-caption text-fg-subtle mt-2">Red: a paper to upload (add it here). Amber: a detail to fill in — open the {tab === 'owners' ? 'owner' : tab === 'cars' ? 'car' : 'driver'} and edit it.</p>
        </>
      )}

      {adding && (
        <AddLegalDocModal kind={adding.thing.paper!} name={adding.row.name}
          driverId={adding.row.subject === 'driver' ? adding.row.id : undefined}
          ownerId={adding.row.subject === 'owner' ? adding.row.id : undefined}
          vehicleId={adding.row.subject === 'car' ? adding.row.id : undefined}
          onClose={() => setAdding(null)} onSaved={() => { setAdding(null); load(); }} />
      )}
    </div>
  );
}
