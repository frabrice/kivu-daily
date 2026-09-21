import { useState } from 'react';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { supabase, DriverDocument, DriverDocumentType } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { DRIVER_DOCUMENT_TYPES } from '../../lib/fleet';

// The seven documents Fleet collects from every applying driver. Each
// upload goes straight to the shared 'documents' storage bucket and a
// driver_documents row the moment a file is picked - independent of the
// driver form's own Save Changes, since these are their own DB rows.
// Uploading again for a type that already has a file just replaces the
// row's reference (upsert on driver_id+doc_type); the old file is left
// in storage rather than deleted, since the bucket's delete policy only
// lets the original uploader remove their own object and a replacement
// is often done by a different staff member.
export default function DriverDocumentsSection({
  driverId,
  documents,
  canEdit,
  onSaved,
}: {
  driverId: string;
  documents: DriverDocument[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [uploadingType, setUploadingType] = useState<DriverDocumentType | null>(null);
  const [error, setError] = useState('');

  const docFor = (type: DriverDocumentType) => documents.find((d) => d.doc_type === type) ?? null;

  const upload = async (docType: DriverDocumentType, file: File) => {
    setUploadingType(docType);
    setError('');
    const path = `drivers/${driverId}/${docType}-${crypto.randomUUID()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage.from('documents').upload(path, file);
    if (uploadErr) { setUploadingType(null); setError(uploadErr.message); return; }
    const { error: dbErr } = await supabase.from('driver_documents').upsert(
      { driver_id: driverId, doc_type: docType, file_url: path, file_name: file.name, uploaded_by: profile!.id, uploaded_at: new Date().toISOString() },
      { onConflict: 'driver_id,doc_type' }
    );
    setUploadingType(null);
    if (dbErr) { setError(dbErr.message); return; }
    onSaved();
  };

  const view = async (doc: DriverDocument) => {
    setError('');
    const { data, error: err } = await supabase.storage.from('documents').createSignedUrl(doc.file_url, 3600);
    if (err || !data) { setError(err?.message ?? 'Could not open this file.'); return; }
    window.open(data.signedUrl, '_blank');
  };

  return (
    <div className="space-y-1.5">
      {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
      {DRIVER_DOCUMENT_TYPES.map((t) => {
        const doc = docFor(t.key);
        const isUploading = uploadingType === t.key;
        return (
          <div key={t.key} className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 dark:border-white/10">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium">{t.label}</p>
              {doc ? (
                <button type="button" onClick={() => view(doc)} className="text-[10px] text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 mt-0.5 truncate">
                  <ExternalLink size={10} className="shrink-0" /> <span className="truncate">{doc.file_name}</span>
                </button>
              ) : (
                <p className="text-[10px] text-gray-400 mt-0.5">Not uploaded</p>
              )}
            </div>
            {doc && <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />}
            {canEdit && (
              <label className={`shrink-0 text-center whitespace-nowrap cursor-pointer ${doc ? 'btn-ghost' : 'btn-primary'} ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {isUploading ? 'Uploading…' : doc ? 'Replace' : 'Upload'}
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(t.key, file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
