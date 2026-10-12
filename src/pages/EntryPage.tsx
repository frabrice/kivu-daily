import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Eye, EyeOff, Headphones, KeyRound, LayoutDashboard, Loader2, Lock, Moon, Package, Radio, Search, ShieldCheck, Sun, Target, Truck, Wallet, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

// The entry room: a door into Kivu Daily. Click the door (or press Enter)
// and it swings open onto the sign-in. The doors along the bottom open the
// same sign-in for a department - accounts decide where you land.

const ROOMS = [
  { key: 'md', label: 'Control Center', inside: 'The whole company, live', icon: LayoutDashboard },
  { key: 'fleet', label: 'Fleet', inside: 'Drivers, cars, payments', icon: Truck },
  { key: 'finance', label: 'Finance', inside: 'Ledger, approvals, payroll', icon: Wallet },
  { key: 'call_center', label: 'Call Center', inside: 'Calls, cases, outreach', icon: Headphones },
  { key: 'growth', label: 'Growth', inside: 'Campaigns and content', icon: Target },
  { key: 'product', label: 'Product Hub', inside: 'Issues and products', icon: Package },
];

function useKigaliClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return {
    day: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Kigali' }),
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' }),
    hour: Number(now.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kigali' })),
  };
}

const friendly = (msg: string) =>
  /invalid login/i.test(msg) ? "That email or password isn't right. Check both and try again."
    : /email not confirmed/i.test(msg) ? 'This account has not been activated yet. Use the link in your invitation email.'
    : /network|fetch/i.test(msg) ? "Kivu Daily can't be reached. Check your internet connection." : msg;

