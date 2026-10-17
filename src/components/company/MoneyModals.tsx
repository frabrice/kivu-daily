import { ReactNode, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { kigaliToday } from '../../lib/it';
import { PlanData } from '../../lib/companyPlan';
import { FUNDING_KIND, FUNDING_STATUS, Funding, FundingKind, FundingStatus, MoneyData, NOT_OWN_BY_DEFAULT, latestCash, rwf } from '../../lib/companyMoney';
import Modal from '../Modal';

const lbl = 'block text-caption font-medium mb-1.5 text-fg-muted';
const Err = ({ msg }: { msg: string }) => (msg ? <p className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{msg}</p> : null);
const Foot = ({ onClose, busy, label, onSave, left }: { onClose: () => void; busy: boolean; label: string; onSave: () => void; left?: ReactNode }) => (
  <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-muted">
    <div>{left}</div>
    <div className="flex gap-2"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={onSave} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : label}</button></div>
  </div>
);
const digits = (v: string) => v.replace(/[^\d-]/g, '');

// ------------------------------------------------------------ cash balances
export function CashCheckModal({ money, onClose }: { money: MoneyData; onClose: () => void }) {
  const last = latestCash(money.checks).list;
  const [day, setDay] = useState(kigaliToday());
  const [rows, setRows] = useState(() => [
    ...money.accounts.map((a) => { const prev = last.find((c) => c.account_key === a.key); return { key: a.key, label: `${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`, amount: prev ? String(prev.amount) : '', own: prev ? prev.is_own : !NOT_OWN_BY_DEFAULT.includes(a.key), hint: a.purpose, fixed: true }; }),
    ...last.filter((c) => c.account_key.startsWith('other:')).map((c) => ({ key: c.account_key, label: c.label, amount: String(c.amount), own: c.is_own, hint: null as string | null, fixed: true })),
  ]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    const filled = rows.filter((r) => r.amount.trim() !== '' && r.label.trim());
    if (!filled.length) { setError('Enter at least one balance.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.from('company_cash_checks').insert(filled.map((r) => ({
      checked_on: day, account_key: r.fixed ? r.key : `other:${r.label.trim().toLowerCase()}`, label: r.label.trim(), amount: Number(r.amount), is_own: r.own, note: note.trim() || null,
    })));
    setBusy(false);
    if (err) { setError(err.message); return; }
    money.reload(); onClose();
  };
  const own = rows.filter((r) => r.own).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return (
    <Modal open onClose={onClose} title="Record cash balances" subtitle="What is in each account today, from the bank and MoMo statements. Only Kivu Ride's own money counts for the runway." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block w-48"><span className={lbl}>Balances on</span><input type="date" value={day} max={kigaliToday()} onChange={(e) => setDay(e.target.value)} className="input" /></label>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="rounded-md border border-line-muted p-2">
              <div className="flex flex-wrap items-center gap-2">
                {r.fixed ? <span className="flex-1 min-w-[200px] text-small font-medium">{r.label}</span>
                  : <input value={r.label} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} className="input !py-1 text-small flex-1 min-w-[200px]" placeholder="e.g. Petty cash" />}
                <input value={r.amount} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, amount: digits(e.target.value) } : y)))} className="input !py-1 text-small !w-40 text-right" placeholder="RWF" inputMode="numeric" aria-label={`Balance of ${r.label}`} />
                <label className="flex items-center gap-1.5 text-caption"><input type="checkbox" checked={r.own} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, own: e.target.checked } : y)))} /> Kivu Ride's own</label>
              </div>
              {r.hint && <p className="text-micro text-fg-subtle mt-1">{r.hint}</p>}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((x) => [...x, { key: `new-${x.length}`, label: '', amount: '', own: true, hint: null, fixed: false }])} className="btn-ghost text-caption"><Plus size={13} /> Another account or cash box</button>
        <label className="block"><span className={lbl}>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="e.g. from statements of 17 Oct" /></label>
        <p className="text-small text-right">Kivu Ride's own money: <b>{rwf(own)}</b></p>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Save balances" onSave={save} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ settings
