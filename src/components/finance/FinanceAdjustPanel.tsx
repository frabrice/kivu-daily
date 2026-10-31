import { ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Loader2, Search, SlidersHorizontal, UserRound, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Modal from '../Modal';
import AdjustBalanceModal from '../fleet/AdjustBalanceModal';
import { supabase, Driver, DriverDeposit, FinanceAccount, FinanceAdjustment, FinanceTransaction, Vehicle, VehicleOwner } from '../../lib/supabase';
import { ADJ_TARGET, ownerOwed } from '../../lib/finance';
import { computeDepositStanding } from '../../lib/fleet';
import { kigaliToday } from '../../lib/kigali';
import { EntityLink } from '../../os/EntityLink';
import { UnderlineTabs, rwf } from '../../ui/kit';

// Finance's hidden "Adjust" (migration 20261101150000): set a main number
// to what it really is, with a reason. Bank balances get a posted
// "Adjustment" row in the ledger; what we owe an owner gets an adjustment
// entry; a driver's "owes" uses the driver Adjust. All of them are listed
// in Ledger > Adjustments with the number before and after, who and when.

type Tab = 'accounts' | 'owners' | 'drivers' | 'history';
export interface AdjustData {
  accounts: FinanceAccount[]; balances: Record<string, number>; transactions: FinanceTransaction[]; adjustments: FinanceAdjustment[];
  owners: VehicleOwner[]; vehicles: Vehicle[]; drivers: Driver[]; deposits: DriverDeposit[];
}

const num = (v: string) => Number(v.replace(/[^\d]/g, ''));

export default function FinanceAdjustPanel({ data, onClose, onSaved }: { data: AdjustData; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>('accounts');
  const [q, setQ] = useState('');
  const [driver, setDriver] = useState<Driver | null>(null);

  const owners = useMemo(() => data.owners
    .filter((o) => data.vehicles.some((v) => v.owner_id === o.id) || data.adjustments.some((a) => a.owner_id === o.id))
    .map((o) => ({ owner: o, ...ownerOwed(o.id, data.vehicles, data.transactions, data.adjustments) }))
    .sort((a, b) => b.owed - a.owed || a.owner.full_name.localeCompare(b.owner.full_name)), [data]);

  const depositsOf = useMemo(() => {
    const m = new Map<string, DriverDeposit[]>();
    for (const x of data.deposits) { const l = m.get(x.driver_id); if (l) l.push(x); else m.set(x.driver_id, [x]); }
    return m;
  }, [data.deposits]);
  const drivers = useMemo(() => data.drivers
    .filter((d) => d.contract_status === 'active' && d.start_date)
    .map((d) => ({ driver: d, owes: computeDepositStanding(d, depositsOf.get(d.id) ?? []).owes }))
    .sort((a, b) => b.owes - a.owes || a.driver.full_name.localeCompare(b.driver.full_name)), [data.drivers, depositsOf]);

  const inBanks = data.accounts.reduce((s, a) => s + (data.balances[a.key] ?? 0), 0);
  const toOwners = owners.reduce((s, o) => s + o.owed, 0);
  const byDrivers = drivers.reduce((s, d) => s + d.owes, 0);
  const term = q.trim().toLowerCase();
  const match = (name: string) => !term || name.toLowerCase().includes(term);

  return (
    <Modal open onClose={onClose} title="Adjust Finance's numbers" subtitle="Set a number to what it really is. Each change is recorded with the number before and after, your name, the date and the reason." maxWidth="max-w-3xl">
      <div className="space-y-3 text-small">
        <div className="grid grid-cols-3 gap-2">
          {([['In the banks', inBanks, 'accounts'], ['We owe owners', toOwners, 'owners'], ['Drivers owe us', byDrivers, 'drivers']] as [string, number, Tab][]).map(([l, v, k]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg p-2 text-center border ${tab === k ? 'border-brand bg-brand/5' : 'border-transparent bg-inset'}`}>
              <p className="text-micro text-fg-muted">{l}</p><p className="font-semibold tabular-nums">{rwf(v)}</p>
            </button>
          ))}
        </div>
        <UnderlineTabs value={tab} onChange={(t: Tab) => { setTab(t); setQ(''); }} tabs={[
          { key: 'accounts', label: 'Bank balances' }, { key: 'owners', label: 'Owed to owners' },
          { key: 'drivers', label: 'Owed by drivers' }, { key: 'history', label: 'History', count: data.adjustments.length },
        ]} />

        {(tab === 'owners' || tab === 'drivers') && (
          <div className="relative max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name" className="input pl-8 py-1 text-small" />
          </div>
        )}

        {tab === 'accounts' && (
          <ul className="divide-y divide-line-muted border border-line-muted rounded-lg">
            {data.accounts.map((a) => (
              <AdjustRow key={a.id} icon={Landmark} title={a.name} sub={a.bank_name ?? ''} label="Balance" now={data.balances[a.key] ?? 0}
                note="Recorded as an Adjustment row in this account's ledger and statement. It is not income or a cost." target="account" id={a.id} onSaved={onSaved} />
            ))}
          </ul>
        )}

        {tab === 'owners' && (
          <ul className="divide-y divide-line-muted border border-line-muted rounded-lg">
            {owners.filter((o) => match(o.owner.full_name)).map((o) => (
              <AdjustRow key={o.owner.id} icon={UserRound} title={<EntityLink type="owner" id={o.owner.id} label={o.owner.full_name} />} label="Owed"
                sub={`${rwf(o.unpaid)} in unpaid weekly payouts${o.adjusted ? ` · adjusted ${o.adjusted > 0 ? '+' : '−'}${rwf(Math.abs(o.adjusted))}` : ''}${o.byHand ? ` · ${rwf(o.byHand)} paid by hand` : ''}`}
                now={o.owed} note="No bank changes: only what we owe this owner. Paying it later is logged as an owner payment." target="owner" id={o.owner.id} onSaved={onSaved} />
            ))}
            {owners.length === 0 && <li className="p-6 text-center text-fg-muted">No owners with cars.</li>}
          </ul>
        )}

        {tab === 'drivers' && (
          <ul className="divide-y divide-line-muted border border-line-muted rounded-lg max-h-[420px] overflow-y-auto">
            {drivers.filter((d) => match(d.driver.full_name)).map((d) => (
              <li key={d.driver.id} className="flex items-center gap-3 px-3 py-2">
                <Wallet size={14} className="text-fg-subtle shrink-0" />
                <span className="flex-1 min-w-0 truncate"><EntityLink type="driver" id={d.driver.id} label={d.driver.full_name.trim()} /></span>
                <span className={`tabular-nums font-medium ${d.owes ? 'text-danger' : 'text-fg-muted'}`}>{rwf(d.owes)}</span>
                <button onClick={() => setDriver(d.driver)} className="btn-secondary h-7 text-small">Adjust</button>
              </li>
            ))}
            {drivers.length === 0 && <li className="p-6 text-center text-fg-muted">No drivers on contract.</li>}
          </ul>
        )}

        {tab === 'history' && (
          <div className="space-y-2">
            <ul className="divide-y divide-line-muted border border-line-muted rounded-lg max-h-[420px] overflow-y-auto">
              {data.adjustments.slice(0, 50).map((a) => (
                <li key={a.id} className="px-3 py-2">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-caption text-fg-muted">{ADJ_TARGET[a.target]}</span>
                    <span className="font-medium">{a.label}</span>
                    <span className="tabular-nums">{rwf(a.from_amount)} → <b>{rwf(a.to_amount)}</b></span>
                    <span className="ml-auto text-caption text-fg-muted">{a.by_name ?? '—'} · {new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' })}</span>
                  </p>
                  <p className="text-caption text-fg-muted">{a.reason}{a.note ? ` · ${a.note}` : ''}</p>
                </li>
              ))}
              {data.adjustments.length === 0 && <li className="p-6 text-center text-fg-muted">Nothing adjusted yet.</li>}
            </ul>
            {data.adjustments.length > 0 && <Link to="/finance/ledger?view=adjustments" onClick={onClose} className="link text-caption">All adjustments in the Ledger</Link>}
          </div>
        )}
      </div>

      {driver && <AdjustBalanceModal driver={driver} deposits={depositsOf.get(driver.id) ?? []} onClose={() => setDriver(null)} onSaved={onSaved} />}
    </Modal>
  );
}

function AdjustRow({ icon: Icon, title, sub, label, now, note, target, id, onSaved }: {
  icon: LucideIcon; title: ReactNode; sub: string; label: string; now: number; note: string; target: 'account' | 'owner'; id: string; onSaved: () => void;
}) {
  const today = kigaliToday();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = num(to);
  const change = to.trim() === '' ? 0 : n - Math.round(now);
  const save = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('finance_adjust', { p_target: target, p_id: id, p_from: now, p_to: n, p_reason: reason, p_date: date });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOpen(false); setTo(''); setReason(''); setDate(today);
    onSaved();
  };
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-3">
        <Icon size={14} className="text-fg-subtle shrink-0" />
        <span className="flex-1 min-w-0"><span className="block font-medium truncate">{title}</span>{sub && <span className="block text-caption text-fg-muted truncate">{sub}</span>}</span>
        <span className="text-right"><span className="block text-micro text-fg-muted">{label} now</span><span className="tabular-nums font-semibold">{rwf(now)}</span></span>
        <button onClick={() => setOpen((o) => !o)} className="btn-secondary h-7 text-small">{open ? 'Close' : 'Adjust'}</button>
      </div>
      {open && (
        <div className="mt-2 rounded-lg bg-inset p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="block"><span className="text-caption font-semibold text-fg-muted">{label} should be (RWF)</span>
              <input className="input w-full mt-1" inputMode="numeric" value={to} autoFocus onChange={(e) => setTo(e.target.value)} placeholder={String(Math.round(now))} /></label>
            {target === 'account' && <label className="block"><span className="text-caption font-semibold text-fg-muted">Date in the ledger</span>
              <input type="date" className="input w-full mt-1" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>}
          </div>
          <label className="block"><span className="text-caption font-semibold text-fg-muted">Reason (required)</span>
            <textarea className="input w-full mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={target === 'account' ? 'e.g. Bank statement of 31 Oct shows 1,250,000: bank charges not logged' : 'e.g. Week of 20 Oct paid in cash on 22 Oct, not logged'} /></label>
          {change !== 0 && (
            <p className="flex items-start gap-1.5"><SlidersHorizontal size={13} className="mt-0.5 shrink-0" />
              <span>{rwf(now)} → <b>{rwf(n)}</b> ({change > 0 ? '+' : '−'}{rwf(Math.abs(change))}). <span className="text-fg-muted">{note}</span></span></p>
          )}
          {err && <p className="text-danger">{err}</p>}
          <div className="flex justify-end">
            <button className="btn-primary" disabled={busy || to.trim() === '' || change === 0 || reason.trim().length < 5} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Record the adjustment</button>
          </div>
        </div>
      )}
    </li>
  );
}
