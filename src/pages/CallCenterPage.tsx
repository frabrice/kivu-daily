import { useEffect, useState, useCallback, useMemo } from 'react';
import { Phone, Search, PhoneCall, BookOpen, Users2, Plus, Clock3, Flag } from 'lucide-react';
import { supabase, Driver, CallLog, CallReason, CallOutcome, CallScript } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/utils';
import Modal from '../components/Modal';
import FlagToITDrawer from '../components/FlagToITDrawer';

type Tab = 'queue' | 'directory' | 'scripts';

const STAGE_LABEL: Record<string, string> = {
  applying: 'Applying', training: 'Training', active: 'Active', waiting: 'Waiting', flagged: 'Flagged', inactive: 'Inactive',
};

export default function CallCenterPage() {
  const [tab, setTab] = useState<Tab>('queue');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [reasons, setReasons] = useState<CallReason[]>([]);
  const [outcomes, setOutcomes] = useState<CallOutcome[]>([]);
  const [scripts, setScripts] = useState<CallScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [callDriver, setCallDriver] = useState<Driver | null>(null);
  const [scriptDrawerOpen, setScriptDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    const [d, l, r, o, s] = await Promise.all([
      supabase.from('drivers').select('*'),
      supabase.from('call_logs').select('*, outcome:call_outcomes(*), reason:call_reasons(*), caller:profiles(*)').order('created_at', { ascending: false }),
      supabase.from('call_reasons').select('*').order('sort_order'),
      supabase.from('call_outcomes').select('*').order('sort_order'),
      supabase.from('call_scripts').select('*').order('created_at', { ascending: false }),
    ]);
    setDrivers((d.data as Driver[]) ?? []);
    setLogs((l.data as CallLog[]) ?? []);
    setReasons((r.data as CallReason[]) ?? []);
    setOutcomes((o.data as CallOutcome[]) ?? []);
    setScripts((s.data as CallScript[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('call-center-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const queue = useMemo(() => {
    return drivers
      .filter((d) => d.stage !== 'inactive')
      .map((d) => {
        const driverLogs = logs.filter((l) => l.driver_id === d.id);
        const lastCall = driverLogs[0] ?? null;
        let priority = 4;
        let reasonLabel = '';
        if (!lastCall) {
          priority = 0;
          reasonLabel = 'Never called';
        } else if (lastCall.outcome?.needs_followup) {
          priority = 1;
          reasonLabel = `Follow-up: ${lastCall.outcome.label}`;
        } else {
          const days = Math.floor((Date.now() - new Date(lastCall.created_at).getTime()) / 86400000);
          if (days >= 7) {
            priority = 2;
            reasonLabel = `${days}d since last call`;
          } else {
            priority = 4;
            reasonLabel = `Called ${days === 0 ? 'today' : days + 'd ago'}`;
          }
        }
        return { driver: d, lastCall, priority, reasonLabel };
      })
      .sort((a, b) => a.priority - b.priority || a.driver.full_name.localeCompare(b.driver.full_name));
  }, [drivers, logs]);

  const urgentCount = queue.filter((q) => q.priority <= 2).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
          <TabButton active={tab === 'queue'} onClick={() => setTab('queue')} icon={PhoneCall} label="Call Queue" badge={urgentCount} />
          <TabButton active={tab === 'directory'} onClick={() => setTab('directory')} icon={Users2} label="Directory" />
          <TabButton active={tab === 'scripts'} onClick={() => setTab('scripts')} icon={BookOpen} label="Scripts" />
        </div>
      </div>

      {loading && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 skeleton rounded-xl" />)}</div>}

      {!loading && tab === 'queue' && (
        <div className="space-y-1.5">
          {queue.length === 0 && <EmptyState icon={Phone} text="No drivers yet — add some from the Fleet module." />}
          {queue.map((q) => (
            <button
              key={q.driver.id}
              onClick={() => setCallDriver(q.driver)}
              className="w-full card p-3 flex items-center gap-3 text-left hover:shadow-md hover:border-brand/30 transition-all"
            >
              <div className={`w-1.5 h-8 rounded-full shrink-0 ${q.priority === 0 ? 'bg-red-500' : q.priority === 1 ? 'bg-orange-500' : q.priority === 2 ? 'bg-amber-400' : 'bg-gray-200 dark:bg-white/10'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate">{q.driver.full_name}</p>
                <p className="text-[11px] text-gray-400">{q.driver.phone} · {STAGE_LABEL[q.driver.stage]}</p>
              </div>
              <span className={`text-[11px] font-medium shrink-0 ${q.priority <= 2 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400'}`}>
                {q.reasonLabel}
              </span>
              <Phone size={14} className="text-brand-500 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {!loading && tab === 'directory' && <Directory drivers={drivers} logs={logs} onCall={setCallDriver} />}

      {!loading && tab === 'scripts' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setScriptDrawerOpen(true)} className="btn-primary flex items-center gap-1.5">
              <Plus size={14} /> Add Script
            </button>
          </div>
          {scripts.length === 0 && <EmptyState icon={BookOpen} text="No scripts yet. Add one to help the team handle calls consistently." />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {scripts.map((s) => {
              const reason = reasons.find((r) => r.id === s.reason_id);
              return (
                <div key={s.id} className="card p-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[13px] font-medium">{s.title}</p>
                    {reason && <span className="text-[10px] font-medium text-brand-600 dark:text-brand-300 bg-brand/10 px-1.5 py-0.5 rounded-full">{reason.label}</span>}
                  </div>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{s.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {callDriver && (
        <LogCallDrawer
          driver={callDriver}
          drivers={drivers}
          reasons={reasons}
          outcomes={outcomes}
          scripts={scripts}
          onClose={() => setCallDriver(null)}
          onSaved={load}
        />
      )}

      {scriptDrawerOpen && (
        <AddScriptDrawer reasons={reasons} onClose={() => setScriptDrawerOpen(false)} onSaved={load} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof Phone; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {!!badge && <span className="text-[9px] font-bold text-white bg-orange-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Phone; text: string }) {
  return (
    <div className="card p-10 text-center">
      <Icon size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
      <p className="text-[13px] text-gray-400">{text}</p>
    </div>
  );
}

function Directory({ drivers, logs, onCall }: { drivers: Driver[]; logs: CallLog[]; onCall: (d: Driver) => void }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) => d.full_name.toLowerCase().includes(q) || d.phone.includes(q));
  }, [drivers, search]);

  return (
    <div className="space-y-3">
      <div className="relative w-64">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className="input pl-8" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {filtered.map((d) => {
          const callCount = logs.filter((l) => l.driver_id === d.id).length;
          const last = logs.find((l) => l.driver_id === d.id);
          return (
            <button key={d.id} onClick={() => onCall(d)} className="card p-3.5 text-left hover:shadow-md hover:border-brand/30 transition-all">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[13px] font-medium truncate">{d.full_name}</p>
                <Phone size={13} className="text-brand-500 shrink-0" />
              </div>
              <p className="text-[11px] text-gray-400">{d.phone} · {STAGE_LABEL[d.stage]}</p>
              <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1">
                <Clock3 size={10} /> {callCount === 0 ? 'Never called' : `${callCount} call${callCount === 1 ? '' : 's'} · last ${timeAgo(last!.created_at)}`}
              </p>
            </button>
          );
        })}
        {filtered.length === 0 && <p className="text-[13px] text-gray-400 col-span-full text-center py-8">No drivers found.</p>}
      </div>
    </div>
  );
}

function LogCallDrawer({
  driver,
  drivers,
  reasons,
  outcomes,
  scripts,
  onClose,
  onSaved,
}: {
  driver: Driver;
  drivers: Driver[];
  reasons: CallReason[];
  outcomes: CallOutcome[];
  scripts: CallScript[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [driverId, setDriverId] = useState(driver.id);
  const [reasonId, setReasonId] = useState('');
  const [outcomeId, setOutcomeId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);

  const matchingScript = scripts.find((s) => s.reason_id === reasonId);
  const currentDriver = drivers.find((d) => d.id === driverId) ?? driver;
  const currentReason = reasons.find((r) => r.id === reasonId);

  const save = async () => {
    if (!driverId || !reasonId || !outcomeId) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('call_logs').insert({
      driver_id: driverId,
      caller_id: profile!.id,
      reason_id: reasonId,
      outcome_id: outcomeId,
      note: note.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Log a Call" subtitle="Pick from the list — no typing needed" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Driver</label>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="input">
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} · {d.phone}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Reason for call</label>
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className="input">
            <option value="">Select a reason</option>
            {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>

        {matchingScript && (
          <div className="p-3 rounded-lg bg-brand/5 border border-brand/20">
            <p className="text-[11px] font-semibold text-brand-700 dark:text-brand-300 mb-1">{matchingScript.title}</p>
            <p className="text-[12px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{matchingScript.body}</p>
          </div>
        )}

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Outcome</label>
          <select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)} className="input">
            <option value="">Select an outcome</option>
            {outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Note (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input resize-none" placeholder="Anything worth remembering…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={() => setFlagOpen(true)} className="btn-ghost text-gray-500 flex items-center gap-1.5">
            <Flag size={13} /> Flag to IT
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={saving || !driverId || !reasonId || !outcomeId} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Log Call'}
            </button>
          </div>
        </div>
      </div>

      {flagOpen && (
        <FlagToITDrawer
          entityType="call_context"
          entityId={currentDriver.id}
          entityLabel={`Call with ${currentDriver.full_name}${currentReason ? ` · ${currentReason.label}` : ''}`}
          onClose={() => setFlagOpen(false)}
        />
      )}
    </Modal>
  );
}

function AddScriptDrawer({ reasons, onClose, onSaved }: { reasons: CallReason[]; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [title, setTitle] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('call_scripts').insert({
      title: title.trim(),
      reason_id: reasonId || null,
      body: body.trim(),
      created_by: profile!.id,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Add a Call Script" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="e.g. App confusion walkthrough" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Applies to reason (optional)</label>
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className="input">
            <option value="">General / any reason</option>
            {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">What to say</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="input resize-none" placeholder="Mwaramutse! I'm calling from Kivu Ride…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !title.trim() || !body.trim()} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Add Script'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