export function MoneySettingsModal({ money, onClose }: { money: MoneyData; onClose: () => void }) {
  const s = money.settings!;
  const [f, setF] = useState({ monthly_costs: String(s.monthly_costs), commission_pct: String(s.commission_pct), notes: s.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = await supabase.from('company_money_settings').update({ monthly_costs: Number(f.monthly_costs) || 0, commission_pct: Number(f.commission_pct) || 0, notes: f.notes.trim() || null, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }).eq('id', 1);
    setBusy(false);
    if (err) { setError(err.message); return; }
    money.reload(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Running costs" subtitle="What it costs to run Kivu Ride every month: salaries, rent, hosting, utilities, marketing…" maxWidth="max-w-md">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Monthly running costs (RWF)</span><input value={f.monthly_costs} onChange={(e) => setF({ ...f, monthly_costs: digits(e.target.value) })} className="input" inputMode="numeric" /><span className="text-micro text-fg-subtle">Started at 3,000,000 (your figure from August). Approved budgets are shown next to it for comparison.</span></label>
        <label className="block"><span className={lbl}>App commission (%)</span><input value={f.commission_pct} onChange={(e) => setF({ ...f, commission_pct: e.target.value })} className="input" inputMode="decimal" /></label>
        <label className="block"><span className={lbl}>What's included</span><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} className="input resize-none" placeholder="Salaries …, rent …, hosting 461,000, utilities 100,000…" /></label>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Save" onSave={save} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ funding
export function FundingModal({ money, plan, funding, onClose }: { money: MoneyData; plan: PlanData; funding: Funding | null; onClose: () => void }) {
  const existing = funding ? money.uses.filter((u) => u.funding_id === funding.id) : [];
  const [f, setF] = useState({
    name: funding?.name ?? '', kind: funding?.kind ?? 'equity' as FundingKind, counterparty: funding?.counterparty ?? '', amount: funding?.amount === null || funding?.amount === undefined ? '' : String(funding.amount),
    status: funding?.status ?? 'pending' as FundingStatus, probability: funding?.probability === null || funding?.probability === undefined ? '' : String(funding.probability),
    expected_date: funding?.expected_date ?? '', received_amount: String(funding?.received_amount ?? 0), received_date: funding?.received_date ?? '', cash_to_company: funding?.cash_to_company ?? true,
    terms: funding?.terms ?? '', next_step: funding?.next_step ?? '', owner_id: funding?.owner_id ?? '',
  });
  const [uses, setUses] = useState(existing.map((u) => ({ id: u.id as string | undefined, description: u.description, amount: String(u.amount), budget_id: u.budget_id ?? '' })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!f.name.trim()) { setError('Name the source.'); return; }
    setBusy(true); setError('');
    const payload = {
      name: f.name.trim(), kind: f.kind, counterparty: f.counterparty.trim() || null, amount: f.amount.trim() ? Number(f.amount) : null, status: f.status,
      probability: f.status === 'agreed' || f.status === 'received' ? 100 : f.status === 'lost' ? 0 : f.probability.trim() ? Math.max(0, Math.min(100, Number(f.probability))) : null,
      expected_date: f.expected_date || null, received_amount: Number(f.received_amount) || 0, received_date: f.received_date || null, cash_to_company: f.cash_to_company,
      terms: f.terms.trim() || null, next_step: f.next_step.trim() || null, owner_id: f.owner_id || null, updated_at: new Date().toISOString(),
    };
    const res = funding ? await supabase.from('company_funding').update(payload).eq('id', funding.id).select('id').single() : await supabase.from('company_funding').insert({ ...payload, sort: money.funding.length + 1 }).select('id').single();
    if (res.error) { setBusy(false); setError(res.error.message); return; }
    const id = res.data.id as string;
    const keep = uses.filter((u) => u.id).map((u) => u.id!);
    const gone = existing.filter((u) => !keep.includes(u.id)).map((u) => u.id);
    if (gone.length) await supabase.from('company_funding_uses').delete().in('id', gone);
    for (const [i, u] of uses.entries()) {
      if (!u.description.trim()) continue;
      const row = { funding_id: id, description: u.description.trim(), amount: Number(u.amount) || 0, budget_id: u.budget_id || null, sort: i };
      const r = u.id ? await supabase.from('company_funding_uses').update(row).eq('id', u.id) : await supabase.from('company_funding_uses').insert(row);
      if (r.error) { setBusy(false); setError(r.error.message); return; }
    }
    setBusy(false); money.reload(); onClose();
  };
  const remove = async () => { if (!funding || !confirm(`Delete "${funding.name}"?`)) return; await supabase.from('company_funding').delete().eq('id', funding.id); money.reload(); onClose(); };
  const usesTotal = uses.reduce((s, u) => s + (Number(u.amount) || 0), 0);
  return (
    <Modal open onClose={onClose} title={funding ? `F${funding.number} · ${funding.name}` : 'New funding source'} subtitle="Where money could come from, how sure it is, when, and what it pays for." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Name *</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="input" autoFocus /></label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="block"><span className={lbl}>Type</span><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as FundingKind })} className="input">{(Object.keys(FUNDING_KIND) as FundingKind[]).map((k) => <option key={k} value={k}>{FUNDING_KIND[k]}</option>)}</select></label>
          <label className="block"><span className={lbl}>From (optional)</span><input value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} className="input" /></label>
          <label className="block"><span className={lbl}>Amount (RWF)</span><input value={f.amount} onChange={(e) => setF({ ...f, amount: digits(e.target.value) })} className="input" inputMode="numeric" placeholder="unknown" /></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as FundingStatus })} className="input">{(Object.keys(FUNDING_STATUS) as FundingStatus[]).map((s) => <option key={s} value={s}>{FUNDING_STATUS[s].label}</option>)}</select></label>
          {(f.status === 'pending' || f.status === 'idea') && <label className="block"><span className={lbl}>How likely (%)</span><input value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value.replace(/[^\d]/g, '') })} className="input" inputMode="numeric" placeholder="e.g. 30" /></label>}
          <label className="block"><span className={lbl}>Expected on</span><input type="date" value={f.expected_date} onChange={(e) => setF({ ...f, expected_date: e.target.value })} className="input" /></label>
          {(f.status === 'received' || f.status === 'agreed') && <>
            <label className="block"><span className={lbl}>Received so far</span><input value={f.received_amount} onChange={(e) => setF({ ...f, received_amount: digits(e.target.value) })} className="input" inputMode="numeric" /></label>
            <label className="block"><span className={lbl}>Received on</span><input type="date" value={f.received_date} onChange={(e) => setF({ ...f, received_date: e.target.value })} className="input" /></label>
          </>}
          <label className="block"><span className={lbl}>Who follows it</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} className="input"><option value="">—</option>{plan.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        </div>
        <label className="flex items-start gap-2 text-small"><input type="checkbox" checked={f.cash_to_company} onChange={(e) => setF({ ...f, cash_to_company: e.target.checked })} className="mt-0.5" /><span>The money comes into Kivu Ride's own accounts <span className="text-caption text-fg-muted">(untick when it goes straight to a supplier or a project — it then doesn't extend the runway)</span></span></label>
        <label className="block"><span className={lbl}>Terms</span><textarea value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} rows={3} className="input resize-none" /></label>
        <label className="block"><span className={lbl}>Next step</span><input value={f.next_step} onChange={(e) => setF({ ...f, next_step: e.target.value })} className="input" /></label>
        <div>
          <span className={lbl}>What it pays for</span>
          <div className="space-y-1.5">
            {uses.map((u, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input value={u.description} onChange={(e) => setUses((x) => x.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} className="input !py-1 text-small flex-1 min-w-[180px]" placeholder="e.g. Marketing for the launch" />
                <input value={u.amount} onChange={(e) => setUses((x) => x.map((y, j) => (j === i ? { ...y, amount: digits(e.target.value) } : y)))} className="input !py-1 text-small !w-32 text-right" placeholder="RWF" inputMode="numeric" />
                <select value={u.budget_id} onChange={(e) => setUses((x) => x.map((y, j) => (j === i ? { ...y, budget_id: e.target.value } : y)))} className="input !py-1 text-small !w-48"><option value="">No budget</option>{plan.budgets.map((b) => <option key={b.id} value={b.id}>B{b.number} · {b.name}</option>)}</select>
                <button type="button" onClick={() => setUses((x) => x.filter((_, j) => j !== i))} className="btn-ghost p-1.5" aria-label="Remove"><X size={13} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setUses((x) => [...x, { id: undefined, description: '', amount: '', budget_id: '' }])} className="btn-ghost text-caption"><Plus size={13} /> Add a use</button>
            {uses.length > 0 && <p className="text-caption text-fg-muted">Uses: {rwf(usesTotal)}{f.amount ? ` of ${rwf(Number(f.amount))}` : ''}</p>}
          </div>
        </div>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={funding ? 'Save' : 'Add'} onSave={save} left={funding && <button onClick={remove} className="btn-ghost text-danger text-caption">Delete</button>} />
      </div>
    </Modal>
  );
}
