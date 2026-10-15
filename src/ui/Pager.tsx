import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Pagination for every list in Kivu OS: usePaged() slices the rows, <Pager>
// shows "1–25 of 312", page numbers and the page size (25 / 50 / 100,
// remembered per list when given a key). Filters that change the number of
// rows send the list back to page 1.

const SIZES = [25, 50, 100];
const read = (key?: string) => {
  if (!key) return null;
  try { const n = Number(localStorage.getItem(`kivu-page-size:${key}`)); return SIZES.includes(n) ? n : null; } catch { return null; }
};
const write = (key: string | undefined, n: number) => {
  if (!key) return;
  try { localStorage.setItem(`kivu-page-size:${key}`, String(n)); } catch { /* private mode */ }
};

export interface PagerState { page: number; pages: number; size: number; total: number; setPage: (p: number) => void; setSize: (n: number) => void }

export function usePaged<T>(rows: T[], opts: { size?: number; key?: string; reset?: unknown } = {}): { rows: T[]; pager: PagerState } {
  const [size, setSizeState] = useState(() => read(opts.key) ?? opts.size ?? 25);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => { setPage(1); }, [rows.length, opts.reset]);
  const current = Math.min(page, pages);
  const slice = useMemo(() => rows.slice((current - 1) * size, current * size), [rows, current, size]);
  const setSize = (n: number) => { setSizeState(n); setPage(1); write(opts.key, n); };
  return { rows: slice, pager: { page: current, pages, size, total: rows.length, setPage, setSize } };
}

// Page numbers to show: 1 … 4 5 6 … 20
function pageWindow(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const from = Math.max(2, page - 1), to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

export function Pager({ pager, className = '', noun = 'rows' }: { pager: PagerState; className?: string; noun?: string }) {
  const { page, pages, size, total, setPage, setSize } = pager;
  if (total <= SIZES[0]) return null;
  const from = (page - 1) * size + 1, to = Math.min(total, page * size);
  const go = (p: number) => setPage(Math.min(pages, Math.max(1, p)));
  const btn = 'min-w-[30px] h-[30px] px-1.5 rounded-md text-small tabular-nums flex items-center justify-center';
  return (
    <nav className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-1 py-2.5 text-caption text-fg-muted ${className}`} aria-label="Pages">
      <span className="tabular-nums">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {noun}</span>
      <div className="flex items-center gap-0.5 sm:ml-auto">
        <button onClick={() => go(page - 1)} disabled={page === 1} className={`${btn} hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent`} aria-label="Previous page"><ChevronLeft size={15} /></button>
        {pageWindow(page, pages).map((p, i) => p === '…'
          ? <span key={`e${i}`} className="px-1">…</span>
          : <button key={p} onClick={() => go(p)} aria-current={p === page ? 'page' : undefined}
              className={`${btn} ${p === page ? 'bg-accent/15 text-accent-fg font-semibold' : 'hover:bg-hover'}`}>{p}</button>)}
        <button onClick={() => go(page + 1)} disabled={page === pages} className={`${btn} hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent`} aria-label="Next page"><ChevronRight size={15} /></button>
      </div>
      <label className="flex items-center gap-1.5">
        <span>Show</span>
        <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="input !w-auto !py-1 !pl-2 !pr-7 text-caption">
          {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </nav>
  );
}