export default function EntryPage() {
  const { refreshProfile } = useAuth();
  const { theme, toggle } = useTheme();
  const clock = useKigaliClock();
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<(typeof ROOMS)[number] | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const greeting = clock.hour < 12 ? 'Good morning' : clock.hour < 18 ? 'Good afternoon' : 'Good evening';

  const openDoor = (r: (typeof ROOMS)[number] | null = null) => { setRoom(r); setOpen(true); setError(''); };
  useEffect(() => { if (open) { const t = setTimeout(() => emailRef.current?.focus(), 650); return () => clearTimeout(t); } }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) { if (e.key === 'Escape' && open) setOpen(false); return; }
      if (!open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDoor(); }
      if (open && e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw err;
      setEntering(true);
      await refreshProfile();
    } catch (err) {
      setEntering(false);
      setError(friendly(err instanceof Error ? err.message : 'Sign-in failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="entry entry-bg relative min-h-[100dvh] overflow-hidden text-[color:var(--e-ink)] flex flex-col">
      <div className="entry-floor" aria-hidden="true" />

      {/* Top: who we are, the time in Kigali, light/dark */}
      <header className="relative z-10 flex items-center gap-3 px-5 sm:px-8 h-16">
        <span className="w-9 h-9 rounded-lg bg-white border border-line flex items-center justify-center overflow-hidden shrink-0"><img src="/kivu-ride-logo.png" alt="" className="w-7 h-7 object-contain" /></span>
        <div className="leading-tight">
          <p className="text-ui font-semibold">Kivu Daily</p>
          <p className="text-caption opacity-60">Kivu Ride Ltd</p>
        </div>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center gap-2 text-small opacity-80">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span>{clock.day} · <b className="tabular-nums">{clock.time}</b> in Kigali</span>
        </div>
        <button onClick={toggle} className="ml-2 w-9 h-9 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <main className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-5 sm:px-8 grid lg:grid-cols-[1fr_auto] items-center gap-10 py-6">
        {/* Words */}
        <section className="entry-rise max-w-xl order-2 lg:order-1 text-center lg:text-left mx-auto lg:mx-0">
          <p className="text-caption font-semibold uppercase tracking-[0.18em] text-accent-fg">Beyond transport. Into the future.</p>
          <h1 className="mt-3 text-[2.6rem] sm:text-[3.4rem] leading-[1.05] font-bold tracking-tight">
            {greeting}.<br /><span className="text-accent-fg">Step inside</span> Kivu Daily.
          </h1>
          <p className="mt-4 text-ui opacity-75 leading-relaxed">
            Kivu Ride has no physical office — this is it. Behind this door every department plans its day, every driver, car and case has its own page, and the MD sees it all, live.
          </p>
          <ul className="mt-6 grid sm:grid-cols-3 gap-3 text-left">
            {[
              { icon: Search, t: 'Find anything', d: 'Ctrl K jumps to any driver, car, case or page' },
              { icon: Radio, t: 'Live', d: 'Numbers and tasks update as work happens' },
              { icon: ShieldCheck, t: 'Yours only', d: 'You see the pages for your role' },
            ].map((f) => (
              <li key={f.t} className="rounded-xl p-3 bg-white/60 dark:bg-white/[0.04] border border-black/5 dark:border-white/10 backdrop-blur-sm">
                <f.icon size={16} className="text-accent-fg" />
                <p className="text-body font-semibold mt-1.5">{f.t}</p>
                <p className="text-small opacity-70">{f.d}</p>
              </li>
            ))}
          </ul>
          {!open && (
            <button onClick={() => openDoor()} className="mt-7 inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-accent text-fg-onaccent text-ui font-semibold shadow-lg shadow-accent/30 hover:brightness-110">
              Open the door <ArrowRight size={16} />
            </button>
          )}
          {!open && <p className="mt-2 text-small opacity-60 hidden sm:block">or press <span className="kbd">Enter</span></p>}
        </section>

        {/* The door */}
        <section className="order-1 lg:order-2 flex flex-col items-center entry-rise" style={{ animationDelay: '0.12s' }}>
          <div className={`door-scene ${entering ? 'scale-110 transition-transform duration-700' : ''}`}>
            <div className={`door-frame ${open ? 'is-open' : ''}`} style={{ maxWidth: 'calc(100vw - 48px)' }}>
              <div className={`door-light ${open ? 'is-open' : ''}`} />

              {/* Behind the door: sign in */}
              <div className={`door-inner absolute inset-0 flex flex-col px-7 pt-14 pb-6 ${open ? 'is-open' : ''}`} aria-hidden={!open}>
                <div className="text-center text-fg">
                  <span className="mx-auto w-11 h-11 rounded-xl bg-accent/15 text-accent-fg flex items-center justify-center">{room ? <room.icon size={20} /> : <KeyRound size={20} />}</span>
                  <p className="mt-3 text-title font-semibold">{room ? `Into ${room.label}` : 'Welcome in'}</p>
                  <p className="text-small text-fg-muted">{room ? room.inside : 'Sign in to your workspace'}</p>
                </div>
                <form onSubmit={submit} className="mt-5 space-y-3 text-fg">
                  <label className="block">
                    <span className="block text-caption font-medium text-fg-muted mb-1">Email</span>
                    <input ref={emailRef} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@kivuride.com" className="input h-10" tabIndex={open ? 0 : -1} />
                  </label>
                  <label className="block">
                    <span className="block text-caption font-medium text-fg-muted mb-1">Password</span>
                    <span className="relative block">
                      <input type={show ? 'text' : 'password'} required minLength={6} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                        onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))} placeholder="Your password" className="input h-10 pr-10" tabIndex={open ? 0 : -1} />
                      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-fg-subtle hover:text-fg" aria-label={show ? 'Hide password' : 'Show password'} tabIndex={open ? 0 : -1}>
                        {show ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </span>
                    {caps && <span className="block mt-1 text-caption text-attention">Caps Lock is on</span>}
                  </label>
                  {error && <p role="alert" className="text-small text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
                  <button type="submit" disabled={busy || entering} className="btn-primary w-full h-10 text-ui" tabIndex={open ? 0 : -1}>
                    {busy || entering ? <><Loader2 size={15} className="animate-spin" /> Opening…</> : <>Enter Kivu Daily <ArrowRight size={15} /></>}
                  </button>
                </form>
                <p className="mt-auto pt-3 text-center text-caption text-fg-subtle flex items-center justify-center gap-1"><Lock size={11} /> Accounts are created by the MD</p>
                <button onClick={() => setOpen(false)} className="absolute top-4 right-4 p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-hover" aria-label="Close the door" tabIndex={open ? 0 : -1}><X size={15} /></button>
              </div>

              {/* The door itself */}
              <button type="button" onClick={() => openDoor()} className={`door-panel ${open ? 'is-open' : ''}`} aria-label="Open the door to sign in" aria-expanded={open} tabIndex={open ? -1 : 0}>
                <span className="absolute left-1/2 -translate-x-1/2 top-9 w-24 h-24 rounded-full border border-white/10 bg-white/[0.06] flex items-center justify-center shadow-[inset_0_0_30px_rgba(255,255,255,0.06)]">
                  <span className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center overflow-hidden"><img src="/kivu-ride-logo.png" alt="" className="w-11 h-11 object-contain" /></span>
                </span>
                <span className="absolute inset-x-8 top-[44%] h-px bg-white/10" />
                <span className="absolute inset-x-8 bottom-24 h-px bg-white/10" />
                <span className="door-handle" />
                <span className="absolute inset-x-0 bottom-9 text-center">
                  <span className="block text-white text-title font-semibold tracking-wide">Kivu Daily</span>
                  <span className="block text-white/55 text-small mt-0.5">Push to enter</span>
                </span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* The rooms */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 pb-6">
        <p className="text-caption font-semibold uppercase tracking-[0.18em] opacity-60 mb-3 text-center lg:text-left">Every department is inside</p>
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x lg:justify-between">
          {ROOMS.map((r) => (
            <button key={r.key} onClick={() => openDoor(r)} className="door-mini snap-start shrink-0 w-[150px] h-[92px] px-3 pt-3 pb-2 text-left text-white flex flex-col" title={`Sign in — ${r.inside}`}>
              <r.icon size={17} className="text-[color:rgb(var(--e-glow))]" />
              <span className="mt-auto text-body font-semibold">{r.label}</span>
              <span className="text-caption text-white/60 truncate">{r.inside}</span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-caption opacity-50 text-center">© {new Date().getFullYear()} Kivu Ride Ltd · Beyond transport. Into the future.</p>
      </footer>

      {entering && <div className="entry-enter fixed inset-0 z-50 bg-canvas flex items-center justify-center"><Loader2 size={22} className="animate-spin text-accent-fg" /></div>}
    </div>
  );
}
