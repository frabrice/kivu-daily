import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Landmark, UserRound, Wallet, Hourglass, FileSignature } from 'lucide-react';
import { EntityViewProps } from '../../os/peek';
import { EntityLink, useEntityMeta } from '../../os/EntityLink';
import { useAuth } from '../../lib/auth';
import { useFinanceData } from '../../lib/finance';
import { Box, Details, EmptyState, Label, PageHeader, StatCard, StatGrid, rwf } from '../../ui/kit';
import VehicleOwnerProfilePage from '../finance/VehicleOwnerProfilePage';
import VehicleOwnerDrawer from '../../components/finance/VehicleOwnerDrawer';
import { AddLegalDocModal, LegalDocsBox } from '../../components/legal/LegalDocFields';
import { missingForOwner, useLegalDocs } from '../../lib/legalDocs';

// A vehicle owner: their cars, what we paid them and what's waiting.
export default function OwnerEntity({ id, mode }: EntityViewProps) {
  const { profile } = useAuth();
  const nav = useNavigate();
  const { vehicles, owners, transactions, loading, reload } = useFinanceData();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const legal = useLegalDocs();
  const owner = owners.find((o) => o.id === id) ?? null;
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  useEntityMeta('owner', id, mode, owner?.full_name);

  if (loading) return <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-card" />)}</div>;
  if (!owner) return <EmptyState icon={UserRound} title="Owner not found" />;

  const cars = vehicles.filter((v) => v.owner_id === id);
  const missing = !legal.loading && missingForOwner(id, vehicles, legal.docs);
  const agreementBox = (
    <Box title="Management agreement" icon={FileSignature}>
      <LegalDocsBox docs={legal.docs.filter((x) => x.owner_id === id)} missing={missing ? 'owner_management_agreement' : null} canAdd={canEdit}
        addKinds={['owner_management_agreement']} onAdd={() => setAdding(true)} />
    </Box>
  );
  const addModal = adding && <AddLegalDocModal kind="owner_management_agreement" ownerId={id} name={owner.full_name} onClose={() => setAdding(false)} onSaved={legal.reload} />;
  const carIds = new Set(cars.map((c) => c.id));
  const tx = transactions.filter((t) => t.linked_vehicle_id && carIds.has(t.linked_vehicle_id) && t.type === 'vehicle_owner_payment');
  const paid = tx.filter((t) => t.status === 'posted').reduce((s, t) => s + t.amount, 0);
  const waiting = tx.filter((t) => t.status === 'pending' || t.status === 'checked');
  const weekly = cars.reduce((s, c) => s + Number(c.weekly_owner_payout_amount ?? 0), 0);

  const carsBox = (
    <Box title="Cars" icon={Car} padded={false}>
      <ul className="divide-y divide-line-muted">
        {cars.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
            <Car size={15} className="text-fg-subtle" />
            <EntityLink type="car" id={c.id} label={c.plate_number} className="font-mono" />
            <span className="text-caption text-fg-muted">{[c.make, c.model].filter(Boolean).join(' ')}</span>
            {c.weekly_owner_payout_amount ? <span className="ml-auto text-caption tabular-nums">{rwf(c.weekly_owner_payout_amount)}/week</span> : null}
          </li>
        ))}
        {cars.length === 0 && <li className="px-4 py-6 text-body text-fg-muted">No cars linked to this owner.</li>}
      </ul>
    </Box>
  );
  const stats = (
    <StatGrid cols={mode === 'peek' ? 2 : 4}>
      <StatCard label="Cars" icon={Car} value={cars.length} />
      <StatCard label="Owed each week" icon={Wallet} value={rwf(weekly)} />
      <StatCard label="Paid so far" icon={Landmark} value={rwf(paid)} tone="success" sub={`${tx.filter((t) => t.status === 'posted').length} payments`} />
      <StatCard label="Waiting to be paid" icon={Hourglass} value={rwf(waiting.reduce((s, t) => s + t.amount, 0))} tone={waiting.length ? 'attention' : undefined} sub={`${waiting.length} payments`} />
    </StatGrid>
  );

  if (mode === 'peek') {
    return (
      <div className="p-4 space-y-4">
        <PageHeader icon={UserRound} title={owner.full_name} labels={<>{waiting.length ? <Label tone="attention">{waiting.length} waiting</Label> : <Label tone="success">All paid</Label>}{missing && <Label tone="danger" icon={FileSignature}>Agreement missing</Label>}</>} subtitle={owner.phone} />
        {stats}
        {carsBox}
        {agreementBox}
        {addModal}
        <Box title="Details"><Details items={[{ label: 'Bank', value: owner.bank_name ? `${owner.bank_name}${owner.account_number ? ` · ${owner.account_number}` : ''}` : null }, { label: 'Email', value: owner.email }, { label: 'Notes', value: owner.notes }]} /></Box>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {missing && <p className="flex items-center gap-2"><Label tone="danger" icon={FileSignature}>Agreement missing</Label><span className="text-small text-fg-muted">The signed and stamped management agreement isn't on file.</span></p>}
      {stats}
      {carsBox}
      {agreementBox}
      {addModal}
      <VehicleOwnerProfilePage owner={owner} vehicles={vehicles} transactions={transactions} canEdit={canEdit} onBack={() => nav('/finance/owners')} onEditOwner={() => setEditing(true)} reload={reload} />
      {editing && <VehicleOwnerDrawer owner={owner} startEditing canEdit={canEdit} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  );
}
