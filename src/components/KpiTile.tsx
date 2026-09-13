import { LucideIcon } from 'lucide-react';

interface KpiTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}

export default function KpiTile({ icon: Icon, label, value, tone }: KpiTileProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-6 h-6 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
          <Icon size={12} className="text-brand-600 dark:text-brand-300" />
        </div>
        <p className="stat-label">{label}</p>
      </div>
      <p className={`text-xl font-bold leading-none ${tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-red-500' : ''}`}>{value}</p>
    </div>
  );
}
