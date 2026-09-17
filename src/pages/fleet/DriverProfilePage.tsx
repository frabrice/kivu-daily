import { useState } from 'react';
import {
  ArrowLeft, Pencil, Flag, Phone, Mail, Car, CalendarDays, Clock, BedDouble,
  Wallet, Receipt, TrendingUp, Smartphone, Landmark, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { Driver, DriverDeposit, DriverFine, DriverFinePayment } from '../../lib/supabase';
import {
  STAGES, REST_DAYS, depositDaysSince, depositTier, DEPOSIT_TIER_STYLE, depositStatusLabel,
  nextDepositDueDate, depositShortfall, computeDepositReliability, formatDateLabelSafe,
  fineAmountPaid, fineStatus, FINE_STATUS_STYLE, fineStatusLabel, WEEKLY_DEPOSIT_AMOUNT,
} from '../../lib/fleet';
import FlagToITDrawer from '../../components/FlagToITDrawer';
import LogDepositDrawer from '../../components/fleet/LogDepositDrawer';

export default function DriverProfilePage({
  driver,
  deposits,
  fines,
  finePayments,
  canEdit,
  onBack,
  onEdit,
  reload,
}: {
  driver: Driver;
  deposits: DriverDeposit[];
  fines: DriverFine[];
  finePayments: DriverFinePayment[];
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
  reload: () => void;
}) {
  const [flagOpen, setFlagOpen] = useState(false);
  const [loggingDeposit, setLoggingDeposit] = useState(false);

  const stageMeta = STAGES.find((s) => s.key === driver.stage);
  const restDayLabel = driver.rest_day ? REST_DAYS.find((d) => d.key === driver.rest_day)?.label : null;

  const driverDeposits = deposits.filter((dep) => dep.driver_id === driver.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date));
  const lastDeposit = driverDeposits[0] ?? null;
  const daysSince = depositDaysSince(lastDeposit?.paid_date ?? null, driver.initial_deposit_paid, driver.initial_deposit_date);
  const tier = depositTier(daysSince);
  const tierStyle = DEPOSIT_TIER_STYLE[tier];
  const nextDue = nextDepositDueDate(lastDeposit?.paid_date ?? null, driver.initial_deposit_paid, driver.initial_deposit_date);
  const shortfall = lastDeposit ? depositShortfall(lastDeposit.amount) : 0;
  const reliability = computeDepositReliability(driver, deposits);
  const totalDepositCount = driverDeposits.length + (driver.initial_deposit_paid ? 1 : 0);

  const driverFines = fines.filter((f) => f.driver_id === driver.id).sort((a, b) => b.fine_date.localeCompare(a.fine_date));
  const totalFined = driverFines.reduce((sum, f) => sum + f.amount, 0);
  const totalFinesPaid = driverFines.reduce((sum, f) => sum + fineAmountPaid(f.id, finePayments), 0);
  const outstandingFines = Math.max(totalFined - totalFinesPaid, 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={onBack} className="btn-ghost flex items-center gap-1.5">
          <ArrowLeft size={14} /> Back to Pipeline
        </button>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button onClick={() => setFlagOpen(true)} className="btn-ghost text-gray-500 flex items-center gap-1.5">
              <Flag size={13} /> Flag to IT
            </button>
          )}
          {canEdit && (
            <button onClick={onEdit} className="btn-primary flex items-center gap-1.5">
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="text-lg font-semibold">{driver.full_name}</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">{driver.phone}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {stageMeta && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${stageMeta.color}20`, color: stageMeta.color }}>
                {stageMeta.label}
              </span>
            )}
            {driver.vehicle ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-600 dark:text-brand-300 bg-brand/10 px-2 py-0.5 rounded-full">
                <Car size={10} /> {driver.vehicle.plate_number}
                {driver.shift && <span>· {driver.shift === 'day' ? 'Day shift' : 'Night shift'}</span>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
                <Car size={10} /> No vehicle assigned
              </span>
            )}
            {restDayLabel ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full">
                <BedDouble size={10} /> Rests on {restDayLabel}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-full">
                <BedDouble size={10} /> No rest day set
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Phone size={10} /> Phone</p>
            <p className="text-[12px] font-medium">{driver.phone}</p>
          </div>
          <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Mail size={10} /> Email</p>
            <p className="text-[12px] font-medium truncate">{driver.email || <span className="text-gray-400 font-normal">Not provided</span>}</p>
          </div>
          <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><CalendarDays size={10} /> Join Date</p>
            <p className="text-[12px] font-medium">{driver.join_date ? formatDateLabelSafe(driver.join_date) : <span className="text-gray-400 font-normal">Not set</span>}</p>
          </div>
          <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Clock size={10} /> Initial Deposit</p>
            <p className="text-[12px] font-medium">
              {driver.initial_deposit_paid
                ? `${driver.initial_deposit_amount ? driver.initial_deposit_amount.toLocaleString() + ' RWF' : 'Paid'}${driver.initial_deposit_date ? ' · ' + formatDateLabelSafe(driver.initial_deposit_date) : ''}`
                : <span className="text-gray-400 font-normal">Not paid</span>}
            </p>
          </div>
        </div>

        {driver.notes && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Notes</p>
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{driver.notes}</p>
          </div>
        )}
      </div>

      {/* Reliability */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-6 h-6 rounded-lg bg-brand/10 flex items-center justify-center shrink-0"><TrendingUp size={12} className="text-brand-600 dark:text-brand-300" /></div>
            <p className="stat-label">On-Time Deposits</p>
          </div>
          <p className="text-2xl font-bold leading-none">
            {reliability.onTimeRate === null ? '—' : `${reliability.onTimeRate}%`}
          </p>
          <p className="text-[10px] text-gray-400 mt-1.5">
            {reliability.totalCycles === 0 ? 'No completed cycles yet' : `${reliability.onTime} on time · ${reliability.late} late (${reliability.totalCycles} cycles)`}
          </p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center shrink-0"><Wallet size={12} className="text-emerald-600 dark:text-emerald-300" /></div>
            <p className="stat-label">Total Deposited</p>
          </div>
          <p className="text-2xl font-bold leading-none">{reliability.totalPaid.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 mt-1.5">RWF across {totalDepositCount} deposit{totalDepositCount === 1 ? '' : 's'}{driver.initial_deposit_paid ? ' (incl. initial)' : ''}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-6 h-6 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center shrink-0"><Receipt size={12} className="text-red-600 dark:text-red-300" /></div>
            <p className="stat-label">Outstanding Fines</p>
          </div>
          <p className="text-2xl font-bold leading-none">{outstandingFines.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 mt-1.5">RWF of {totalFined.toLocaleString()} total across {driverFines.length} fine{driverFines.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      {/* Deposits */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Wallet size={13} /> Deposits</p>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${tierStyle.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${tierStyle.dot}`} /> {depositStatusLabel(daysSince)}
            </span>
            {canEdit && tier !== 'neutral' && (
              <button onClick={() => setLoggingDeposit(true)} className="btn-primary text-[11px] px-2.5 py-1.5">Log Deposit</button>
            )}
          </div>
        </div>
        {nextDue && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
            Next deposit due <span className="font-medium text-gray-700 dark:text-gray-200">{formatDateLabelSafe(nextDue)}</span>
          </p>
        )}
        {shortfall > 0 && (
          <p className="text-[11px] text-red-500 font-medium mb-2.5">{shortfall.toLocaleString()} RWF remaining on the last deposit (of {WEEKLY_DEPOSIT_AMOUNT.toLocaleString()} RWF due)</p>
        )}
        {totalDepositCount === 0 ? (
          <p className="text-[11px] text-gray-400">No deposits logged yet.</p>
        ) : (
          <div className="space-y-1.5">
            {driverDeposits.map((dep) => {
              const rowShortfall = depositShortfall(dep.amount);
              return (
                <div key={dep.id} className="flex items-center justify-between gap-2 text-[11px] py-1.5 border-b border-gray-50 dark:border-white/5 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-500 dark:text-gray-400 shrink-0">{formatDateLabelSafe(dep.paid_date)}</span>
                    <span className="inline-flex items-center gap-1 text-gray-400 shrink-0">
                      {dep.payment_method === 'momo' ? <Smartphone size={10} /> : <Landmark size={10} />}
                      {dep.payment_method === 'momo' ? 'MoMo' : dep.bank_name}
                    </span>
                    {dep.status === 'pending' ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                        <ShieldAlert size={9} /> Pending
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                        <ShieldCheck size={9} /> Confirmed
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-medium">{dep.amount.toLocaleString()} RWF</p>
                    {rowShortfall > 0 && <p className="text-red-500 text-[10px]">{rowShortfall.toLocaleString()} short</p>}
                  </div>
                </div>
              );
            })}
            {driver.initial_deposit_paid && driver.initial_deposit_date && (
              <div className="flex items-center justify-between gap-2 text-[11px] py-1.5 border-b border-gray-50 dark:border-white/5 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">{formatDateLabelSafe(driver.initial_deposit_date)}</span>
                  <span className="inline-flex items-center gap-1 text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full shrink-0">
                    Initial deposit
                  </span>
                </div>
                <p className="font-medium shrink-0">{(driver.initial_deposit_amount ?? 0).toLocaleString()} RWF</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fines */}
      <div className="card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2.5 flex items-center gap-1.5"><Receipt size={13} /> Fines</p>
        {driverFines.length === 0 ? (
          <p className="text-[11px] text-gray-400">No fine.</p>
        ) : (
          <div className="space-y-2">
            {driverFines.map((f) => {
              const amountPaid = fineAmountPaid(f.id, finePayments);
              const status = fineStatus(f.amount, amountPaid);
              const statusStyle = FINE_STATUS_STYLE[status];
              return (
                <div key={f.id} className="py-1.5 border-b border-gray-50 dark:border-white/5 last:border-0">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="min-w-0">
                      <p className="text-gray-500 dark:text-gray-400">{formatDateLabelSafe(f.fine_date)}</p>
                      {f.reason && <p className="text-gray-400 truncate">{f.reason}</p>}
                    </div>
                    <span className="font-medium shrink-0">{f.amount.toLocaleString()} RWF</span>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-[9px] font-medium px-2 py-0.5 rounded-full mt-1 ${statusStyle.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} /> {fineStatusLabel(status, f.amount, amountPaid)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {flagOpen && (
        <FlagToITDrawer
          entityType="driver"
          entityId={driver.id}
          entityLabel={`Driver: ${driver.full_name}`}
          onClose={() => setFlagOpen(false)}
        />
      )}

      {loggingDeposit && (
        <LogDepositDrawer
          driver={driver}
          onClose={() => setLoggingDeposit(false)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
