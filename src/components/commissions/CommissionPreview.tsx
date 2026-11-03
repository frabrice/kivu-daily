import { useEffect, useMemo, useState } from 'react';
import { Building2, FileSpreadsheet, FileText, Loader2, Save, Search } from 'lucide-react';
import Modal from '../Modal';
import { Label } from '../../ui/kit';
import { shortAddress } from '../../lib/trips';
import { kigaliDay } from '../../lib/kigali';
import { longDay } from '../charts/kit';
import { download, fileName, toExcel, toPdf } from '../../lib/fleetExports';
import {
  COMMISSION_RATE, CTrip, Company, Followup, METHOD_LABEL, autoExempt, commissionReport, companyReason, exemptReason, isCash, isExempt, looksLike,
  saveExemptions, summarise, tagToCompany, timeOf,
} from '../../lib/commissions';

// Trips > Commissions > Preview: every completed trip of the period before
// the report is exported. Company trips are already left out; trips whose
// rider name looks like a company (drivers type "CEVR", "CVR") come ticked
// for Finance or the MD to confirm. Anything else can be left out with a
// reason. Saved choices apply everywhere (commission_exemptions); others
// only see them.

type Pick = { exempt: boolean; reason: string };
type View = 'all' | 'exempt' | 'check' | 'cash';
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const REASONS = ['Our own trip (staff, errand)', 'Test trip'];

