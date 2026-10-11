import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Popover';

// Kivu OS components: the pieces every page and object page is built from.

export type Tone = 'neutral' | 'accent' | 'success' | 'attention' | 'danger' | 'done' | 'info';
const TONE: Record<Tone, string> = {
  neutral: 'border-line text-fg-muted bg-inset',
  accent: 'border-accent/40 text-accent-fg bg-accent/10',
  success: 'border-success/40 text-success bg-success-muted',
  attention: 'border-attention/40 text-attention bg-attention-muted',
  danger: 'border-danger/40 text-danger bg-danger-muted',
  done: 'border-done/40 text-done bg-done-muted',
  info: 'border-link/40 text-link bg-link/10',
};

export function Label({ tone = 'neutral', icon: Icon, children, title }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; title?: string }) {
  return <span title={title} className={`label ${TONE[tone]}`}>{Icon && <Icon size={11} />}{children}</span>;
}

export function Counter({ n, tone }: { n: number; tone?: 'danger' | 'accent' }) {
  return <span className={`counter ${tone === 'danger' ? '!bg-danger-muted !text-danger' : tone === 'accent' ? '!bg-accent/15 !text-accent-fg' : ''}`}>{n}</span>;
}

// ---------------------------------------------------------------- page header
export function PageHeader({ icon: Icon, avatar, title, subtitle, labels, actions, meta }: {
  icon?: LucideIcon; avatar?: ReactNode; title: ReactNode; subtitle?: ReactNode; labels?: ReactNode; actions?: ReactNode; meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 mb-4">
      {avatar ?? (Icon && <span className="w-10 h-10 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0"><Icon size={19} className="text-fg-muted" /></span>)}
      <div className="flex-1 min-w-[200px]">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-h2 font-semibold leading-tight">{title}</h1>
          {labels}
        </div>
        {subtitle && <p className="text-body text-fg-muted mt-0.5">{subtitle}</p>}
        {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-caption text-fg-muted">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- underline tabs
export interface TabDef<K extends string> { key: K; label: string; icon?: LucideIcon; count?: number; tone?: 'danger' }
export function UnderlineTabs<K extends string>({ tabs, value, onChange, right }: { tabs: TabDef<K>[]; value: K; onChange: (k: K) => void; right?: ReactNode }) {
  return (
    <div className="flex items-end gap-1 border-b border-line-muted mb-4 overflow-x-auto" role="tablist">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button key={t.key} role="tab" aria-selected={active} onClick={() => onChange(t.key)}
            className={`relative flex items-center gap-1.5 px-3 h-10 text-body whitespace-nowrap rounded-t-md ${active ? 'text-fg font-semibold' : 'text-fg-muted hover:text-fg hover:bg-hover'}`}>
            {t.icon && <t.icon size={15} className={active ? 'text-fg' : 'text-fg-subtle'} />}{t.label}
            {t.count !== undefined && t.count > 0 && <Counter n={t.count} tone={t.tone} />}
            {active && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-accent" />}
          </button>
        );
      })}
      {right && <div className="ml-auto pb-1.5">{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- stat card
export function StatCard({ label, value, sub, delta, spark, tone, to, icon: Icon, onClick }: {
  label: string; value: ReactNode; sub?: ReactNode; delta?: { text: string; good: boolean | null }; spark?: number[]; tone?: 'danger' | 'success' | 'attention';
  to?: string; icon?: LucideIcon; onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-caption text-fg-muted">{Icon && <Icon size={13} />}<span className="truncate">{label}</span></div>
      <div className="flex items-end justify-between gap-2 mt-1">
        <p className={`text-h2 font-semibold leading-none tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : tone === 'attention' ? 'text-attention' : ''}`}>{value}</p>
        {spark && spark.length > 1 && <Spark values={spark} tone={tone} />}
      </div>
      {(sub || delta) && (
        <p className="text-caption text-fg-muted mt-1.5 truncate">
          {delta && <span className={`mr-1.5 font-medium ${delta.good === null ? '' : delta.good ? 'text-success' : 'text-danger'}`}>{delta.text}</span>}{sub}
        </p>
      )}
    </>
  );
  const cls = 'card p-3.5 block min-w-0 text-left transition-colors';
  if (to) return <Link to={to} className={`${cls} hover:border-line-strong hover:bg-hover/40`}>{body}</Link>;
  if (onClick) return <button onClick={onClick} className={`${cls} hover:border-line-strong hover:bg-hover/40 w-full`}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

export function Spark({ values, tone, w = 72, h = 26 }: { values: number[]; tone?: string; w?: number; h?: number }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const bw = Math.max(2, Math.floor((w - (values.length - 1) * 2) / values.length));
  const color = tone === 'danger' ? 'rgb(var(--c-danger))' : tone === 'success' ? 'rgb(var(--c-success))' : 'rgb(var(--c-accent))';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      {values.map((v, i) => {
        const bh = Math.max(v ? 2 : 1, (Math.abs(v) / max) * h);
        return <rect key={i} x={i * (bw + 2)} y={h - bh} width={bw} height={bh} rx={1.5} fill={i === values.length - 1 ? color : 'rgb(var(--c-line-strong))'} opacity={i === values.length - 1 ? 1 : 0.7} />;
      })}
    </svg>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const c = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[cols];
  return <div className={`grid grid-cols-2 ${c} gap-3 mb-4`}>{children}</div>;
}

// ---------------------------------------------------------------- box
export function Box({ title, icon: Icon, right, children, padded = true, className = '' }: { title?: ReactNode; icon?: LucideIcon; right?: ReactNode; children: ReactNode; padded?: boolean; className?: string }) {
  return (
    <section className={`card min-w-0 ${className}`}>
      {(title || right) && (
        <header className="flex items-center gap-2 px-4 h-11 border-b border-line-muted">
          {Icon && <Icon size={15} className="text-fg-muted" />}
          <h2 className="text-body font-semibold flex-1 truncate">{title}</h2>
          {right}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- details sidebar
export function Details({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line-muted">
      {items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '').map((i) => (
        <div key={i.label} className="py-2.5 first:pt-0">
          <dt className="text-caption font-semibold text-fg-muted mb-0.5">{i.label}</dt>
          <dd className="text-body text-fg">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Object page layout: main column + details sidebar (stacks on phones).
export function ObjectLayout({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-5">
      <div className="min-w-0 space-y-4">{main}</div>
      <aside className="min-w-0">{side}</aside>
    </div>
  );
}

// ---------------------------------------------------------------- timeline
export interface TimelineItem { id: string; at: string; icon?: LucideIcon; tone?: Tone; title: ReactNode; body?: ReactNode }
export function Timeline({ items, empty = 'Nothing has happened yet.' }: { items: TimelineItem[]; empty?: string }) {
  if (!items.length) return <p className="text-body text-fg-muted py-4">{empty}</p>;
  const dot: Record<Tone, string> = { neutral: 'bg-inset text-fg-muted', accent: 'bg-accent/15 text-accent-fg', success: 'bg-success-muted text-success', attention: 'bg-attention-muted text-attention', danger: 'bg-danger-muted text-danger', done: 'bg-done-muted text-done', info: 'bg-link/10 text-link' };
  return (
    <ol className="relative ml-3 border-l-2 border-line-muted">
      {items.map((i) => (
        <li key={i.id} className="relative pl-6 pb-4 last:pb-0">
          <span className={`absolute -left-[13px] top-0 w-6 h-6 rounded-full flex items-center justify-center ring-4 ring-canvas ${dot[i.tone ?? 'neutral']}`}>
            {i.icon ? <i.icon size={12} /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
          </span>
          <div className="text-body"><span className="text-fg">{i.title}</span> <span className="text-caption text-fg-subtle whitespace-nowrap">· {fmtWhen(i.at)}</span></div>
          {i.body && <div className="mt-1 text-body text-fg-muted">{i.body}</div>}
        </li>
      ))}
    </ol>
  );
}

export function fmtWhen(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (iso.length === 10) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
  if (days < 1 && d.toDateString() === new Date().toDateString()) return `today ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------- activity heatmap (GitHub-style)
export interface HeatCell { day: string; state: string; title: string }
export function Heatmap({ cells, legend, weeks = 13, onCell }: { cells: HeatCell[]; legend: { state: string; label: string; color: string }[]; weeks?: number; onCell?: (c: HeatCell) => void }) {
  const [hover, setHover] = useState<HeatCell | null>(null);
  const color = Object.fromEntries(legend.map((l) => [l.state, l.color]));
  const shown = cells.slice(-weeks * 7);
  const first = shown[0]?.day;
  const lead = first ? (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const grid: (HeatCell | null)[] = [...Array(lead).fill(null), ...shown];
  return (
    <div>
      <div className="flex gap-2">
        <div className="grid grid-rows-7 gap-[3px] text-micro text-fg-subtle pr-1">
          {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((d, i) => <span key={i} className="h-[13px] leading-[13px]">{d}</span>)}
        </div>
        <div className="grid grid-rows-7 grid-flow-col gap-[3px] overflow-x-auto" onMouseLeave={() => setHover(null)}>
          {grid.map((c, i) => c ? (
            <button key={c.day} onMouseEnter={() => setHover(c)} onFocus={() => setHover(c)} onClick={onCell ? () => onCell(c) : undefined} aria-label={c.title}
              className={`w-[13px] h-[13px] rounded-[3px] ${hover?.day === c.day ? 'ring-2 ring-fg' : ''}`} style={{ background: color[c.state] ?? 'rgb(var(--c-line-muted))' }} />
          ) : <span key={`x${i}`} className="w-[13px] h-[13px]" />)}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <p className="text-caption text-fg-muted min-h-[16px]">{hover ? hover.title : 'Hover a day for details'}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {legend.map((l) => <span key={l.state} className="flex items-center gap-1 text-caption text-fg-muted"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: l.color }} />{l.label}</span>)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- empty state
export function EmptyState({ icon: Icon, title, body, action }: { icon?: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      {Icon && <Icon size={26} className="mx-auto text-fg-subtle mb-2" />}
      <p className="text-ui font-semibold">{title}</p>
      {body && <p className="text-body text-fg-muted mt-1 max-w-sm mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return <Tooltip label={text}><span tabIndex={0} className="inline-flex w-4 h-4 rounded-full border border-line text-micro text-fg-subtle items-center justify-center cursor-help">?</span></Tooltip>;
}

export const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
export const rwfShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(Math.abs(n) % 1e6 ? 1 : 0)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
