import { Moon, Sun, ListChecks, Users2, Radio, CalendarClock, ArrowRight, Truck, PhoneCall, Target, Image as ImageIcon, Package, LayoutDashboard, Wallet } from 'lucide-react';
import { useTheme } from '../lib/theme';

const HIGHLIGHTS = [
  { icon: ListChecks, title: 'Daily tasks, real accountability', desc: 'Every employee plans their day each morning, tracks their streak, and gets reviewed — no more work that happens invisibly.' },
  { icon: Users2, title: 'One control center for the company', desc: 'Every department, every employee, one live dashboard. Know who needs attention before they have to ask.' },
  { icon: CalendarClock, title: 'Meetings, documents & announcements', desc: 'Everything the team needs lives in one place, not scattered across phones and chat threads.' },
  { icon: Radio, title: 'See it happen, live', desc: 'A real-time activity feed of what the company is doing right now, department by department.' },
];

const DEPARTMENTS = [
  { icon: LayoutDashboard, label: 'Control Center' },
  { icon: Truck, label: 'Fleet' },
  { icon: PhoneCall, label: 'Call Center' },
  { icon: Target, label: 'Marketing & Sales' },
  { icon: ImageIcon, label: 'Social Media' },
  { icon: Package, label: 'IT / Product' },
  { icon: Wallet, label: 'Finance' },
];

interface LandingPageProps {
  onLogin: () => void;
}

export default function LandingPage({ onLogin }: LandingPageProps) {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-white dark:bg-navy-950 text-navy-900 dark:text-white">
      {/* Nav */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 dark:border-white/10 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
            <img src="/kivu-ride-logo.png" alt="Kivu Ride" className="w-7 h-7 object-contain" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">Kivu Daily</p>
            <p className="text-[11px] text-gray-400 leading-tight">Kivu Ride Ltd</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggle} className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button onClick={onLogin} className="btn-primary flex items-center gap-1.5">
            Log In <ArrowRight size={14} />
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-brand/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 w-96 h-96 bg-positive/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-20 text-center">
          <p className="text-xs font-semibold text-brand-600 dark:text-brand-300 uppercase tracking-[0.2em] mb-4">
            Beyond Transport. Into the Future.
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight max-w-3xl mx-auto mb-5">
            The virtual office behind every Kivu Ride trip.
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-base max-w-xl mx-auto mb-9">
            Kivu Ride doesn't have a physical office — this is it. One place where every department plans its day,
            the MD sees it all live, and nothing important gets lost in a phone chat.
          </p>
          <button onClick={onLogin} className="btn-primary px-6 py-3 text-[14px] inline-flex items-center gap-2">
            Log In to Your Workspace <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {/* Feature highlights */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {HIGHLIGHTS.map((h) => (
            <div key={h.title} className="card p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                <h.icon size={18} className="text-brand-600 dark:text-brand-300" />
              </div>
              <div>
                <p className="text-[14px] font-semibold mb-1">{h.title}</p>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">{h.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Departments strip */}
      <section className="border-t border-gray-100 dark:border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-14">
          <p className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-[0.2em] mb-8">
            Built for every part of the company
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {DEPARTMENTS.map((d) => (
              <div key={d.label} className="flex flex-col items-center gap-2.5 py-5 px-3 rounded-2xl border border-gray-100 dark:border-white/5">
                <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                  <d.icon size={17} className="text-brand-600 dark:text-brand-300" />
                </div>
                <p className="text-[12px] font-medium text-center text-gray-600 dark:text-gray-300">{d.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission strip */}
      <section className="bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 text-white">
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold leading-snug mb-4">
            Every department, one live view, zero guesswork.
          </h2>
          <p className="text-white/60 text-[14px] max-w-xl mx-auto mb-8">
            Kivu Daily exists so the team can move fast without the Managing Director having to sit with every
            employee to know what's happening. Plan it, track it, see it — together.
          </p>
          <button onClick={onLogin} className="btn-primary px-6 py-3 text-[14px] inline-flex items-center gap-2">
            Log In to Your Workspace <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-8 text-center">
        <p className="text-[11px] text-gray-400">© {new Date().getFullYear()} Kivu Ride Ltd. All rights reserved.</p>
      </footer>
    </div>
  );
}
