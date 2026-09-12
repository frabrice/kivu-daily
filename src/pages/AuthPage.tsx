import { useState } from 'react';
import { ListChecks, Users2, Radio, CalendarClock, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

const HIGHLIGHTS = [
  { icon: ListChecks, title: 'Daily tasks, real accountability', desc: 'Plan your day each morning, track streaks, get reviewed.' },
  { icon: Users2, title: 'One control center for the MD', desc: 'Every department, every employee, one live dashboard.' },
  { icon: CalendarClock, title: 'Meetings, documents & announcements', desc: 'Everything the team needs, in one place, not scattered chats.' },
  { icon: Radio, title: 'See it happen, live', desc: 'A real-time activity feed of what the company is doing right now.' },
];

interface AuthPageProps {
  prefillEmail?: string;
  onBack?: () => void;
}

export default function AuthPage({ prefillEmail = '', onBack }: AuthPageProps) {
  const { refreshProfile } = useAuth();
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white dark:bg-navy-950">
      {/* Left: brand / landing panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 text-white flex-col justify-between p-12">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-brand/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-32 w-96 h-96 bg-positive/10 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04] flex items-center justify-center">
          <img src="/kivu-ride-logo.png" alt="" className="w-[36rem] h-[36rem] object-contain" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0">
            <img src="/kivu-ride-logo.png" alt="Kivu Ride" className="w-8 h-8 object-contain" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">Kivu Daily</p>
            <p className="text-[11px] text-white/50 leading-tight">Kivu Ride Ltd</p>
          </div>
        </div>

        <div className="relative">
          <p className="text-xs font-medium text-brand-200 uppercase tracking-wider mb-3">Beyond Transport. Into the Future.</p>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            The Kivu Ride<br />control center.
          </h1>
          <p className="text-white/60 text-sm max-w-sm mb-10">
            The virtual office for every department — where the team plans, tracks, and the MD sees it all, live.
          </p>

          <div className="space-y-5">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <h.icon size={15} className="text-brand-200" />
                </div>
                <div>
                  <p className="text-[13px] font-medium">{h.title}</p>
                  <p className="text-[12px] text-white/50 mt-0.5">{h.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-white/30">© {new Date().getFullYear()} Kivu Ride Ltd. All rights reserved.</p>
      </div>

      {/* Right: sign-in */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {onBack && (
            <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 -ml-2 mb-4">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          <div className="lg:hidden flex flex-col items-center text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden mb-4 shadow-sm">
              <img src="/kivu-ride-logo.png" alt="Kivu Ride" className="w-10 h-10 object-contain" />
            </div>
            <h1 className="text-xl font-bold">Kivu Daily</h1>
            <p className="text-xs text-gray-400 mt-1">The Kivu Ride control center.</p>
          </div>

          <h2 className="text-xl font-semibold mb-1">Welcome back</h2>
          <p className="text-[13px] text-gray-400 mb-6">Sign in to your Kivu Daily workspace.</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-gray-500 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@kivuride.com"
                className="input"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-gray-500 mb-1.5">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
              />
            </div>

            {error && (
              <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 disabled:opacity-50">
              {loading ? 'Please wait…' : 'Sign In'}
            </button>
          </form>

          <p className="text-xs text-center text-gray-400 mt-6">
            Don't have an account? Contact the Managing Director to create one for you.
          </p>
        </div>
      </div>
    </div>
  );
}
