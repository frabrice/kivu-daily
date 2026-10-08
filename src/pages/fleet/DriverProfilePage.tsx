import DriverCasesList from '../../components/callTickets/DriverCasesList';
import { useState } from 'react';
import {
  ArrowLeft, Pencil, Flag, Phone, Mail, Car, CalendarDays, Clock, BedDouble,
  Wallet, Receipt, TrendingUp, Smartphone, Landmark, ShieldCheck, ShieldAlert,
  UserX, UserCheck, History,
} from 'lucide-react';
import { Driver, DriverDeposit, DriverFine, DriverFinePayment, DriverContractEvent } from '../../lib/supabase';
import {
  STAGES, effectiveStage, REST_DAYS, DEPOSIT_TIER_STYLE, depositRemainingColor, formatDateLabelSafe,
  computeDepositStanding, depositStandingTier, depositStandingLabel, depositPeriodLabel, paidThroughDate, formatRwf, SUNDAY_RULE_START,
  fineAmountPaid, fineStatus, FINE_STATUS_STYLE, fineStatusLabel, canSeeDriverPayments,
} from '../../lib/fleet';
import { useAuth } from '../../lib/auth';
import FlagToITDrawer from '../../components/FlagToITDrawer';
import LogDepositDrawer from '../../components/fleet/LogDepositDrawer';
import EndContractDrawer from '../../components/fleet/EndContractDrawer';
import ReactivateDriverDrawer from '../../components/fleet/ReactivateDriverDrawer';

