import { ReactNode } from 'react';
import { AlertOctagon, BadgeCheck, CalendarClock, CarFront, Clock, PauseCircle, PhoneCall, PhoneMissed, UserX, Hourglass, Handshake, Ban } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DepositStanding } from '../../lib/fleet';
import type { PaymentCall, PromiseState } from '../../lib/paymentCalls';

// The shared look of a driver's money on the Deposits and Drivers pages
// (MD, 26 Nov 2026): one status per driver with one colour, an avatar
// ringed in that colour, a plate chip, amounts and the latest call.

export type MoneyStatusKey = 'taken' | 'late' | 'pay_today' | 'due_soon' | 'paid' | 'paused' | 'ended' | 'not_started';

export interface MoneyStatus { key: MoneyStatusKey; label: string; Icon: LucideIcon; rank: number }

// rank: the order of the sections on Deposits (most urgent first).
export function moneyStatus(s: DepositStanding | null, opts: { ended: boolean; taken: boolean; today: string }): MoneyStatus {
  if (opts.ended) return { key: 'ended', label: 'Contract ended', Icon: UserX, rank: 7 };
  if (!s || !s.hasStarted) return { key: 'not_started', label: 'Not started', Icon: Hourglass, rank: 6 };
  if (opts.taken) return { key: 'taken', label: 'Car taken back', Icon: CarFront, rank: 0 };
  if (s.pausedToday) return { key: 'paused', label: 'Day off', Icon: PauseCircle, rank: 5 };
  if (s.dailyRule ? s.payToday : false) return { key: 'pay_today', label: 'Pay today', Icon: Clock, rank: 2 };
  if (!s.isCleared || s.owes > 0) return { key: 'late', label: 'Not paid', Icon: AlertOctagon, rank: 1 };
  if (s.nextDueDate && s.nextDueAmount > 0 && s.nextDueDate <= addDay(opts.today, 1)) return { key: 'due_soon', label: s.nextDueDate <= opts.today ? 'Pays today' : 'Pays tomorrow', Icon: CalendarClock, rank: 3 };
  return { key: 'paid', label: 'Paid up', Icon: BadgeCheck, rank: 4 };
}
const addDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Colours per status - the theme's own tokens, so light and dark both read.
export const STATUS_STYLE: Record<MoneyStatusKey, { pill: string; ring: string; bar: string; text: string; soft: string }> = {
  taken: { pill: 'bg-danger text-white border-danger', ring: 'ring-danger', bar: 'bg-danger', text: 'text-danger', soft: 'bg-danger-muted' },
  late: { pill: 'bg-danger-muted text-danger border-danger/30', ring: 'ring-danger', bar: 'bg-danger', text: 'text-danger', soft: 'bg-danger-muted' },
  pay_today: { pill: 'bg-attention-muted text-attention border-attention/30', ring: 'ring-attention', bar: 'bg-attention', text: 'text-attention', soft: 'bg-attention-muted' },
  due_soon: { pill: 'bg-accent-muted text-accent-fg border-accent/30', ring: 'ring-accent', bar: 'bg-accent', text: 'text-accent-fg', soft: 'bg-accent-muted' },
  paid: { pill: 'bg-success-muted text-success border-success/30', ring: 'ring-success', bar: 'bg-success', text: 'text-success', soft: 'bg-success-muted' },
  paused: { pill: 'bg-done-muted text-done border-done/30', ring: 'ring-done', bar: 'bg-done', text: 'text-done', soft: 'bg-done-muted' },
  ended: { pill: 'bg-inset text-fg-subtle border-line', ring: 'ring-line-strong', bar: 'bg-line-strong', text: 'text-fg-subtle', soft: 'bg-inset' },
  not_started: { pill: 'bg-inset text-fg-muted border-line', ring: 'ring-line', bar: 'bg-line', text: 'text-fg-muted', soft: 'bg-inset' },
};

export function StatusPill({ status, size = 'md' }: { status: MoneyStatus; size?: 'sm' | 'md' }) {
  const st = STATUS_STYLE[status.key];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap ${size === 'sm' ? 'h-5 px-1.5 text-micro' : 'h-6 px-2 text-caption'} ${st.pill}`}>
      <status.Icon size={size === 'sm' ? 11 : 12} /> {status.label}
    </span>
  );
}

const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
// A stable soft colour per person for the avatar fill.
const AVATAR_FILLS = ['bg-sky-500/15 text-sky-700 dark:text-sky-300', 'bg-violet-500/15 text-violet-700 dark:text-violet-300', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-800 dark:text-amber-300', 'bg-rose-500/15 text-rose-700 dark:text-rose-300', 'bg-teal-500/15 text-teal-700 dark:text-teal-300'];
const fillOf = (name: string) => AVATAR_FILLS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_FILLS.length];

export function DriverAvatar({ name, status, size = 36 }: { name: string; status?: MoneyStatus; size?: number }) {
  return (
    <span style={{ width: size, height: size }}
      className={`shrink-0 rounded-full flex items-center justify-center font-semibold text-caption ${fillOf(name)} ${status ? `ring-2 ring-offset-2 ring-offset-surface-2 ${STATUS_STYLE[status.key].ring}` : ''}`}>
      {initials(name) || '?'}
    </span>
  );
}

export function PlateChip({ plate, muted }: { plate: string | null | undefined; muted?: boolean }) {
  if (!plate) return <span className="text-caption text-fg-subtle">No car</span>;
  return <span className={`inline-flex items-center h-5 px-1.5 rounded border font-mono text-micro font-semibold tracking-wide ${muted ? 'border-line text-fg-muted bg-inset' : 'border-line-strong text-fg bg-surface-2'}`}>{plate}</span>;
}

// "95,000 RWF" with the currency small.
export function Amount({ value, tone, size = 'md' }: { value: number; tone?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'lg' ? 'text-title' : size === 'md' ? 'text-ui' : 'text-body';
  return <span className={`${s} font-semibold tabular-nums ${tone ?? ''}`}>{Math.round(value).toLocaleString('en-US')}<span className="text-micro font-medium text-fg-subtle ml-0.5">RWF</span></span>;
}

// A label above a value, used in the Deposits rows.
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-micro font-semibold uppercase tracking-wide text-fg-subtle mb-0.5">{label}</p>
      <div className="text-body text-fg min-w-0">{children}</div>
    </div>
  );
}

const CALL_ICON: Record<string, LucideIcon> = { promised: Handshake, paid: BadgeCheck, no_answer: PhoneMissed, refused: Ban, wrong_number: PhoneMissed, car_taken: CarFront, car_returned: CarFront };
const CALL_TONE = { danger: 'bg-danger-muted text-danger', attention: 'bg-attention-muted text-attention', good: 'bg-success-muted text-success', muted: 'bg-inset text-fg-muted' } as const;

// The latest call as a soft chip: icon, the line, coloured by what it means.
export function CallChip({ call, line, state }: { call: PaymentCall; line: { text: string; tone: keyof typeof CALL_TONE }; state?: PromiseState | null }) {
  const Icon = CALL_ICON[call.outcome] ?? PhoneCall;
  return (
    <span title={line.text} className={`inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-caption font-medium max-w-full ${CALL_TONE[line.tone]}`}>
      <Icon size={13} className="shrink-0 mt-px" />
      <span className="truncate">{line.text}</span>
      {state === 'kept' && <span className="sr-only">kept</span>}
    </span>
  );
}

export function NotCalledChip() {
  return <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-semibold bg-danger-muted text-danger border border-dashed border-danger/40"><PhoneMissed size={13} /> Not called today</span>;
}
