import { useEffect, useState, useCallback } from 'react';
import { FileText, Upload, Trash2, Download, Building2, Globe2 } from 'lucide-react';
import { supabase, Document as Doc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/utils';
import Modal from '../components/Modal';

export default function DocumentsPage() {
  const { profile } = useAuth();
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

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

  const canDelete = (doc: Doc) => profile?.role === 'managing_director' || doc.uploader_id === profile?.id;

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

      <div className="space-y-2">
        {documents.map((d) => (
          <div key={d.id} className="card p-4 flex items-center gap-3 animate-fade-in">
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
            <div className="flex items-center gap-1 shrink-0">
              {urls[d.id] && (
                <a href={urls[d.id]} target="_blank" rel="noreferrer" className="btn-ghost p-2">
                  <Download size={16} />
                </a>
              )}
              {canDelete(d) && (
                <button onClick={() => remove(d)} className="text-gray-300 hover:text-red-500 transition-colors p-2">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={load} />
    </div>
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
