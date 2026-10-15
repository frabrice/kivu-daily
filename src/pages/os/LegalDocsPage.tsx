import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileSignature, Plus, Search } from 'lucide-react';
import { supabase, Driver, Vehicle } from '../../lib/supabase';
import {
  DELIVERED_HOW, LEGAL_KIND, LegalDoc, LegalKind, missingForDriver, missingForOwner, openLegalDoc, useLegalDocs,
} from '../../lib/legalDocs';
import { useAccess } from '../../os/access';
import { EntityLink } from '../../os/EntityLink';
import { usePageTitle } from '../../os/workspace';
import { AddLegalDocModal } from '../../components/legal/LegalDocFields';
import { Label, PageHeader, UnderlineTabs } from '../../ui/kit';
import { Pager, usePaged } from '../../ui/Pager';

// Contract papers in one place: what's missing first, then every driver
// contract, amendment, termination letter and owner agreement with its
// dates. Fleet sees the drivers' side, Finance the owners', the MD both.

type Scope = 'drivers' | 'owners' | 'all';
type Tab = 'missing' | LegalKind;
interface Missing { key: string; kind: LegalKind; driverId?: string; ownerId?: string; name: string; context: string }
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2 whitespace-nowrap';

export function LegalDocsBoard({ scope }: { scope: Scope }) {
  const a = useAccess();
  const { docs, loading } = useLegalDocs();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [owners, setOwners] = useState<{ id: string; full_name: string }[]>([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('missing');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<Missing | null>(null);
  const [error, setError] = useState('');
  const withDrivers = scope !== 'owners', withOwners = scope !== 'drivers';

  useEffect(() => {
    (async () => {
      const [d, v, o] = await Promise.all([
        withDrivers ? supabase.from('drivers').select('*, vehicle:vehicles(*)') : Promise.resolve({ data: [] }),
        supabase.from('vehicles').select('*'),
        withOwners ? supabase.from('vehicle_owners').select('id, full_name') : Promise.resolve({ data: [] }),
      ]);
      setDrivers((d.data as Driver[]) ?? []);
      setVehicles((v.data as Vehicle[]) ?? []);
      setOwners((o.data as { id: string; full_name: string }[]) ?? []);
      setReady(true);
    })();
  }, [withDrivers, withOwners]);

  const canAddDriverDocs = a.isMd || a.in('fleet', 'it');
  const canAddOwnerDocs = a.isMd || a.in('finance');

  const missing = useMemo<Missing[]>(() => {
    const out: Missing[] = [];
    if (withDrivers) for (const d of drivers) {
      const kind = missingForDriver(d, docs);
      if (kind) out.push({
        key: `d${d.id}`, kind, driverId: d.id, name: d.full_name,
        context: kind === 'driver_termination_letter' ? `Contract from ${day(d.start_date)} ended` : `${d.vehicle?.plate_number ?? 'On a car'} · since ${day(d.start_date)}`,
      });
    }
    if (withOwners) for (const o of owners) {
      if (missingForOwner(o.id, vehicles, docs)) out.push({ key: `o${o.id}`, kind: 'owner_management_agreement', ownerId: o.id, name: o.full_name, context: vehicles.filter((v) => v.owner_id === o.id).map((v) => v.plate_number).join(', ') });
    }
    return out.sort((x, y) => x.kind.localeCompare(y.kind) || x.name.localeCompare(y.name));
  }, [drivers, owners, vehicles, docs, withDrivers, withOwners]);

  const kinds: LegalKind[] = scope === 'drivers' ? ['driver_contract', 'driver_contract_amendment', 'driver_termination_letter']
    : scope === 'owners' ? ['owner_management_agreement']
    : ['driver_contract', 'driver_contract_amendment', 'driver_termination_letter', 'owner_management_agreement'];
  const nameOf = (x: LegalDoc) => (x.driver_id ? drivers.find((d) => d.id === x.driver_id)?.full_name : owners.find((o) => o.id === x.owner_id)?.full_name) ?? '—';
  const needle = q.trim().toLowerCase();
  const missingRows = missing.filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.context.toLowerCase().includes(needle));
  const docRows = tab === 'missing' ? [] : docs.filter((x) => x.kind === tab && (!needle || nameOf(x).toLowerCase().includes(needle)));
  const pagedMissing = usePaged(missingRows, { key: 'legal-missing', reset: `${tab}${q}` });
  const pagedDocs = usePaged(docRows, { key: 'legal-docs', reset: `${tab}${q}` });

  if (loading || !ready) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-card" />)}</div>;

  return (
    <div>
      <UnderlineTabs<Tab> value={tab} onChange={setTab}
        tabs={[{ key: 'missing', label: 'Missing', count: missing.length, tone: 'danger' }, ...kinds.map((k) => ({ key: k as Tab, label: LEGAL_KIND[k].plural, count: docs.filter((x) => x.kind === k).length }))]}
        right={<label className="relative block"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8 !py-1.5 w-48" placeholder="Search names" aria-label="Search" /></label>} />
      {error && <p className="mb-2 text-caption text-danger">{error}</p>}

      {tab === 'missing' ? (
        missingRows.length ? (
          <>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-body min-w-[640px]">
                <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Name', 'Missing', 'Details', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {pagedMissing.rows.map((m) => {
                    const can = m.ownerId ? canAddOwnerDocs : canAddDriverDocs;
                    return (
                      <tr key={m.key} className="border-t border-line-muted">
                        <td className={td}>{m.driverId ? <EntityLink type="driver" id={m.driverId} label={m.name} /> : <EntityLink type="owner" id={m.ownerId!} label={m.name} />}</td>
                        <td className={td}><Label tone="danger" icon={FileSignature}>{LEGAL_KIND[m.kind].missing}</Label></td>
                        <td className={`${td} text-caption text-fg-muted`}>{m.context}</td>
                        <td className={`${td} text-right`}>{can && <button onClick={() => setAdding(m)} className="btn-primary text-caption"><Plus size={13} /> Add</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager pager={pagedMissing.pager} noun="missing" />
          </>
        ) : <div className="card p-10 text-center text-body text-fg-muted">{needle ? 'No match.' : 'Nothing missing — every contract paper is on file.'}</div>
      ) : docRows.length ? (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-body min-w-[760px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Name', 'Date on document', 'Contract from', tab === 'driver_termination_letter' ? 'Given' : 'Signed & stamped', 'Added', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {pagedDocs.rows.map((x) => (
                  <tr key={x.id} className="border-t border-line-muted">
                    <td className={td}>{x.driver_id ? <EntityLink type="driver" id={x.driver_id} label={nameOf(x)} /> : <EntityLink type="owner" id={x.owner_id!} label={nameOf(x)} />}</td>
                    <td className={`${td} tabular-nums`}>{day(x.document_date)}</td>
                    <td className={`${td} tabular-nums`}>{day(x.period_start)}</td>
                    <td className={td}>{x.kind === 'driver_termination_letter' ? <span className="text-caption">{DELIVERED_HOW.find((o) => o.key === x.delivered_how)?.label ?? '—'}</span> : x.signed && x.stamped ? <Label tone="success">Yes</Label> : <Label tone="danger">No</Label>}</td>
                    <td className={`${td} text-caption text-fg-muted tabular-nums`}>{day(x.uploaded_at.slice(0, 10))}</td>
                    <td className={`${td} text-right`}><button onClick={async () => setError((await openLegalDoc(x.file_path)) ?? '')} className="btn-ghost text-caption"><ExternalLink size={13} /> Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager pager={pagedDocs.pager} noun="documents" />
        </>
      ) : <div className="card p-10 text-center text-body text-fg-muted">{needle ? 'No match.' : `No ${LEGAL_KIND[tab].plural.toLowerCase()} yet.`}</div>}

      {adding && <AddLegalDocModal kind={adding.kind} driverId={adding.driverId} ownerId={adding.ownerId} name={adding.name} onClose={() => setAdding(null)} onSaved={() => setAdding(null)} />}
    </div>
  );
}

export function FleetContractsPage() {
  usePageTitle('Contracts');
  return (
    <div className="animate-fade-in">
      <PageHeader icon={FileSignature} title="Contracts" subtitle="Every driver on a car needs their signed and stamped contract; every ended contract its termination letter." />
      <LegalDocsBoard scope="drivers" />
    </div>
  );
}

export function FinanceAgreementsPage() {
  usePageTitle('Agreements');
  return (
    <div className="animate-fade-in">
      <PageHeader icon={FileSignature} title="Owner agreements" subtitle="Every owner whose car we manage needs their signed and stamped management agreement." />
      <LegalDocsBoard scope="owners" />
    </div>
  );
}
