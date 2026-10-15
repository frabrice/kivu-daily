import { useState } from 'react';
import { BadgeCheck, ExternalLink, FileSignature, FileText, Paperclip, Plus, Stamp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DELIVERED_HOW, LEGAL_KIND, LegalDoc, LegalDraft, LegalKind, emptyDraft, openLegalDoc, uploadDraft } from '../../lib/legalDocs';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';
import { Label } from '../../ui/kit';

const label = 'block text-caption font-medium mb-1.5 text-fg-muted';
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// The document part of a contract form: the file, its date, and - for
// contracts, amendments and agreements - signed AND stamped; for a
// termination letter, how it was given.
export function LegalDocFields({ kind, draft, onChange, title }: { kind: LegalKind; draft: LegalDraft; onChange: (d: LegalDraft) => void; title?: string }) {
  const meta = LEGAL_KIND[kind];
  const set = (patch: Partial<LegalDraft>) => onChange({ ...draft, ...patch });
  return (
    <fieldset className="rounded-lg border border-line p-3 space-y-3 bg-inset/40">
      <legend className="px-1 text-caption font-semibold text-fg flex items-center gap-1.5"><FileSignature size={13} /> {title ?? `${meta.label} *`}</legend>
      <label className={`flex items-center gap-2.5 rounded-md border border-dashed px-3 py-2.5 cursor-pointer ${draft.file ? 'border-success/50 bg-success-muted' : 'border-line-strong hover:bg-hover'}`}>
        <Paperclip size={15} className={draft.file ? 'text-success' : 'text-fg-subtle'} />
        <span className="flex-1 min-w-0 text-small truncate">{draft.file ? draft.file.name : `Attach the ${meta.sealed ? 'signed and stamped ' : ''}${meta.label.toLowerCase()} — PDF or photo`}</span>
        {draft.file && <span className="text-caption text-fg-muted">{(draft.file.size / 1024 / 1024).toFixed(1)} MB</span>}
        <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block"><span className={label}>Date on the document *</span>
          <input type="date" value={draft.documentDate} max={todayStr()} onChange={(e) => set({ documentDate: e.target.value })} className="input" />
        </label>
        {kind === 'driver_termination_letter' && (
          <label className="block"><span className={label}>How it was given *</span>
            <select value={draft.deliveredHow} onChange={(e) => set({ deliveredHow: e.target.value })} className="input">
              <option value="" disabled>Choose…</option>
              {DELIVERED_HOW.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {meta.sealed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <label className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-small cursor-pointer ${draft.signed ? 'border-success/50 bg-success-muted' : 'border-line hover:bg-hover'}`}>
            <input type="checkbox" checked={draft.signed} onChange={(e) => set({ signed: e.target.checked })} /> <FileSignature size={13} /> Signed by both sides
          </label>
          <label className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-small cursor-pointer ${draft.stamped ? 'border-success/50 bg-success-muted' : 'border-line hover:bg-hover'}`}>
            <input type="checkbox" checked={draft.stamped} onChange={(e) => set({ stamped: e.target.checked })} /> <Stamp size={13} /> Stamped by Kivu Ride
          </label>
        </div>
      )}
      <input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} className="input" placeholder="Note (optional)" aria-label="Note" />
    </fieldset>
  );
}

// Add a document on its own - a missing contract, letter or agreement.
export function AddLegalDocModal({ kind, driverId, ownerId, name, onClose, onSaved }: {
  kind: LegalKind; driverId?: string; ownerId?: string; name: string; onClose: () => void; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<LegalDraft>(emptyDraft(todayStr()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    const up = await uploadDraft(kind, (driverId ?? ownerId)!, draft);
    if ('error' in up) { setBusy(false); setError(up.error); return; }
    const { error: err } = ownerId
      ? await supabase.rpc('add_owner_agreement', { p_owner: ownerId, d: up.doc })
      : await supabase.rpc('add_driver_document', { p_driver: driverId, p_kind: kind, d: up.doc });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Add ${LEGAL_KIND[kind].label.toLowerCase()}`} subtitle={name} maxWidth="max-w-md">
      <div className="space-y-3">
        <LegalDocFields kind={kind} draft={draft} onChange={setDraft} />
        {error && <p className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : 'Save document'}</button>
        </div>
      </div>
    </Modal>
  );
}

// A driver's or owner's contract documents, with what's missing on top.
export function LegalDocsBox({ docs, missing, canAdd, addKinds, onAdd }: {
  docs: LegalDoc[]; missing: LegalKind | null; canAdd: boolean; addKinds: LegalKind[]; onAdd: (k: LegalKind) => void;
}) {
  const [error, setError] = useState('');
  const sorted = [...docs].sort((a, b) => b.document_date.localeCompare(a.document_date));
  return (
    <div className="space-y-3">
      {missing && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger-muted px-3 py-2.5">
          <Label tone="danger">{LEGAL_KIND[missing].missing}</Label>
          <span className="text-small flex-1 min-w-[200px]">{missing === 'driver_termination_letter' ? 'The contract ended without its termination letter on file.' : `The ${LEGAL_KIND[missing].sealed ? 'signed and stamped ' : ''}${LEGAL_KIND[missing].label.toLowerCase()} isn't on file.`}</span>
          {canAdd && <button onClick={() => onAdd(missing)} className="btn-primary text-caption"><Plus size={13} /> Add it now</button>}
        </div>
      )}
      {sorted.length ? (
        <ul className="divide-y divide-line-muted rounded-lg border border-line">
          {sorted.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <FileText size={15} className="text-fg-subtle" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">{LEGAL_KIND[x.kind].label}</span>
                <span className="block text-caption text-fg-muted">Dated {day(x.document_date)}{x.period_start ? ` · contract from ${day(x.period_start)}` : ''}{x.delivered_how ? ` · ${DELIVERED_HOW.find((o) => o.key === x.delivered_how)?.label ?? x.delivered_how}` : ''}{x.notes ? ` · ${x.notes}` : ''}</span>
              </span>
              {LEGAL_KIND[x.kind].sealed && x.signed && x.stamped && <Label tone="success" icon={BadgeCheck}>Signed & stamped</Label>}
              <button onClick={async () => setError((await openLegalDoc(x.file_path)) ?? '')} className="btn-ghost text-caption"><ExternalLink size={13} /> Open</button>
            </li>
          ))}
        </ul>
      ) : !missing && <p className="text-small text-fg-muted">No contract documents yet.</p>}
      {canAdd && (
        <div className="flex flex-wrap gap-1.5">
          {addKinds.map((k) => <button key={k} onClick={() => onAdd(k)} className="btn-secondary text-caption"><Plus size={13} /> {LEGAL_KIND[k].label}</button>)}
        </div>
      )}
      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}
