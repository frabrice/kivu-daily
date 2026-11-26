import { supabase, Driver, Vehicle, VehicleOwner } from './supabase';
import { LEGAL_KIND, LegalDoc, LegalKind, missingCarPapers, missingForDriver, missingForOwner } from './legalDocs';
import { kigaliToday } from './kigali';

// Admin -> Missing (MD, 23 Nov 2026): papers are optional when a car, an
// owner or a driver is created, so everything still missing on them is
// listed here in one place until it's added.

export type MissingSubject = 'car' | 'owner' | 'driver';

export interface MissingThing {
  label: string;
  // A paper that can be added straight from the Missing page.
  paper?: LegalKind;
}

export interface MissingRow {
  key: string;
  subject: MissingSubject;
  id: string;
  name: string;
  context: string;
  things: MissingThing[];
  // A driver whose contract has ended (only the termination letter is asked for).
  ended?: boolean;
}

export interface MissingData {
  vehicles: Vehicle[];
  owners: VehicleOwner[];
  drivers: Driver[];
  docs: LegalDoc[];
  reviewed: Set<string>;
}

export async function loadMissingData(): Promise<MissingData> {
  const [v, o, d, docs, rv] = await Promise.all([
    supabase.from('vehicles').select('*').order('plate_number'),
    supabase.from('vehicle_owners').select('*').order('full_name'),
    supabase.from('drivers').select('*, vehicle:vehicles(*)').order('full_name'),
    supabase.from('contract_documents').select('*'),
    supabase.from('driver_money_reviews').select('driver_id'),
  ]);
  return {
    vehicles: (v.data as Vehicle[]) ?? [],
    owners: (o.data as VehicleOwner[]) ?? [],
    drivers: (d.data as Driver[]) ?? [],
    docs: (docs.data as LegalDoc[]) ?? [],
    reviewed: new Set(((rv.data ?? []) as { driver_id: string }[]).map((r) => r.driver_id)),
  };
}

const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function computeMissing({ vehicles, owners, drivers, docs, reviewed }: MissingData, today: string = kigaliToday()): MissingRow[] {
  const rows: MissingRow[] = [];
  const ownerName = new Map(owners.map((o) => [o.id, o.full_name]));
  const driversOn = (vId: string) => drivers.filter((d) => d.vehicle_id === vId && d.contract_status === 'active').map((d) => d.full_name);

  for (const v of vehicles) {
    const things: MissingThing[] = [];
    // Papers (MD, 26 Nov 2026): inspection, yellow card, insurance, RURA licence - missing or expired.
    for (const m of missingCarPapers(v, docs, today)) {
      things.push({ label: m.expired ? `${LEGAL_KIND[m.kind].label} expired ${day(m.expired)}` : LEGAL_KIND[m.kind].label, paper: m.kind });
    }
    if (!v.owner_id) things.push({ label: 'Owner' });
    else {
      if (!v.operation_start_date) things.push({ label: 'Operation start date' });
      if (!v.weekly_owner_payout_amount) things.push({ label: 'Owner payout amount' });
    }
    if (things.length) {
      const on = driversOn(v.id);
      rows.push({
        key: `car-${v.id}`, subject: 'car', id: v.id, name: v.plate_number,
        context: [[v.make, v.model].filter(Boolean).join(' '), v.owner_id ? `Owner: ${ownerName.get(v.owner_id) ?? '—'}` : '', on.length ? `Driver: ${on.join(', ')}` : 'No driver'].filter(Boolean).join(' · '),
        things,
      });
    }
  }

  for (const o of owners) {
    const things: MissingThing[] = [];
    if (missingForOwner(o.id, vehicles, docs)) things.push({ label: 'Management agreement', paper: 'owner_management_agreement' });
    if (!o.phone?.trim()) things.push({ label: 'Phone' });
    if (!o.bank_name?.trim() || !o.account_number?.trim()) things.push({ label: 'Bank account' });
    if (!o.payment_day) things.push({ label: 'Payment day' });
    if (things.length) {
      const cars = vehicles.filter((v) => v.owner_id === o.id).map((v) => v.plate_number);
      rows.push({ key: `owner-${o.id}`, subject: 'owner', id: o.id, name: o.full_name, context: cars.length ? `Cars: ${cars.join(', ')}` : 'No car', things });
    }
  }

  for (const d of drivers) {
    const things: MissingThing[] = [];
    const paper = missingForDriver(d, docs);
    if (d.contract_status === 'active') {
      if (paper) things.push({ label: 'Signed contract', paper });
      if (!d.vehicle_id) things.push({ label: 'Car' });
      if (!d.phone?.trim()) things.push({ label: 'Phone' });
      if (!d.start_date) things.push({ label: 'Start date' });
      if (!d.payment_day) things.push({ label: 'Usual pay day' });
      if (!reviewed.has(d.id)) things.push({ label: 'Money not confirmed (Driver Adjust)' });
    } else if (paper) {
      things.push({ label: 'Termination letter', paper });
    }
    if (things.length) {
      rows.push({
        key: `driver-${d.id}`, subject: 'driver', id: d.id, name: d.full_name, ended: d.contract_status === 'ended',
        context: d.contract_status === 'ended' ? `Contract from ${day(d.start_date) || '—'} ended` : [d.vehicle?.plate_number ?? 'No car', d.start_date ? `since ${day(d.start_date)}` : ''].filter(Boolean).join(' · '),
        things,
      });
    }
  }
  return rows;
}
