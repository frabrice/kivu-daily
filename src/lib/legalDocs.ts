import { useCallback, useEffect, useState } from 'react';
import { supabase, Driver, Vehicle } from './supabase';

// Contract documents (MD, 15 Oct 2026): every driver on a car has their
// signed and stamped contract, every ended contract its termination
// letter, every shift change its amendment, every owner whose car we
// manage their management agreement. Files live in the private
// 'legal-docs' bucket; rows in contract_documents.

export type LegalKind = 'driver_contract' | 'driver_contract_amendment' | 'driver_termination_letter' | 'owner_management_agreement';
export interface LegalDoc {
  id: string; kind: LegalKind; driver_id: string | null; owner_id: string | null; contract_event_id: string | null;
  period_start: string | null; document_date: string; signed: boolean; stamped: boolean; delivered_how: string | null;
  file_path: string; file_name: string; notes: string | null; uploaded_by: string | null; uploaded_at: string;
}

export const LEGAL_KIND: Record<LegalKind, { label: string; plural: string; sealed: boolean; missing: string }> = {
  driver_contract: { label: 'Driver contract', plural: 'Driver contracts', sealed: true, missing: 'Contract missing' },
  driver_contract_amendment: { label: 'Contract amendment', plural: 'Contract amendments', sealed: true, missing: 'Amendment missing' },
  driver_termination_letter: { label: 'Termination letter', plural: 'Driver termination letters', sealed: false, missing: 'Termination letter missing' },
  owner_management_agreement: { label: 'Management agreement', plural: 'Owner management agreements', sealed: true, missing: 'Agreement missing' },
};

export const DELIVERED_HOW = [
  { key: 'in_person', label: 'Handed over in person' },
  { key: 'whatsapp', label: 'Sent on WhatsApp' },
  { key: 'email', label: 'Sent by email' },
  { key: 'refused', label: 'Driver refused to receive it' },
  { key: 'unreachable', label: "Driver can't be reached" },
] as const;

// ------------------------------------------------------------ the form's value
export interface LegalDraft { file: File | null; documentDate: string; signed: boolean; stamped: boolean; deliveredHow: string; notes: string }
export const emptyDraft = (date: string): LegalDraft => ({ file: null, documentDate: date, signed: false, stamped: false, deliveredHow: '', notes: '' });

export function draftError(kind: LegalKind, d: LegalDraft): string | null {
  const what = LEGAL_KIND[kind].label.toLowerCase();
  if (!d.file) return `Attach the ${what} (PDF or photo).`;
  if (d.file.size > 20 * 1024 * 1024) return 'The file is over 20 MB — attach a smaller scan or photo.';
  if (!d.documentDate) return `Enter the date on the ${what}.`;
  if (LEGAL_KIND[kind].sealed && !(d.signed && d.stamped)) return `The ${what} must be signed and stamped — tick both once it is.`;
  if (kind === 'driver_termination_letter' && !d.deliveredHow) return 'Say how the letter was given to the driver.';
  return null;
}

// Uploads the file; returns the document details the database functions take.
export async function uploadDraft(kind: LegalKind, ownerOrDriverId: string, d: LegalDraft): Promise<{ doc: Record<string, unknown> } | { error: string }> {
  const err = draftError(kind, d);
  if (err) return { error: err };
  const file = d.file!;
  const path = `${kind}/${ownerOrDriverId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
  const { error } = await supabase.storage.from('legal-docs').upload(path, file, { contentType: file.type || undefined });
  if (error) return { error: `Upload failed: ${error.message}` };
  return {
    doc: {
      file_path: path, file_name: file.name, document_date: d.documentDate, signed: d.signed, stamped: d.stamped,
      delivered_how: kind === 'driver_termination_letter' ? d.deliveredHow : null, notes: d.notes.trim() || null,
    },
  };
}

export async function openLegalDoc(path: string) {
  const { data, error } = await supabase.storage.from('legal-docs').createSignedUrl(path, 300);
  if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  return error?.message ?? null;
}

// ------------------------------------------------------------ loading
let seq = 0;
export function useLegalDocs() {
  const [docs, setDocs] = useState<LegalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const out: LegalDoc[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('contract_documents').select('*').order('document_date', { ascending: false }).range(from, from + 999);
      if (error || !data) break;
      out.push(...(data as LegalDoc[]));
      if (data.length < 1000) break;
    }
    setDocs(out);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`legal-docs-${++seq}`).on('postgres_changes', { event: '*', schema: 'public', table: 'contract_documents' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { docs, loading, reload: load };
}

// ------------------------------------------------------------ what's missing
// A driver on a car needs the contract for their current contract period;
// a driver whose contract ended needs the termination letter for it.
export function driverNeeds(d: Driver): LegalKind | null {
  if (d.contract_status === 'ended') return d.start_date ? 'driver_termination_letter' : null;
  if (d.vehicle_id && d.start_date) return 'driver_contract';
  return null;
}
export function driverDocsFor(d: Driver, docs: LegalDoc[]) {
  return docs.filter((x) => x.driver_id === d.id);
}
export function missingForDriver(d: Driver, docs: LegalDoc[]): LegalKind | null {
  const need = driverNeeds(d);
  if (!need) return null;
  const have = docs.some((x) => x.driver_id === d.id && x.kind === need && (!x.period_start || !d.start_date || x.period_start === d.start_date));
  return have ? null : need;
}
// An owner with a car under management needs their management agreement.
export function ownerNeedsAgreement(ownerId: string, vehicles: Pick<Vehicle, 'owner_id' | 'operation_start_date'>[]) {
  return vehicles.some((v) => v.owner_id === ownerId && !!v.operation_start_date);
}
export function missingForOwner(ownerId: string, vehicles: Pick<Vehicle, 'owner_id' | 'operation_start_date'>[], docs: LegalDoc[]) {
  return ownerNeedsAgreement(ownerId, vehicles) && !docs.some((x) => x.owner_id === ownerId && x.kind === 'owner_management_agreement');
}
