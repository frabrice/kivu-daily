import { ArrowLeft, LayoutDashboard, Truck, PhoneCall, Target, Image as ImageIcon, Package, Wallet, KeyRound } from 'lucide-react';

interface RoleOption {
  key: string;
  label: string;
  hint: string;
  icon: typeof LayoutDashboard;
  comingSoon?: boolean;
}

const ROLES: RoleOption[] = [
  { key: 'managing_director', label: 'Control Center', hint: 'See everything, live', icon: LayoutDashboard },
  { key: 'fleet', label: 'Fleet', hint: 'Driver pipeline', icon: Truck },
  { key: 'call_center', label: 'Call Center', hint: 'Call queue & scripts', icon: PhoneCall },
  { key: 'marketing_sales_bd', label: 'Marketing & Sales', hint: 'Campaigns & contacts', icon: Target },
  { key: 'social_media', label: 'Social Media', hint: 'Content calendar', icon: ImageIcon },
  { key: 'it', label: 'IT / Product', hint: 'Product Hub', icon: Package },
  { key: 'finance', label: 'Finance', hint: 'Accounts, ledger & payroll', icon: Wallet },
];

interface RoleSelectPageProps {
  onBack: () => void;
  onManual: (email: string) => void;
}

export default function RoleSelectPage({ onBack, onManual }: RoleSelectPageProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-navy-950 text-navy-900 dark:text-white flex flex-col">
      <header className="max-w-3xl w-full mx-auto px-6 pt-8">
        <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 -ml-2">
          <ArrowLeft size={14} /> Back
        </button>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="max-w-3xl w-full">
          <div className="text-center mb-10">
            <div className="w-12 h-12 rounded-2xl bg-white border border-gray-200 dark:border-white/10 flex items-center justify-center overflow-hidden mx-auto mb-5 shadow-sm">
              <img src="/kivu-ride-logo.png" alt="Kivu Ride" className="w-9 h-9 object-contain" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Log in as</h1>
            <p className="text-[12px] text-gray-400">Choose your workspace to continue.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ROLES.map((role) => (
              <button
                key={role.key}
                onClick={() => !role.comingSoon && onManual('')}
                disabled={role.comingSoon}
                className={`card p-5 text-left transition-all ${
                  role.comingSoon ? 'opacity-60 cursor-not-allowed border-dashed' : 'hover:shadow-md hover:border-brand/30'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${role.comingSoon ? 'bg-gray-100 dark:bg-white/5' : 'bg-brand/10'}`}>
                  <role.icon size={18} className={role.comingSoon ? 'text-gray-400' : 'text-brand-600 dark:text-brand-300'} />
                </div>
                <p className="text-[12px] font-semibold mb-0.5">{role.label}</p>
                <p className="text-[10px] text-gray-400">{role.hint}</p>
                {role.comingSoon && (
                  <span className="inline-block text-[8px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full mt-2.5">
                    Coming Soon
                  </span>
                )}
              </button>
            ))}
          </div>

          <button
            onClick={() => onManual('')}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 mt-8"
          >
            <KeyRound size={12} /> Sign in with your email and password
          </button>
        </div>
      </div>
    </div>
  );
}
