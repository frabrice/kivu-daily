import { useEffect, useState, useCallback, useMemo } from 'react';
import { FileText, Upload, Trash2, Download, Building2, Globe2, Pencil, Folder, FolderPlus, ArrowLeft } from 'lucide-react';
import { supabase, Document as Doc, DocumentCategory, Department } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/utils';
import Modal from '../components/Modal';
import ViewToggle, { ViewMode } from '../components/ViewToggle';
import DataTable from '../components/DataTable';
import EntryActions from '../components/EntryActions';

interface ScopeOption { id: string | null; label: string }

// A department (or company-wide) scope is chosen first, then that
// scope's own categories show as folders - never a flat list mixing
// categories from different scopes together, which is what made every
// department's own "General" category look like one confusing pile of
// identically-named tabs.
export default function DocumentsPage() {
  const { profile } = useAuth();
  const isMD = profile?.role === 'managing_director';

  const [documents, setDocuments] = useState<Doc[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [docDrawer, setDocDrawer] = useState<{ doc: Doc; startEditing: boolean } | null>(null);
  const [view, setView] = useState<ViewMode>('cards');

  const [scopeId, setScopeId] = useState<string | null>(() => profile?.department_id ?? null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | 'all' | null>(null);

  const load = useCallback(async () => {
    const [{ data }, { data: cats }, { data: depts }] = await Promise.all([
      supabase
        .from('documents')
        .select('*, uploader:profiles(*), department:departments(*), document_category:document_categories(*)')
        .order('created_at', { ascending: false }),
      supabase.from('document_categories').select('*').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]);
    const docs = (data as Doc[]) ?? [];
    setDocuments(docs);
    setCategories((cats as DocumentCategory[]) ?? []);
    setDepartments((depts as Department[]) ?? []);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_categories' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const remove = async (doc: Doc) => {
    await supabase.storage.from('documents').remove([doc.file_url]);
    await supabase.from('documents').delete().eq('id', doc.id);
  };

  const canEdit = (doc: Doc) => profile?.role === 'managing_director' || doc.uploader_id === profile?.id;

  const scopes: ScopeOption[] = useMemo(() => {
    if (isMD) return [...departments.map((d) => ({ id: d.id, label: d.name })), { id: null, label: 'Company-wide' }];
    const opts: ScopeOption[] = [];
    if (profile?.department_id) opts.push({ id: profile.department_id, label: 'My Department' });
    opts.push({ id: null, label: 'Company-wide' });
    return opts;
  }, [isMD, departments, profile]);

  const currentScopeLabel = scopes.find((s) => s.id === scopeId)?.label ?? 'Company-wide';
  const scopeDocuments = useMemo(() => documents.filter((d) => d.department_id === scopeId), [documents, scopeId]);
  const scopeCategories = useMemo(() => categories.filter((c) => c.department_id === scopeId), [categories, scopeId]);
  const canCreateCategory = (scopeId !== null && scopeId === profile?.department_id) || (scopeId === null && isMD);

  const visibleDocuments = useMemo(() => {
    if (activeCategoryId === null) return [];
    if (activeCategoryId === 'all') return scopeDocuments;
    return scopeDocuments.filter((d) => d.category_id === activeCategoryId);
  }, [scopeDocuments, activeCategoryId]);

  const categoryDocCount = (id: string) => scopeDocuments.filter((d) => d.category_id === id).length;

  const openScope = (id: string | null) => {
    setScopeId(id);
    setActiveCategoryId(null);
  };

  return (
    <div className="space-y-4">
      {scopes.length > 1 && (
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit flex-wrap">
          {scopes.map((s) => (
            <button
              key={s.id ?? 'company'}
              onClick={() => openScope(s.id)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${scopeId === s.id ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
            >
              {s.id ? <Building2 size={13} /> : <Globe2 size={13} />} {s.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 skeleton rounded-2xl" />)}
        </div>
      )}

      {!loading && activeCategoryId === null && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <button
            onClick={() => setActiveCategoryId('all')}
            className="card p-4 text-left hover:shadow-md hover:border-brand/30 transition-all flex flex-col gap-2.5"
          >
            <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center">
              <FileText size={16} className="text-brand-600 dark:text-brand-300" />
            </div>
            <div>
              <p className="text-[12px] font-medium">All Documents</p>
              <p className="text-[10px] text-gray-400">{scopeDocuments.length} file{scopeDocuments.length === 1 ? '' : 's'}</p>
            </div>
          </button>
          {scopeCategories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategoryId(c.id)}
              className="card p-4 text-left hover:shadow-md hover:border-brand/30 transition-all flex flex-col gap-2.5"
            >
              <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                <Folder size={16} className="text-amber-600 dark:text-amber-300" />
              </div>
              <div>
                <p className="text-[12px] font-medium truncate">{c.name}</p>
                <p className="text-[10px] text-gray-400">{categoryDocCount(c.id)} file{categoryDocCount(c.id) === 1 ? '' : 's'}</p>
              </div>
            </button>
          ))}
          {canCreateCategory && (
            <button
              onClick={() => setNewCategoryOpen(true)}
              className="p-4 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/10 hover:border-brand/40 transition-all flex flex-col gap-2.5 text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-white/5 flex items-center justify-center">
                <FolderPlus size={16} className="text-gray-400" />
              </div>
              <p className="text-[12px] font-medium text-gray-500">New Category</p>
            </button>
          )}
        </div>
      )}

      {!loading && activeCategoryId !== null && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2.5">
            <div>
              <button onClick={() => setActiveCategoryId(null)} className="text-[11px] text-gray-400 hover:text-brand-600 dark:hover:text-brand-300 flex items-center gap-1 mb-1">
                <ArrowLeft size={11} /> {currentScopeLabel}
              </button>
              <h2 className="text-base font-semibold flex items-center gap-2">
                {activeCategoryId === 'all' ? <FileText size={16} className="text-blue-600 dark:text-blue-300" /> : <Folder size={16} className="text-amber-600 dark:text-amber-300" />}
                {activeCategoryId === 'all' ? 'All Documents' : scopeCategories.find((c) => c.id === activeCategoryId)?.name}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {visibleDocuments.length > 0 && <ViewToggle value={view} onChange={setView} />}
              <button onClick={() => setUploadOpen(true)} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
                <Upload size={14} /> Upload
              </button>
            </div>
          </div>

          {visibleDocuments.length === 0 && (
            <div className="card p-10 text-center">
              <FileText size={28} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No documents here yet.</p>
            </div>
          )}

          {visibleDocuments.length > 0 && view === 'cards' && (
            <div className="space-y-2">
              {visibleDocuments.map((d) => (
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
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5 flex-wrap">
                      {activeCategoryId === 'all' && d.document_category && (
                        <>
                          <span className="flex items-center gap-1"><Folder size={11} /> {d.document_category.name}</span>
                          <span>·</span>
                        </>
                      )}
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

          {visibleDocuments.length > 0 && view === 'table' && (
            <DataTable
              rows={visibleDocuments}
              keyFn={(d) => d.id}
              onRowClick={(d) => setDocDrawer({ doc: d, startEditing: false })}
              columns={[
                { header: 'Title', render: (d) => <span className="font-medium">{d.title}</span> },
                ...(activeCategoryId === 'all' ? [{ header: 'Category', render: (d: Doc) => d.document_category?.name ?? '—' }] : []),
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
        </div>
      )}

      <UploadDocumentModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={load}
        scopeId={scopeId}
        scopeLabel={currentScopeLabel}
        categories={scopeCategories}
        initialCategoryId={activeCategoryId === 'all' || activeCategoryId === null ? null : activeCategoryId}
      />

      <NewCategoryModal
        open={newCategoryOpen}
        onClose={() => setNewCategoryOpen(false)}
        scopeId={scopeId}
        scopeLabel={currentScopeLabel}
        onCreated={load}
      />

      {docDrawer && (
        <DocumentDrawer
          doc={docDrawer.doc}
          startEditing={docDrawer.startEditing}
          canEdit={canEdit(docDrawer.doc)}
          downloadUrl={urls[docDrawer.doc.id]}
          categories={categories.filter((c) => c.department_id === docDrawer.doc.department_id)}
          onClose={() => setDocDrawer(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function NewCategoryModal({
  open,
  onClose,
  scopeId,
  scopeLabel,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  scopeId: string | null;
  scopeLabel: string;
  onCreated: () => void;
}) {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const close = () => { setName(''); setError(''); onClose(); };

  const save = async () => {
    if (!name.trim() || !profile) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('document_categories').insert({
      name: name.trim(),
      department_id: scopeId,
      created_by: profile.id,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onCreated();
    close();
  };

  return (
    <Modal open={open} onClose={close} title="New Category" subtitle={scopeLabel} maxWidth="max-w-sm">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Category name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            className="input"
            placeholder="e.g. Contracts"
            autoFocus
          />
        </div>
        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={close} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DocumentDrawer({
  doc,
  startEditing,
  canEdit,
  downloadUrl,
  categories,
  onClose,
  onSaved,
}: {
  doc: Doc;
  startEditing: boolean;
  canEdit: boolean;
  downloadUrl?: string;
  categories: DocumentCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [title, setTitle] = useState(doc.title);
  const [categoryId, setCategoryId] = useState(doc.category_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('documents').update({
      title: title.trim(),
      category_id: categoryId || null,
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
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editing} className="input" autoFocus />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Category</label>
          {editing ? (
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <p className="text-[12px] text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
              <Folder size={13} /> {doc.document_category?.name ?? 'No category'}
            </p>
          )}
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Visible to</label>
          <p className="text-[12px] text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
            {doc.department_id ? <Building2 size={13} /> : <Globe2 size={13} />}
            {doc.department?.name ?? 'Company-wide'}
          </p>
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

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

function UploadDocumentModal({
  open,
  onClose,
  onUploaded,
  scopeId,
  scopeLabel,
  categories,
  initialCategoryId,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  scopeId: string | null;
  scopeLabel: string;
  categories: DocumentCategory[];
  initialCategoryId: string | null;
}) {
  const { profile } = useAuth();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setCategoryId(initialCategoryId ?? '');
  }, [open, initialCategoryId]);

  const reset = () => {
    setTitle('');
    setCategoryId(initialCategoryId ?? '');
    setFile(null);
    setError('');
  };

  const save = async () => {
    if (!title.trim() || !file || !profile) return;
    setLoading(true);
    setError('');

    const path = `${scopeId ?? 'company'}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage.from('documents').upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from('documents').insert({
      uploader_id: profile.id,
      department_id: scopeId,
      title: title.trim(),
      category_id: categoryId || null,
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
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Upload a Document" subtitle={scopeLabel}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="block text-sm font-medium mb-1.5">Title</label>
        <input autoFocus type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input mb-3" required />

        <label className="block text-sm font-medium mb-1.5">Category</label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input mb-3">
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

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
