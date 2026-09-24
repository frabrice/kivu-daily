import { useEffect, useMemo, useState } from 'react';
import {
  Plus, ArrowLeft, Eye, Send, TestTube2, Save, Loader2, CheckCircle2, XCircle, FileDown,
} from 'lucide-react';
import { supabase, Newsletter, NewsletterVehicleReport, Vehicle, VehicleOwner, FinanceTransaction } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { startOfWeek, dateStr } from '../../lib/utils';
import { generateOwnerReportPdf, blobToBase64, VehicleReportInput } from '../../lib/newsletterPdf';
import Modal from '../../components/Modal';

interface DraftRow {
  currentMileage: string;
  remainingMileageToService: string;
  distanceThisWeek: string;
  totalEarningsSoFar: string;
  personalNote: string;
}

function emptyRow(): DraftRow {
  return { currentMileage: '', remainingMileageToService: '', distanceThisWeek: '', totalEarningsSoFar: '', personalNote: '' };
}

function thisWeekPayout(vehicleId: string, transactions: FinanceTransaction[]): number | null {
  const weekStart = dateStr(startOfWeek(new Date()));
  const tx = transactions.find((t) => t.type === 'vehicle_owner_payment' && t.linked_vehicle_id === vehicleId && dateStr(startOfWeek(new Date(`${t.transaction_date}T00:00:00`))) === weekStart);
  return tx ? tx.amount : null;
}

