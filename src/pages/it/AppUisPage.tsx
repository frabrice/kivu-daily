import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, ExternalLink, Home, Link2, Maximize2, Moon, MonitorSmartphone, MousePointerClick, RotateCcw, Sun, X,
} from 'lucide-react';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader } from '../../ui/kit';

// IT & Product → App UIs. The Kivu Ride + Kivu Explore designs, exported from
// the design canvas into public/ui-screens/ and played live inside a phone.
// Each screen is a small standalone page (player.js runs its taps and states);
// this page owns navigation, swipe-back, the phone frame and present mode.

interface Screen { id: string; code: string; title: string; section: string; h: number; interactive: boolean; links: string[] }
interface Section { id: string; title: string; subtitle: string; screens: string[]; notes: string[] }
interface Manifest { version: string; source: string; sections: Section[]; screens: Screen[] }

const BASE = `${import.meta.env.BASE_URL}ui-screens/`;
const MSG = 'kd-app-ui';
const SCREEN_W = 390;
const SCREEN_H = 844;
const STATUS_H = 47;
const BEZEL = 12;
const PHONE_W = SCREEN_W + BEZEL * 2;
const PHONE_H = SCREEN_H + STATUS_H + BEZEL * 2;

function useManifest() {
  const [m, setM] = useState<Manifest | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch(`${BASE}manifest.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject())).then(setM).catch(() => setErr(true));
  }, []);
  return { m, err };
}

// Is a CSS rgb() colour dark? Decides white or black status-bar icons.
function isDark(c: string) {
  const n = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
  return 0.299 * n[0] + 0.587 * n[1] + 0.114 * n[2] < 150;
}

// ------------------------------------------------------------------ phone
function StatusBar({ color }: { color: string }) {
  const fg = isDark(color) ? '#fff' : '#0B0F14';
  return (
    <div className="absolute inset-x-0 top-0 flex items-center justify-between px-8 select-none" style={{ height: STATUS_H, background: color, color: fg, transition: 'background-color .2s' }}>
      <span style={{ font: '600 16px/1 -apple-system, "SF Pro Text", Inter, sans-serif', letterSpacing: '-0.2px' }}>9:41</span>
      <span className="flex items-center gap-[6px]" aria-hidden>
        <svg width="18" height="12" viewBox="0 0 18 12" fill={fg}><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill={fg}><path d="M8 2.6c2.2 0 4.2.85 5.7 2.25l1.1-1.15A9.6 9.6 0 0 0 8 1 9.6 9.6 0 0 0 1.2 3.7l1.1 1.15A8 8 0 0 1 8 2.6zm0 3.2c1.35 0 2.6.5 3.55 1.35l1.1-1.15A6.7 6.7 0 0 0 8 4.2c-1.8 0-3.45.7-4.65 1.8l1.1 1.15A5.1 5.1 0 0 1 8 5.8zm0 3.2c.55 0 1.05.2 1.45.5L8 11 6.55 9.5c.4-.3.9-.5 1.45-.5z" /></svg>
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x="0.5" y="0.5" width="23" height="12" rx="3.8" stroke={fg} opacity=".4" /><rect x="2" y="2" width="18" height="9" rx="2.5" fill={fg} /><path d="M25 4.5v4a2 2 0 0 0 0-4z" fill={fg} opacity=".45" /></svg>
      </span>
    </div>
  );
}

function Phone({ src, scale, top, drag, fading, iframeRef }: {
  src: string; scale: number; top: string; drag: number; fading: boolean; iframeRef: React.RefObject<HTMLIFrameElement>;
}) {
  return (
    <div style={{ width: PHONE_W * scale, height: PHONE_H * scale }} className="relative shrink-0">
      <div style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="absolute left-0 top-0">
        {/* side buttons */}
        <span className="absolute rounded-l-sm" style={{ left: -3, top: 150, width: 3, height: 30, background: '#1A1F26' }} />
        <span className="absolute rounded-l-sm" style={{ left: -3, top: 205, width: 3, height: 58, background: '#1A1F26' }} />
        <span className="absolute rounded-l-sm" style={{ left: -3, top: 275, width: 3, height: 58, background: '#1A1F26' }} />
        <span className="absolute rounded-r-sm" style={{ right: -3, top: 230, width: 3, height: 92, background: '#1A1F26' }} />
        {/* frame */}
        <div className="absolute inset-0" style={{ borderRadius: 64, background: 'linear-gradient(145deg,#2B3139,#0E1217 40%,#1B2027)', boxShadow: '0 0 0 1.5px #3A414B inset, 0 30px 60px -20px rgba(10,15,23,.55), 0 18px 36px -18px rgba(10,15,23,.45)' }} />
        <div className="absolute overflow-hidden bg-white" style={{ left: BEZEL, top: BEZEL, width: SCREEN_W, height: SCREEN_H + STATUS_H, borderRadius: 52 }}>
          <StatusBar color={top} />
          <div className="absolute inset-x-0 overflow-hidden" style={{ top: STATUS_H, height: SCREEN_H }}>
            <iframe
              ref={iframeRef}
              key={src}
              src={src}
              title="App screen"
              className="block border-0 bg-white"
              style={{ width: SCREEN_W, height: SCREEN_H, transform: `translateX(${drag}px)`, opacity: fading ? 0 : 1, transition: drag ? 'none' : 'transform .22s ease, opacity .14s ease' }}
            />
            {drag > 0 && <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: drag, background: 'linear-gradient(90deg,rgba(15,23,42,.18),rgba(15,23,42,0))' }} />}
          </div>
          {/* dynamic island + home indicator */}
          <span className="absolute left-1/2 -translate-x-1/2 rounded-full" style={{ top: 11, width: 122, height: 35, background: '#000' }} />
          <span className="absolute left-1/2 -translate-x-1/2 rounded-full pointer-events-none" style={{ bottom: 8, width: 134, height: 5, background: 'rgba(17,24,39,.82)', boxShadow: '0 0 0 1px rgba(255,255,255,.35)' }} />
        </div>
      </div>
    </div>
  );
}

// Fit the phone to the space it has (never larger than 1:1).
function useFitScale(ref: React.RefObject<HTMLElement>, padY: number, max = 1, active = true) {
  const [scale, setScale] = useState(0.7);
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !active) return;
    const fit = () => setScale(Math.max(0.4, Math.min(max, (el.clientHeight - padY) / PHONE_H, (el.clientWidth - 24) / PHONE_W)));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [ref, padY, max, active]);
  return scale;
}

// ------------------------------------------------------------------ page
export default function AppUisPage() {
  usePageTitle('App UIs');
  const { m, err } = useManifest();
  const [params, setParams] = useSearchParams();
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('appuis-backdrop') === 'dark'; } catch { return false; } });
  const [presenting, setPresenting] = useState(false);
  const [top, setTop] = useState('rgb(20, 35, 58)');
  const [drag, setDrag] = useState(0);
  const [fading, setFading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const history = useRef<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const presentRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(stageRef, 96, 1, !presenting);
  const presentScale = useFitScale(presentRef, 40, 1.15, presenting);

  const byId = useMemo(() => new Map((m?.screens ?? []).map((s) => [s.id, s])), [m]);
  const order = useMemo(() => (m?.sections ?? []).flatMap((s) => s.screens), [m]);
  const current = (params.get('s') && byId.get(params.get('s')!)) || (m ? byId.get(order[0]) : undefined);
  const section = m?.sections.find((s) => s.id === current?.section);
  const stepIdx = section && current ? section.screens.indexOf(current.id) : -1;

  useEffect(() => { try { localStorage.setItem('appuis-backdrop', dark ? 'dark' : 'light'); } catch { /* private mode */ } }, [dark]);

  const show = useCallback((id: string, mode: 'push' | 'back' | 'jump' = 'push') => {
    if (!byId.has(id) || id === current?.id) return;
    if (mode === 'push' && current) history.current.push(current.id);
    if (mode === 'jump') history.current = [];
    setFading(true);
    window.setTimeout(() => { setParams((p) => { const n = new URLSearchParams(p); n.set('s', id); return n; }, { replace: mode !== 'jump' }); setFading(false); }, 110);
  }, [byId, current, setParams]);

  const back = useCallback(() => {
    const prev = history.current.pop();
    setDrag(0);
    if (prev) show(prev, 'back');
  }, [show]);
  const step = useCallback((d: 1 | -1) => {
    if (!current) return;
    const i = order.indexOf(current.id) + d;
    if (i >= 0 && i < order.length) show(order[i], 'jump');
  }, [current, order, show]);
  const restart = () => { history.current = []; setReloadKey((k) => k + 1); };
  const goHome = () => section && show(section.screens[0], 'jump');

  // messages from the screen inside the phone
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.kind !== MSG || e.source !== iframeRef.current?.contentWindow) return;
      if (d.type === 'screen' && d.top) setTop(d.top);
      else if (d.type === 'go' && d.to) show(d.to);
      else if (d.type === 'back') back();
      else if (d.type === 'drag') setDrag(Math.min(220, d.dx * 0.7));
      else if (d.type === 'drag-end') setDrag(0);
      else if (d.type === 'key') onKey(d.key);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });

  const onKey = (key: string) => {
    if (key === 'ArrowRight') step(1);
    else if (key === 'ArrowLeft') step(-1);
    else if (key === 'Backspace') back();
    else if (key === 'Escape') setPresenting(false);
    else if (key === 'p' || key === 'P') setPresenting((v) => !v);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (['ArrowRight', 'ArrowLeft', 'Backspace', 'Escape'].includes(e.key) || ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); onKey(e.key); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  };

  if (err) return <EmptyState icon={MonitorSmartphone} title="The screens could not be loaded" body="public/ui-screens/manifest.json is missing from this build." />;
  if (!m || !current || !section) return <div className="h-[70vh] skeleton rounded-card" />;

  const src = `${BASE}${current.id}.html?v=${m.version}&r=${reloadKey}`;
  const phoneEl = (sc: number) => <Phone src={src} scale={sc} top={top} drag={drag} fading={fading} iframeRef={iframeRef} />;
  const stepLabel = `${stepIdx + 1} of ${section.screens.length}`;
  const tb = 'h-9 w-9 inline-flex items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-35 disabled:pointer-events-none';

  return (
    <div className="animate-fade-in">
      <PageHeader icon={MonitorSmartphone} title="App UIs"
        subtitle="The Kivu Ride and Kivu Explore designs, live in a phone. Tap through them like the real app; swipe from the left edge to go back."
        meta={<><span>{m.screens.length} screens · {m.sections.length} flows</span><span>Design reference for the December build</span></>}
        actions={<button className="btn-primary" onClick={() => setPresenting(true)}><Maximize2 size={14} /> Present</button>} />

      <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_300px] gap-4">
        {/* flows */}
        <Box padded={false} className="lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto">
          <nav aria-label="Flows" className="py-2">
            {m.sections.map((sec) => (
              <div key={sec.id} className="pb-2">
                <div className="px-4 pt-2 pb-1.5 flex items-baseline justify-between">
                  <span className="text-caption font-semibold text-fg">{sec.title}</span>
                  <span className="text-caption text-fg-subtle">{sec.screens.length}</span>
                </div>
                {sec.screens.map((id) => {
                  const s = byId.get(id)!; const on = id === current.id;
                  return (
                    <button key={id} onClick={() => show(id, 'jump')} aria-current={on ? 'page' : undefined}
                      className={`w-full text-left flex items-center gap-2.5 px-4 py-1.5 text-body ${on ? 'bg-accent-muted text-fg font-medium' : 'text-fg-muted hover:bg-hover hover:text-fg'}`}>
                      <span className={`w-8 shrink-0 font-mono text-caption ${on ? 'text-accent' : 'text-fg-subtle'}`}>{s.code}</span>
                      <span className="truncate">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </Box>

        {/* stage */}
        <section className={`relative rounded-card border border-line overflow-hidden flex flex-col ${dark ? 'bg-[#0D131C]' : 'bg-inset'}`} style={{ minHeight: 640, height: 'calc(100vh - 170px)' }}>
          <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center" style={{ backgroundImage: dark ? 'radial-gradient(circle at 50% 35%, rgba(81,122,79,.16), transparent 60%)' : 'radial-gradient(circle at 50% 35%, rgba(81,122,79,.10), transparent 60%)' }}>
            {!presenting && phoneEl(scale)}
          </div>
          <div className="flex justify-center pb-4">
            <div className={`inline-flex items-center gap-0.5 rounded-xl border px-1.5 py-1 shadow-raised ${dark ? 'bg-[#151C27] border-[#263042]' : 'bg-surface-2 border-line'}`}>
              <button className={tb} onClick={back} disabled={!history.current.length} title="Back (Backspace)" aria-label="Back"><ChevronLeft size={17} /></button>
              <button className={tb} onClick={goHome} title={`First screen of ${section.title}`} aria-label="First screen of this flow"><Home size={16} /></button>
              <button className={tb} onClick={restart} title="Restart this screen" aria-label="Restart this screen"><RotateCcw size={15} /></button>
              <span className="w-px h-5 bg-line mx-1" />
              <button className={tb} onClick={() => step(-1)} disabled={order.indexOf(current.id) === 0} title="Previous screen (Left arrow)" aria-label="Previous screen"><ChevronLeft size={17} /></button>
              <span className="text-caption text-fg-muted tabular-nums px-1.5 min-w-[64px] text-center">{stepLabel}</span>
              <button className={tb} onClick={() => step(1)} disabled={order.indexOf(current.id) === order.length - 1} title="Next screen (Right arrow)" aria-label="Next screen"><ChevronRight size={17} /></button>
              <span className="w-px h-5 bg-line mx-1" />
              <button className={tb} onClick={() => setDark((v) => !v)} title={dark ? 'Light backdrop' : 'Dark backdrop'} aria-label="Change backdrop">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
              <button className={tb} onClick={copyLink} title="Copy a link to this screen" aria-label="Copy link"><Link2 size={16} /></button>
              <button className={tb} onClick={() => setPresenting(true)} title="Present (P)" aria-label="Present"><Maximize2 size={15} /></button>
            </div>
          </div>
          {copied && <div className="absolute left-1/2 -translate-x-1/2 bottom-24 text-caption bg-fg text-canvas rounded-lg px-3 py-1.5">Link copied</div>}
        </section>

        {/* about this screen */}
        <div className="space-y-4 lg:col-span-2 xl:col-span-1 xl:max-h-[calc(100vh-170px)] xl:overflow-y-auto">
          <Box>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-caption text-fg-subtle">{current.code}</span>
              <Label>{section.title}</Label>
              {current.interactive && <Label tone="success" icon={MousePointerClick}>Tappable</Label>}
            </div>
            <h2 className="text-h3 font-semibold mt-2 leading-snug">{current.title}</h2>
            <p className="text-caption text-fg-muted mt-1">Screen {stepLabel} in {section.title}{current.h > SCREEN_H ? ' · long page, scroll inside the phone' : ''}</p>
            {current.links.length > 0 && <>
              <div className="text-caption font-semibold text-fg mt-4 mb-1.5">Goes to</div>
              <div className="flex flex-wrap gap-1.5">
                {current.links.map((id) => { const t = byId.get(id); return t && (
                  <button key={id} onClick={() => show(id)} className="text-caption rounded-md border border-line px-2 py-1 hover:bg-hover text-left">
                    <span className="font-mono text-fg-subtle mr-1">{t.code}</span>{t.title}
                  </button>
                ); })}
              </div>
            </>}
            <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-caption text-link mt-4 hover:underline"><ExternalLink size={12} /> Open this screen on its own</a>
          </Box>
          {section.notes.length > 0 && (
            <Box title={`About ${section.title}`}>
              <div className="space-y-4">
                {section.notes.map((n, i) => <p key={i} className="text-body text-fg-muted whitespace-pre-line leading-relaxed">{n}</p>)}
              </div>
            </Box>
          )}
          <p className="text-caption text-fg-subtle px-1">Keys: ← → move through the screens · Backspace goes back · P presents. Fares, drivers and hosts are samples.</p>
        </div>
      </div>

      {/* present mode */}
      {presenting && (
        <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: 'radial-gradient(circle at 50% 30%, #18222F, #080C12 70%)' }} role="dialog" aria-label="Present App UIs">
          <div className="flex items-center gap-3 px-6 h-16 text-white/80 shrink-0">
            <span className="text-body font-semibold text-white">{section.title}</span>
            <span className="text-caption text-white/50">{section.subtitle}</span>
            <span className="flex-1" />
            <span className="text-caption tabular-nums text-white/60">{stepLabel}</span>
            <button onClick={() => setPresenting(false)} className="h-9 w-9 inline-flex items-center justify-center rounded-lg hover:bg-white/10" aria-label="Close present mode (Escape)"><X size={18} /></button>
          </div>
          <div ref={presentRef} className="flex-1 min-h-0 flex items-center justify-center gap-10 px-6">
            <button onClick={() => step(-1)} disabled={order.indexOf(current.id) === 0} className="h-12 w-12 rounded-full inline-flex items-center justify-center text-white/70 hover:bg-white/10 disabled:opacity-20" aria-label="Previous screen"><ChevronLeft size={26} /></button>
            {phoneEl(presentScale)}
            <button onClick={() => step(1)} disabled={order.indexOf(current.id) === order.length - 1} className="h-12 w-12 rounded-full inline-flex items-center justify-center text-white/70 hover:bg-white/10 disabled:opacity-20" aria-label="Next screen"><ChevronRight size={26} /></button>
          </div>
          <div className="h-16 flex items-center justify-center gap-2 text-white shrink-0">
            <span className="font-mono text-caption text-white/50">{current.code}</span>
            <span className="text-body font-medium">{current.title}</span>
          </div>
        </div>
      )}
    </div>
  );
}