export default function DriverProfilePage({
  driver,
  drivers,
  deposits,
  fines,
  finePayments,
  contractEvents,
  canEdit,
  onBack,
  onEdit,
  reload,
}: {
  driver: Driver;
  drivers: Driver[];
  deposits: DriverDeposit[];
  fines: DriverFine[];
  finePayments: DriverFinePayment[];
  contractEvents: DriverContractEvent[];
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
  reload: () => void;
}) {
  const [flagOpen, setFlagOpen] = useState(false);
  const [loggingDeposit, setLoggingDeposit] = useState(false);
  const { profile } = useAuth();
  const showMoney = canSeeDriverPayments(profile);
  const [endContractOpen, setEndContractOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  const stageMeta = STAGES.find((s) => s.key === effectiveStage(driver));
  const restDayLabel = driver.rest_day ? REST_DAYS.find((d) => d.key === driver.rest_day)?.label : null;

  const driverDeposits = deposits.filter((dep) => dep.driver_id === driver.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date));
  const isEnded = driver.contract_status === 'ended';
  const standing = computeDepositStanding(driver, driverDeposits);
  const tier = depositStandingTier(standing);
  const tierStyle = DEPOSIT_TIER_STYLE[tier];
  const totalDepositCount = driverDeposits.length + (driver.initial_deposit_paid ? 1 : 0);
  const scoredWeeks = standing.onTimeWeeks + standing.lateWeeks;
  const onTimeRate = scoredWeeks > 0 ? Math.round((standing.onTimeWeeks / scoredWeeks) * 100) : null;

  // Each payment shows how far the running total reaches after it, so
  // the list reads as "this payment carried them through X".
  const paidThroughAfter = new Map<string, string | null>();
  if (driver.start_date) {
    let cumulative = driver.initial_deposit_paid ? (driver.initial_deposit_amount ?? 0) : 0;
    paidThroughAfter.set('initial', cumulative > 0 ? paidThroughDate(driver.start_date, driver.rest_day, cumulative) : null);
    for (const dep of [...driverDeposits].sort((a, b) => a.paid_date.localeCompare(b.paid_date) || a.created_at.localeCompare(b.created_at))) {
      cumulative += dep.amount;
      paidThroughAfter.set(dep.id, paidThroughDate(driver.start_date, driver.rest_day, cumulative));
    }
  }

  const driverFines = fines.filter((f) => f.driver_id === driver.id).sort((a, b) => b.fine_date.localeCompare(a.fine_date));
  const totalFined = driverFines.reduce((sum, f) => sum + f.amount, 0);
  const totalFinesPaid = driverFines.reduce((sum, f) => sum + fineAmountPaid(f.id, finePayments), 0);
  const outstandingFines = Math.max(totalFined - totalFinesPaid, 0);

  const driverContractEvents = contractEvents.filter((e) => e.driver_id === driver.id).sort((a, b) => b.event_date.localeCompare(a.event_date));
  const lastEndedEvent = driverContractEvents.find((e) => e.event_type === 'ended');
  const replacedDriver = driver.replaced_driver_id ? drivers.find((d) => d.id === driver.replaced_driver_id) ?? null : null;
  const replacedByDriver = drivers.find((d) => d.replaced_driver_id === driver.id) ?? null;

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
            isEnded ? (
              <button onClick={() => setReactivateOpen(true)} className="btn-primary flex items-center gap-1.5">
                <UserCheck size={13} /> Reactivate
              </button>
            ) : (
              <button onClick={() => setEndContractOpen(true)} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <UserX size={13} /> End Contract
              </button>
            )
          )}
          {canEdit && (
            <button onClick={onEdit} className="btn-primary flex items-center gap-1.5">
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
      </div>

      {isEnded && (
        <div className="card p-4 border border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 flex items-center gap-1.5 mb-1">
            <UserX size={12} /> Contract Ended
          </p>
          {lastEndedEvent ? (
            <p className="text-[12px] text-gray-600 dark:text-gray-300">
              On <span className="font-medium">{formatDateLabelSafe(lastEndedEvent.event_date)}</span> · {lastEndedEvent.reason}
              {lastEndedEvent.details && <span className="text-gray-400"> — {lastEndedEvent.details}</span>}
            </p>
          ) : (
            <p className="text-[12px] text-gray-600 dark:text-gray-300">No details on file.</p>
          )}
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="text-lg font-semibold">{driver.full_name}</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">{driver.phone}</p>
            {replacedDriver && (
              <p className="text-[10px] text-indigo-500 dark:text-indigo-300 mt-1">Replacing {replacedDriver.full_name}</p>
            )}
            {replacedByDriver && (
              <p className="text-[10px] text-indigo-500 dark:text-indigo-300 mt-1">Replaced by {replacedByDriver.full_name}</p>
            )}
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
            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><CalendarDays size={10} /> Start Date</p>
            <p className="text-[12px] font-medium">
              {driver.start_date ? formatDateLabelSafe(driver.start_date) : <span className="text-gray-400 font-normal">Not set</span>}
            </p>
            {driver.start_date && showMoney && <p className="text-[10px] text-brand-600 dark:text-brand-300 mt-0.5">Pays every Sunday</p>}
          </div>
          {showMoney && (
          <div className="card p-2.5 bg-gray-50 dark:bg-white/5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Clock size={10} /> Initial Deposit</p>
            <p className="text-[12px] font-medium">
              {driver.initial_deposit_paid
                ? `${driver.initial_deposit_amount ? driver.initial_deposit_amount.toLocaleString() + ' RWF' : 'Paid'}${driver.initial_deposit_date ? ' · ' + formatDateLabelSafe(driver.initial_deposit_date) : ''}`
                : <span className="text-gray-400 font-normal">Not paid</span>}
            </p>
          </div>
          )}
        </div>

        {driver.notes && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Notes</p>
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{driver.notes}</p>
          </div>
        )}
      </div>

      {showMoney && (<>
      {/* Reliability */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-6 h-6 rounded-lg bg-brand/10 flex items-center justify-center shrink-0"><TrendingUp size={12} className="text-brand-600 dark:text-brand-300" /></div>
            <p className="stat-label">On-Time Weeks</p>
          </div>
          <p className="text-2xl font-bold leading-none">
            {onTimeRate === null ? '—' : `${onTimeRate}%`}
          </p>
          <p className="text-[10px] text-gray-400 mt-1.5">
            {scoredWeeks === 0
              ? `Counted from ${formatDateLabelSafe(SUNDAY_RULE_START)}`
              : `${standing.onTimeWeeks} on time · ${standing.lateWeeks} late · ${standing.score} points`}
          </p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center shrink-0"><Wallet size={12} className="text-emerald-600 dark:text-emerald-300" /></div>
            <p className="stat-label">Total Deposited</p>
          </div>
          <p className="text-2xl font-bold leading-none">{standing.totalPaid.toLocaleString()}</p>
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

      </>)}

      {/* Weekly history - Monday-Sunday weeks from the switch-over on. A
          week counts as done only once every working day up to its Sunday
          is paid for; lost days are working days spent uncleared. */}
      {!isEnded && showMoney && (
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2.5 flex items-center gap-1.5"><CalendarDays size={13} /> Weekly Deposits</p>
          {standing.periods.length === 0 ? (
            <p className="text-[11px] text-gray-400">
              {!driver.start_date
                ? 'No start date set yet.'
                : `Weekly tracking starts ${formatDateLabelSafe(SUNDAY_RULE_START)} — first payment due Sunday ${standing.nextDueDate ? formatDateLabelSafe(standing.nextDueDate) : ''}.`}
            </p>
          ) : (
            <div className="space-y-1.5">
              {[...standing.periods].reverse().map((p) => {
                const style = p.state === 'open' ? DEPOSIT_TIER_STYLE.red : p.state === 'late' ? DEPOSIT_TIER_STYLE.yellow : DEPOSIT_TIER_STYLE.green;
                return (
                  <div key={p.start} className="flex items-center justify-between gap-2 text-[11px] py-1.5 border-b border-gray-50 dark:border-white/5 last:border-0">
                    <span className="text-gray-500 dark:text-gray-400">
                      {p.isStartSegment ? 'First days' : 'Week of'} {formatDateLabelSafe(p.start)} – {formatDateLabelSafe(p.end)}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
                      {depositPeriodLabel(p)}{p.clearedDate ? ` · ${formatDateLabelSafe(p.clearedDate)}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="card p-4">
        <DriverCasesList driverId={driver.id} />
      </div>

      {showMoney && (<>
      {/* Deposits */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Wallet size={13} /> Deposits</p>
            {!isEnded && driver.start_date && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-600 dark:text-brand-300 bg-brand/10 px-2 py-0.5 rounded-full">
                Pays every Sunday
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isEnded ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-500/10">
                CONTRACT TERMINATED
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${tierStyle.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tierStyle.dot}`} /> {depositStandingLabel(standing)}
              </span>
            )}
            {canEdit && !isEnded && (
              <button onClick={() => setLoggingDeposit(true)} className="btn-primary text-[11px] px-2.5 py-1.5">Log Deposit</button>
            )}
          </div>
        </div>
        {!isEnded && standing.hasStarted && (
          <div className="space-y-1 mb-2.5">
            {standing.owes > 0 && (
              <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                Owes {formatRwf(standing.owes)} for days already worked
              </p>
            )}
            {standing.weekBehind > 0 && (
              <p className={`text-[11px] font-medium ${depositRemainingColor(tier)}`}>
                Behind {formatRwf(standing.weekBehind)} on this week{standing.ruleInForce ? ' — needs to be paid in full to be cleared to drive' : ''}
              </p>
            )}
            {standing.nextDueDate && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {standing.nextDueAmount > 0
                  ? <>Due by Sunday <span className="font-medium text-gray-700 dark:text-gray-200">{formatDateLabelSafe(standing.nextDueDate)}</span>: <span className="font-medium text-gray-700 dark:text-gray-200">{formatRwf(standing.nextDueAmount)}</span>{!standing.ruleInForce && ' (switch-over)'}</>
                  : <>Already paid for the week after Sunday {formatDateLabelSafe(standing.nextDueDate)}</>}
              </p>
            )}
            {standing.paidThrough && (
              <p className="text-[10px] text-gray-400">Paid through {formatDateLabelSafe(standing.paidThrough)}</p>
            )}
          </div>
        )}
        {totalDepositCount === 0 ? (
          <p className="text-[11px] text-gray-400">No deposits logged yet.</p>
        ) : (
          <div className="space-y-1.5">
            {driverDeposits.map((dep) => {
              const through = paidThroughAfter.get(dep.id);
              const statusLabel = through ? `Through ${formatDateLabelSafe(through)}` : 'Partial';
              const statusClass = 'text-gray-500 dark:text-gray-400';
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
                    <p className={`text-[10px] ${statusClass}`}>{statusLabel}</p>
                  </div>
                </div>
              );
            })}
            {driver.initial_deposit_paid && driver.initial_deposit_date && (() => {
              const initialThrough = paidThroughAfter.get('initial');
              const initialStatusLabel = initialThrough ? `Through ${formatDateLabelSafe(initialThrough)}` : 'Partial';
              const initialStatusClass = 'text-gray-500 dark:text-gray-400';
              return (
                <div className="flex items-center justify-between gap-2 text-[11px] py-1.5 border-b border-gray-50 dark:border-white/5 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-500 dark:text-gray-400 shrink-0">{formatDateLabelSafe(driver.initial_deposit_date)}</span>
                    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full shrink-0">
                      Initial deposit
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-medium">{(driver.initial_deposit_amount ?? 0).toLocaleString()} RWF</p>
                    <p className={`text-[10px] ${initialStatusClass}`}>{initialStatusLabel}</p>
                  </div>
                </div>
              );
            })()}
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

      </>)}

      {/* Contract History */}
      {driverContractEvents.length > 0 && (
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2.5 flex items-center gap-1.5"><History size={13} /> Contract History</p>
          <div className="space-y-2">
            {driverContractEvents.map((e) => (
              <div key={e.id} className="py-1.5 border-b border-gray-50 dark:border-white/5 last:border-0">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className={`inline-flex items-center gap-1.5 text-[9px] font-medium px-2 py-0.5 rounded-full ${e.event_type === 'ended' ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10' : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'}`}>
                    {e.event_type === 'ended' ? <UserX size={10} /> : <UserCheck size={10} />}
                    {e.event_type === 'ended' ? 'Ended' : 'Reactivated'}
                  </span>
                  <span className="text-gray-400 shrink-0">{formatDateLabelSafe(e.event_date)}</span>
                </div>
                <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-1">{e.reason}</p>
                {e.details && <p className="text-[11px] text-gray-400 mt-0.5">{e.details}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

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
          deposits={driverDeposits}
          onClose={() => setLoggingDeposit(false)}
          onSaved={reload}
        />
      )}

      {endContractOpen && (
        <EndContractDrawer
          driver={driver}
          onClose={() => setEndContractOpen(false)}
          onSaved={reload}
        />
      )}

      {reactivateOpen && (
        <ReactivateDriverDrawer
          driver={driver}
          onClose={() => setReactivateOpen(false)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