export default function CommissionPreview({ trips, followups, companies, days, from, to, period, canEdit, onClose, onSaved }: {
  trips: CTrip[]; followups: Followup[]; companies: Company[]; days: string[]; from: string; to: string; period: string;
  canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const suggestion = (t: CTrip) => (canEdit && !t.company && !t.decision ? looksLike(t, companies) : null);
  const first = (t: CTrip): Pick => {
    if (isExempt(t)) return { exempt: true, reason: exemptReason(t) };
    const c = suggestion(t);
    return c ? { exempt: true, reason: companyReason(c.name) } : { exempt: false, reason: t.decision?.reason ?? '' };
  };
  const [picks, setPicks] = useState<Map<number, Pick>>(() => new Map(trips.map((t) => [t.id, first(t)])));
  // New trips after a reload get their first choice; what was already chosen here stays.
  useEffect(() => {
    setPicks((m) => { const n = new Map(m); for (const t of trips) if (!n.has(t.id)) n.set(t.id, first(t)); return n; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'save' | 'pdf' | 'xlsx' | number | null>(null);
  const [err, setErr] = useState('');
  const [missing, setMissing] = useState<Set<number>>(new Set());

  const pickOf = (t: CTrip) => picks.get(t.id) ?? first(t);
  const set = (id: number, p: Partial<Pick>) => { setPicks((m) => { const n = new Map(m); n.set(id, { ...(n.get(id) ?? { exempt: false, reason: '' }), ...p }); return n; }); setMissing((s) => { const n = new Set(s); n.delete(id); return n; }); };
  const exempt = useMemo(() => new Map(trips.filter((t) => pickOf(t).exempt).map((t) => [t.id, pickOf(t).reason.trim()])), [trips, picks]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useMemo(() => summarise(trips, followups, days, exempt), [trips, followups, days, exempt]);
  const changed = trips.filter((t) => pickOf(t).exempt !== isExempt(t) || (pickOf(t).exempt && !autoExempt(t) && pickOf(t).reason.trim() !== (t.decision?.reason ?? ''))).length;
  const toCheck = trips.filter((t) => suggestion(t) && pickOf(t).exempt).length;

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return trips
      .filter((t) => view === 'all' || (view === 'exempt' ? pickOf(t).exempt : view === 'check' ? !!suggestion(t) : isCash(t)))
      .filter((t) => !k || [t.driver_name, t.rider_name, t.driver_phone, t.pickup_address, t.destination_address, String(t.id)].some((x) => (x ?? '').toLowerCase().includes(k)))
      .sort((a, b) => (a.completed_at ?? a.requested_at ?? '').localeCompare(b.completed_at ?? b.requested_at ?? ''));
  }, [trips, view, q, picks]); // eslint-disable-line react-hooks/exhaustive-deps

  // A trip left out by hand needs a reason (company trips have theirs).
  const check = () => {
    const bad = trips.filter((t) => pickOf(t).exempt && !t.company && !pickOf(t).reason.trim()).map((t) => t.id);
    setMissing(new Set(bad));
    if (bad.length) { setErr(`Give a reason for the ${bad.length} trip${bad.length === 1 ? '' : 's'} left out by hand (marked in red).`); return false; }
    return true;
  };
  const save = async () => {
    if (!canEdit || !changed) return true;
    if (!check()) return false;
    const n = await saveExemptions(trips, picks);
    if (n) onSaved();
    return true;
  };
  const run = async (what: 'save' | 'pdf' | 'xlsx') => {
    setBusy(what); setErr('');
    try {
      if (!(await save())) return;
      if (what !== 'save') {
        const r = commissionReport(s, from, to, period);
        download(what === 'xlsx' ? await toExcel(r) : await toPdf(r), fileName(r, what));
        onClose();
      }
    } catch (e) { setErr(`${what === 'save' ? 'Could not save' : 'The file could not be made'}: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };
  const tag = async (t: CTrip, c: Company) => {
    setBusy(t.id); setErr('');
    try { await tagToCompany(t.id, c.id); set(t.id, { exempt: true, reason: companyReason(c.name) }); onSaved(); }
    catch (e) { setErr(`Could not add trip #${t.id} to ${c.name}: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };

  const views: [View, string, number][] = [
    ['all', 'All trips', trips.length], ['exempt', 'Left out', s.exempt.trips], ['check', 'Name looks like a company', trips.filter((t) => suggestion(t)).length], ['cash', 'Cash', trips.filter(isCash).length],
  ];

  return (
    <Modal open onClose={onClose} title="Preview the commission report" subtitle={`${period} · company trips carry no commission: they are paid to Kivu Ride and driven by our own drivers`} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['Trips counted', String(s.total.trips), rwf(s.total.fares) + ' in fares'],
            ['Expected (10%)', rwf(s.total.expected), `${rwf(s.total.cash)} on cash trips`],
            ['Still to collect', rwf(s.total.owed), `${rwf(s.total.paid)} recorded paid`],
            ['Left out', String(s.exempt.trips), rwf(s.exempt.fares) + ' in fares'],
          ].map(([l, v, sub]) => (
            <div key={l} className="rounded-md border border-line-muted px-3 py-2">
              <p className="text-caption text-fg-muted">{l}</p><p className="text-body font-semibold tabular-nums">{v}</p><p className="text-caption text-fg-subtle">{sub}</p>
            </div>
          ))}
        </div>

        {canEdit && toCheck > 0 && (
          <p className="text-small rounded-md bg-attention/10 text-attention px-3 py-2">
            {toCheck} trip{toCheck === 1 ? '' : 's'} with a rider name like a company {toCheck === 1 ? 'is' : 'are'} ticked to leave out. Check {toCheck === 1 ? 'it' : 'them'}: untick a trip that isn't one, or add it to the company so it's billed too.
          </p>
        )}
        {!canEdit && <p className="text-caption text-fg-muted rounded-md bg-inset px-3 py-2">Only Finance and the MD can leave trips out. You see what they decided.</p>}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 p-0.5 bg-inset rounded-lg text-small" role="radiogroup" aria-label="Show">
            {views.map(([k, l, n]) => (
              <button key={k} role="radio" aria-checked={view === k} onClick={() => setView(k)} className={`px-2.5 py-1 rounded-md font-medium ${view === k ? 'bg-surface-3 shadow-sm text-brand' : 'text-fg-muted'}`}>{l} <span className="text-fg-subtle tabular-nums">{n}</span></button>
            ))}
          </div>
          <label className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8 !py-1 text-small" placeholder="Driver, rider, place or trip number" />
          </label>
        </div>

        <div className="max-h-[52vh] overflow-y-auto rounded-md border border-line-muted divide-y divide-line-muted">
          {shown.length === 0 && <p className="px-3 py-6 text-center text-small text-fg-muted">No trips here.</p>}
          {shown.map((t) => {
            const p = pickOf(t), c = suggestion(t), fare = Number(t.total_fare ?? 0);
            const needsReason = p.exempt && !t.company;
            return (
              <div key={t.id} className={`px-3 py-2 text-small ${p.exempt ? 'bg-inset/60' : ''}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={p.exempt} disabled={!canEdit} aria-label={`Leave trip #${t.id} out of commission`}
                    onChange={(e) => set(t.id, { exempt: e.target.checked, reason: e.target.checked ? (p.reason || (t.company ? companyReason(t.company.name) : c ? companyReason(c.name) : '')) : (t.company ? '' : p.reason) })} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">
                      <span className="tabular-nums text-fg-muted">{days.length > 1 ? `${longDay(t.day)} · ` : ''}{timeOf(t)}</span>
                      <b className="ml-2">{(t.driver_name ?? 'Unknown driver').replace(/\s+/g, ' ').trim()}</b>
                      {t.kivu_driver_id && <span className="ml-1.5"><Label tone="accent">Ours</Label></span>}
                      <span className="text-fg-muted"> · rider {t.rider_name || '—'}</span>
                    </p>
                    <p className="text-caption text-fg-muted truncate">{shortAddress(t.pickup_address)} → {shortAddress(t.destination_address)} · #{t.id} · {METHOD_LABEL[t.payment_method ?? 'cash'] ?? t.payment_method}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {t.company && <Label tone="info" icon={Building2}>{t.company.name}{t.company.status === 'pending' ? ' · to verify' : ''}</Label>}
                      {c && <Label tone="attention">Name says {c.name}</Label>}
                      {c && canEdit && (
                        <button onClick={() => tag(t, c)} disabled={busy !== null} className="text-caption link">{busy === t.id ? 'Adding…' : `Add to ${c.name}`}</button>
                      )}
                      {t.decision && <span className="text-caption text-fg-subtle">{t.decision.exempt ? 'Left out' : 'Counted'} by {t.decision.by ?? 'Finance'}, {longDay(kigaliDay(t.decision.decided_at))}</span>}
                    </div>
                    {canEdit && (needsReason || (t.company && !p.exempt)) && (
                      <input list="commission-reasons" value={p.reason} onChange={(e) => set(t.id, { reason: e.target.value })}
                        className={`input !py-1 mt-1.5 text-small ${missing.has(t.id) ? '!border-danger' : ''}`}
                        placeholder={needsReason ? 'Why is it left out? e.g. Company trip: CEVR' : 'Why count this company trip? (optional)'} />
                    )}
                    {!canEdit && p.exempt && p.reason && !t.company && <p className="text-caption text-fg-muted mt-0.5">{p.reason}</p>}
                  </div>
                  <div className="text-right tabular-nums shrink-0">
                    <p className="font-medium">{fare.toLocaleString('en-US')}</p>
                    <p className={`text-caption ${p.exempt ? 'line-through text-fg-subtle' : 'text-fg-muted'}`}>10%: {Math.round(fare * COMMISSION_RATE).toLocaleString('en-US')}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <datalist id="commission-reasons">{[...new Set([...companies.map((c) => companyReason(c.name)), ...REASONS])].map((r) => <option key={r} value={r} />)}</datalist>

        {err && <p className="text-small text-danger">{err}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <p className="text-caption text-fg-muted flex-1">{canEdit ? (changed ? `${changed} change${changed === 1 ? '' : 's'} not saved yet: saved when you export.` : 'Everything here is saved.') : 'The report uses what Finance and the MD decided.'}</p>
          {canEdit && <button onClick={() => run('save')} disabled={busy !== null || !changed} className="btn-secondary">{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>}
          <button onClick={() => run('pdf')} disabled={busy !== null} className="btn-secondary">{busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Export PDF</button>
          <button onClick={() => run('xlsx')} disabled={busy !== null} className="btn-primary">{busy === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Export Excel</button>
        </div>
      </div>
    </Modal>
  );
}
