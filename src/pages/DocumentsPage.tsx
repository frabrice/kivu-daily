import { useEffect, useState, useCallback } from 'react';
import { FileText, Upload, Trash2, Download, Building2, Globe2, Pencil } from 'lucide-react';
import { supabase, Document as Doc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/utils';
import Modal from '../components/Modal';
import ViewToggle, { ViewMode } from '../components/ViewToggle';
import DataTable from '../components/DataTable';
import EntryActions from '../components/EntryActions';

export default function DocumentsPage() {
  const { profile } = useAuth();
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [docDrawer, setDocDrawer] = useState<{ doc: Doc; startEditing: boolean } | null>(null);
  const [view, setView] = useState<ViewMode>('cards');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('documents')
      .select('*, uploader:profiles(*), department:departments(*)')
      .order('created_at', { ascending: false });
    const docs = (data as Doc[]) ?? [];
    setDocuments(docs);
    setLoading(false);

    if (docs.length > 0) {
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrls(docs.map((d) => d.file_url), 3600);
      const map: Record<string, string> = {};
      signed?.forEach((s, i) => {
        if (s.signedUrl) map[docs[i].id] = s.signedUrl;
      });
      setUrls(map);
    }
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('documents-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const remove = async (doc: Doc) => {
    await supabase.storage.from('documents').remove([doc.file_url]);
    await supabase.from('documents').delete().eq('id', doc.id);
  };

  const canEdit = (doc: Doc) => profile?.role === 'managing_director' || doc.uploader_id === profile?.id;

  return (
    <div className="space-y-4">
      <button onClick={() => setUploadOpen(true)} className="btn-primary flex items-center justify-center gap-2 py-3 w-full">
        <Upload size={18} />
        <span>Upload a Document</span>
      </button>

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-2xl" />)}
        </div>
      )}

      {!loading && documents.length === 0 && (
        <div className="card p-10 text-center">
          <FileText size={28} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No documents yet.</p>
        </div>
      )}

      {!loading && documents.length > 0 && <ViewToggle value={view} onChange={setView} />}

      {!loading && documents.length > 0 && view === 'cards' && (
        <div className="space-y-2">
          {documents.map((d) => (
            <div
              key={d.id}
              onClick={() => setDocDrawer({ doc: d, startEditing: false })}
              className="card p-4 flex items-center gap-3 animate-fade-in cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                <FileText size={18} className="text-brand-600 dark:text-brand-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.title}</p>
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                  <span className="flex items-center gap-1">
                    {d.department_id ? <Building2 size={11} /> : <Globe2 size={11} />}
                    {d.department?.name ?? 'Company-wide'}
                  </span>
                  <span>·</span>
                  <span>{d.uploader?.full_name}</span>
                  <span>·</span>
                  <span>{timeAgo(d.created_at)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {urls[d.id] && (
                  <a href={urls[d.id]} target="_blank" rel="noreferrer" className="btn-ghost p-2">
                    <Download size={16} />
                  </a>
                )}
                <EntryActions
                  onView={() => setDocDrawer({ doc: d, startEditing: false })}
                  onEdit={() => setDocDrawer({ doc: d, startEditing: true })}
                  canEdit={canEdit(d)}
                />
                {canEdit(d) && (
                  <button onClick={() => remove(d)} className="text-gray-300 hover:text-red-500 transition-colors p-1.5">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && documents.length > 0 && view === 'table' && (
        <DataTable
          rows={documents}
          keyFn={(d) => d.id}
          onRowClick={(d) => setDocDrawer({ doc: d, startEditing: false })}
          columns={[
            { header: 'Title', render: (d) => <span className="font-medium">{d.title}</span> },
            { header: 'Scope', render: (d) => d.department?.name ?? 'Company-wide' },
            { header: 'Category', render: (d) => d.category ?? '—' },
            { header: 'Uploaded By', render: (d) => d.uploader?.full_name ?? 'Unknown' },
            { header: 'Date', render: (d) => timeAgo(d.created_at) },
            {
              header: '',
              className: 'text-right',
              render: (d) => (
                <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                  {urls[d.id] && (
                    <a href={urls[d.id]} target="_blank" rel="noreferrer" className="btn-ghost p-1.5">
                      <Download size={13} />
                    </a>
                  )}
                  <EntryActions
                    onView={() => setDocDrawer({ doc: d, startEditing: false })}
                    onEdit={() => setDocDrawer({ doc: d, startEditing: true })}
                    canEdit={canEdit(d)}
                  />
                  {canEdit(d) && (
                    <button onClick={() => remove(d)} className="btn-ghost p-1.5 text-red-500"><Trash2 size={13} /></button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={load} />

      {docDrawer && (
        <DocumentDrawer
          doc={docDrawer.doc}
          startEditing={docDrawer.startEditing}
          canEdit={canEdit(docDrawer.doc)}
          downloadUrl={urls[docDrawer.doc.id]}
          onClose={() => setDocDrawer(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function DocumentDrawer({
  doc,
  startEditing,
  canEdit,
  downloadUrl,
  onClose,
  onSaved,
}: {
  doc: Doc;
  startEditing: boolean;
  canEdit: boolean;
  downloadUrl?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('documents').update({
      title: title.trim(),
      category: category.trim() || null,
    }).eq('id', doc.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit Document' : doc.title} subtitle={`Uploaded by ${doc.uploader?.full_name ?? 'Unknown'} · ${timeAgo(doc.created_at)}`} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editing} className="input" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Category</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} disabled={!editing} className="input" placeholder="e.g. Contract, Script, Guide" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Visible to</label>
          <p className="text-[13px] text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
            {doc.department_id ? <Building2 size={13} /> : <Globe2 size={13} />}
            {doc.department?.name ?? 'Company-wide'}
          </p>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={() => setEditing(false)} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={saving || !title.trim()} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {downloadUrl && (
              <a href={downloadUrl} target="_blank" rel="noreferrer" className="btn-ghost flex items-center gap-1.5">
                <Download size={13} /> Download
              </a>
            )}
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function UploadDocumentModal({ open, onClose, onUploaded }: { open: boolean; onClose: () => void; onUploaded: () => void }) {
  const { profile } = useAuth();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState<'company' | 'department'>('department');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setTitle('');
    setCategory('');
    setScope('department');
    setFile(null);
    setError('');
  };

  const save = async () => {
    if (!title.trim() || !file || !profile) return;
    setLoading(true);
    setError('');

    const departmentId = scope === 'department' ? profile.department_id : null;
    const path = `${departmentId ?? 'company'}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage.from('documents').upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from('documents').insert({
      uploader_id: profile.id,
      department_id: departmentId,
      title: title.trim(),
      category: category.trim() || null,
      file_url: path,
    });
    setLoading(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    reset();
    onUploaded();
    onClose();
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Upload a Document">
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="block text-sm font-medium mb-1.5">Title</label>
        <input autoFocus type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input mb-3" required />

        <label className="block text-sm font-medium mb-1.5">Category (optional)</label>
        <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Contract, Script, Guide" className="input mb-3" />

        {profile?.department_id && (
          <>
            <label className="block text-sm font-medium mb-1.5">Visible to</label>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button type="button" onClick={() => setScope('department')} className={`p-3 rounded-xl border text-left text-sm ${scope === 'department' ? 'border-brand bg-brand/10' : 'border-gray-200 dark:border-white/10'}`}>
                My department
              </button>
              <button type="button" onClick={() => setScope('company')} className={`p-3 rounded-xl border text-left text-sm ${scope === 'company' ? 'border-brand bg-brand/10' : 'border-gray-200 dark:border-white/10'}`}>
                Everyone
              </button>
            </div>
          </>
        )}

        <label className="block text-sm font-medium mb-1.5">File</label>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input mb-4" required />

        {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 mb-3">{error}</div>}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => { reset(); onClose(); }} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={loading || !title.trim() || !file} className="btn-primary disabled:opacity-50">
            {loading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