export default function VehicleOwnerNewsletterTab() {
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Newsletter | 'new' | null>(null);

  const load = async () => {
    const { data } = await supabase.from('newsletters').select('*').eq('audience', 'vehicle_owners').order('created_at', { ascending: false });
    setNewsletters((data as Newsletter[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (editing) {
    return (
      <ComposeNewsletter
        newsletter={editing === 'new' ? null : editing}
        onBack={() => { setEditing(null); load(); }}
      />
    );
  }

  if (loading) return <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setEditing('new')} className="btn-primary flex items-center gap-1.5">
          <Plus size={14} /> New Newsletter
        </button>
      </div>

      {newsletters.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-[12px] text-gray-400">No newsletters yet.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {newsletters.map((n) => (
            <button key={n.id} onClick={() => setEditing(n)} className="w-full card p-3.5 flex items-center gap-3 hover:shadow-md hover:border-brand/30 transition-all text-left">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate">{n.subject}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${n.status === 'sent' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-white/5'}`}>
                {n.status === 'sent' ? 'Sent' : 'Draft'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeNewsletter({ newsletter, onBack }: { newsletter: Newsletter | null; onBack: () => void }) {
  const { profile } = useAuth();
  const [newsletterId, setNewsletterId] = useState<string | null>(newsletter?.id ?? null);
  const [subject, setSubject] = useState(newsletter?.subject ?? '');
  const [htmlBody, setHtmlBody] = useState(newsletter?.html_body ?? '');
  const [owners, setOwners] = useState<VehicleOwner[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [rows, setRows] = useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [confirmSendAll, setConfirmSendAll] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ owner: string; status: 'sending' | 'sent' | 'failed' }[] | null>(null);
  const [previewingOwnerId, setPreviewingOwnerId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(newsletter?.status ?? 'draft');

  const load = async () => {
    const [ownersRes, vehiclesRes, txRes, reportsRes] = await Promise.all([
      supabase.from('vehicle_owners').select('*').order('full_name'),
      supabase.from('vehicles').select('*').not('owner_id', 'is', null),
      supabase.from('finance_transactions').select('*').eq('type', 'vehicle_owner_payment'),
      newsletter ? supabase.from('newsletter_vehicle_reports').select('*').eq('newsletter_id', newsletter!.id) : Promise.resolve({ data: [] as NewsletterVehicleReport[] }),
    ]);
    setOwners((ownersRes.data as VehicleOwner[]) ?? []);
    setVehicles((vehiclesRes.data as Vehicle[]) ?? []);
    setTransactions((txRes.data as FinanceTransaction[]) ?? []);

    const existing = (reportsRes.data as NewsletterVehicleReport[]) ?? [];
    const rowMap: Record<string, DraftRow> = {};
    for (const r of existing) {
      rowMap[r.vehicle_id] = {
        currentMileage: r.current_mileage?.toString() ?? '',
        remainingMileageToService: r.remaining_mileage_to_service?.toString() ?? '',
        distanceThisWeek: r.distance_this_week?.toString() ?? '',
        totalEarningsSoFar: r.total_earnings_so_far?.toString() ?? '',
        personalNote: r.personal_note ?? '',
      };
    }
    setRows(rowMap);
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ownersWithVehicles = useMemo(
    () => owners.map((o) => ({ owner: o, vehicles: vehicles.filter((v) => v.owner_id === o.id) })).filter((o) => o.vehicles.length > 0),
    [owners, vehicles],
  );

  const updateRow = (vehicleId: string, patch: Partial<DraftRow>) =>
    setRows((prev) => ({ ...prev, [vehicleId]: { ...(prev[vehicleId] ?? emptyRow()), ...patch } }));

  const canSave = subject.trim() && htmlBody.trim();

  const saveDraft = async (): Promise<string | null> => {
    if (!canSave) { setError('Subject and newsletter content are required.'); return null; }
    setSaving(true);
    setError('');
    let id = newsletterId;
    if (!id) {
      const { data, error: err } = await supabase.from('newsletters').insert({
        audience: 'vehicle_owners', subject: subject.trim(), html_body: htmlBody, created_by: profile!.id,
      }).select().single();
      if (err) { setSaving(false); setError(err.message); return null; }
      id = data!.id;
      setNewsletterId(id);
    } else {
      await supabase.from('newsletters').update({ subject: subject.trim(), html_body: htmlBody, updated_at: new Date().toISOString() }).eq('id', id);
    }

    const upserts = Object.entries(rows)
      .filter(([, r]) => r.currentMileage || r.remainingMileageToService || r.distanceThisWeek || r.totalEarningsSoFar || r.personalNote)
      .map(([vehicleId, r]) => ({
        newsletter_id: id,
        vehicle_id: vehicleId,
        current_mileage: r.currentMileage ? Number(r.currentMileage) : null,
        remaining_mileage_to_service: r.remainingMileageToService ? Number(r.remainingMileageToService) : null,
        distance_this_week: r.distanceThisWeek ? Number(r.distanceThisWeek) : null,
        total_earnings_so_far: r.totalEarningsSoFar ? Number(r.totalEarningsSoFar) : null,
        personal_note: r.personalNote.trim() || null,
        updated_at: new Date().toISOString(),
      }));
    if (upserts.length > 0) {
      await supabase.from('newsletter_vehicle_reports').upsert(upserts, { onConflict: 'newsletter_id,vehicle_id' });
    }
    setSaving(false);
    return id;
  };

  const buildReportInputs = (ownerVehicles: Vehicle[]): VehicleReportInput[] =>
    ownerVehicles.map((v) => {
      const r = rows[v.id] ?? emptyRow();
      return {
        vehicle: v,
        currentMileage: r.currentMileage ? Number(r.currentMileage) : null,
        remainingMileageToService: r.remainingMileageToService ? Number(r.remainingMileageToService) : null,
        distanceThisWeek: r.distanceThisWeek ? Number(r.distanceThisWeek) : null,
        totalEarningsSoFar: r.totalEarningsSoFar ? Number(r.totalEarningsSoFar) : null,
        thisWeeksPayout: thisWeekPayout(v.id, transactions),
        personalNote: r.personalNote.trim() || null,
      };
    });

  const previewPdf = async (owner: VehicleOwner, ownerVehicles: Vehicle[]) => {
    setPreviewingOwnerId(owner.id);
    try {
      const blob = await generateOwnerReportPdf(owner, buildReportInputs(ownerVehicles));
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } finally {
      setPreviewingOwnerId(null);
    }
  };

  const sendTestToMyself = async () => {
    if (!profile?.email) { setError('Your own profile has no email on file.'); return; }
    if (ownersWithVehicles.length === 0) { setError('No vehicle owners with cars to build a sample report from.'); return; }
    setSendingTest(true);
    setError('');
    try {
      const sample = ownersWithVehicles[0];
      const blob = await generateOwnerReportPdf(sample.owner, buildReportInputs(sample.vehicles));
      const pdfBase64 = await blobToBase64(blob);
      const { data, error: err } = await supabase.functions.invoke('send-newsletter', {
        body: {
          to: profile.email,
          subject: `[TEST] ${subject}`,
          html: htmlBody,
          pdf_base64: pdfBase64,
          pdf_filename: `${sample.owner.full_name.replace(/\s+/g, '-')}-weekly-report.pdf`,
        },
      });
      if (err || !data?.success) throw new Error(data?.error || err?.message || 'Failed to send test email');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const sendToAllOwners = async () => {
    setConfirmSendAll(false);
    const id = await saveDraft();
    if (!id) return;
    setSendingAll(true);
    setError('');
    setSendProgress(ownersWithVehicles.map((o) => ({ owner: o.owner.full_name, status: 'sending' as const })));

    for (let i = 0; i < ownersWithVehicles.length; i++) {
      const { owner, vehicles: ov } = ownersWithVehicles[i];
      if (!owner.email) {
        setSendProgress((prev) => prev!.map((p, idx) => (idx === i ? { ...p, status: 'failed' } : p)));
        continue;
      }
      try {
        const blob = await generateOwnerReportPdf(owner, buildReportInputs(ov));
        const pdfBase64 = await blobToBase64(blob);
        const { data, error: err } = await supabase.functions.invoke('send-newsletter', {
          body: {
            newsletter_id: id,
            owner_id: owner.id,
            to: owner.email,
            subject,
            html: htmlBody,
            pdf_base64: pdfBase64,
            pdf_filename: `${owner.full_name.replace(/\s+/g, '-')}-weekly-report.pdf`,
          },
        });
        const ok = !err && data?.success;
        setSendProgress((prev) => prev!.map((p, idx) => (idx === i ? { ...p, status: ok ? 'sent' : 'failed' } : p)));
      } catch {
        setSendProgress((prev) => prev!.map((p, idx) => (idx === i ? { ...p, status: 'failed' } : p)));
      }
    }

    await supabase.from('newsletters').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
    setStatus('sent');
    setSendingAll(false);
  };

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>;

  const isSent = status === 'sent';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={onBack} className="btn-ghost flex items-center gap-1.5"><ArrowLeft size={14} /> Back to Newsletters</button>
        {isSent && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-500/10">
            <CheckCircle2 size={12} /> SENT
          </span>
        )}
      </div>

      {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="card p-4 space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={isSent} className="input" placeholder="e.g. Your Kivu Ride Weekly Update — Sep 22-28" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Newsletter HTML</label>
            <textarea
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              disabled={isSent}
              rows={16}
              className="input font-mono text-[11px] resize-none"
              placeholder="Paste or write the newsletter's HTML here…"
            />
            <p className="text-[10px] text-gray-400 mt-1">"Attached is the weekly report." is added automatically at the end — no need to type it.</p>
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Live Preview</label>
            <div className="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden bg-white" style={{ height: '390px' }}>
              <iframe title="Newsletter preview" srcDoc={htmlBody || '<p style="font-family:sans-serif;color:#9ca3af;padding:16px;">Nothing to preview yet.</p>'} className="w-full h-full" sandbox="" />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Per-Owner Report Data</p>
        {ownersWithVehicles.length === 0 && (
          <div className="card p-8 text-center"><p className="text-[12px] text-gray-400">No vehicle owners with cars on file yet.</p></div>
        )}
        {ownersWithVehicles.map(({ owner, vehicles: ov }) => (
          <div key={owner.id} className="card p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <p className="text-[12px] font-semibold">{owner.full_name}</p>
                <p className="text-[10px] text-gray-400">{owner.email || 'No email on file'}</p>
              </div>
              <button onClick={() => previewPdf(owner, ov)} disabled={previewingOwnerId === owner.id} className="btn-ghost text-[11px] flex items-center gap-1.5 disabled:opacity-50">
                {previewingOwnerId === owner.id ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Preview PDF
              </button>
            </div>
            <div className="space-y-2">
              {ov.map((v) => {
                const r = rows[v.id] ?? emptyRow();
                const payout = thisWeekPayout(v.id, transactions);
                return (
                  <div key={v.id} className="bg-gray-50 dark:bg-white/5 rounded-lg p-2.5">
                    <p className="text-[11px] font-medium mb-2 flex items-center gap-2">
                      {v.plate_number}
                      <span className="text-[9px] font-normal text-gray-400">This week's payout: {payout !== null ? `${payout.toLocaleString()} RWF` : '—'}</span>
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <MiniField label="Current Mileage (km)" value={r.currentMileage} onChange={(val) => updateRow(v.id, { currentMileage: val })} disabled={isSent} />
                      <MiniField label="Remaining to Service (km)" value={r.remainingMileageToService} onChange={(val) => updateRow(v.id, { remainingMileageToService: val })} disabled={isSent} />
                      <MiniField label="Distance This Week (km)" value={r.distanceThisWeek} onChange={(val) => updateRow(v.id, { distanceThisWeek: val })} disabled={isSent} />
                      <MiniField label="Total Earnings So Far (RWF)" value={r.totalEarningsSoFar} onChange={(val) => updateRow(v.id, { totalEarningsSoFar: val })} disabled={isSent} />
                    </div>
                    <div className="mt-2">
                      <label className="block text-[9px] font-medium mb-1 text-gray-500">Personal Note (optional)</label>
                      <input value={r.personalNote} onChange={(e) => updateRow(v.id, { personalNote: e.target.value })} disabled={isSent} className="input text-[11px]" placeholder="e.g. Great week — steady demand!" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!isSent && (
        <div className="flex flex-wrap gap-2 justify-end pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={saveDraft} disabled={saving || !canSave} className="btn-ghost flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save Draft
          </button>
          <button onClick={sendTestToMyself} disabled={sendingTest || !canSave} className="btn-ghost flex items-center gap-1.5 disabled:opacity-50">
            {sendingTest ? <Loader2 size={13} className="animate-spin" /> : <TestTube2 size={13} />} Send Test to Myself
          </button>
          <button onClick={() => setConfirmSendAll(true)} disabled={sendingAll || !canSave || ownersWithVehicles.length === 0} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
            <Send size={13} /> Send to All Owners
          </button>
        </div>
      )}

      {confirmSendAll && (
        <Modal open onClose={() => setConfirmSendAll(false)} title="Send to All Owners?" maxWidth="max-w-sm">
          <p className="text-[12px] text-gray-600 dark:text-gray-300">
            This will email {ownersWithVehicles.length} vehicle owner{ownersWithVehicles.length === 1 ? '' : 's'} their personalized newsletter and PDF report right now. This can't be undone.
          </p>
          <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-gray-100 dark:border-white/5">
            <button onClick={() => setConfirmSendAll(false)} className="btn-ghost">Cancel</button>
            <button onClick={sendToAllOwners} className="btn-primary">Yes, Send Now</button>
          </div>
        </Modal>
      )}

      {sendProgress && (
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5"><FileDown size={13} /> Send Progress</p>
          <div className="space-y-1">
            {sendProgress.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-[12px] py-1 border-b border-gray-50 dark:border-white/5 last:border-0">
                <span>{p.owner}</span>
                {p.status === 'sending' && <Loader2 size={13} className="animate-spin text-gray-400" />}
                {p.status === 'sent' && <CheckCircle2 size={13} className="text-positive" />}
                {p.status === 'failed' && <XCircle size={13} className="text-red-500" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="block text-[9px] font-medium mb-1 text-gray-500">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="input text-[11px]" />
    </div>
  );
}
