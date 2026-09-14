import { LucideIcon } from 'lucide-react';

const ICON_COLORS = {
  brand: 'bg-brand/10 text-brand-600 dark:text-brand-300',
  blue: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300',
  amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300',
  violet: 'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-300',
  rose: 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300',
  cyan: 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
} as const;

interface KpiTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
  color?: keyof typeof ICON_COLORS;
}

export default function KpiTile({ icon: Icon, label, value, tone, color = 'brand' }: KpiTileProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${ICON_COLORS[color]}`}>
          <Icon size={12} />
        </div>
        <p className="stat-label">{label}</p>
      </div>
      <p className={`text-xl font-bold leading-none ${tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-red-500' : ''}`}>{value}</p>
    </div>
  );
}
