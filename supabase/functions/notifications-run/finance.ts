import { shiftDay, daysUntilDate } from "../_shared/depositRules.ts";
import { loadDeposits } from "./drivers.ts";
import {
  ALL_DAYS, Block, Built, cached, Ctx, day, esc, hm, monthLabel, monthOf, plural, previousMonth, RuleDef, rows, rwf,
} from "./core.ts";

// Finance (Phase 2): Rodrigue's morning to-do list, payroll-day
// reminders, month-start reconciliation, and the payroll-removal
// hand-off between Finance and the MD.

export interface TxRow {
  id: string; reference: string | null; type: string; direction: "in" | "out"; amount: number; transaction_date: string;
  description: string | null; counterparty: string | null; status: string; account_id: string; transfer_group_id: string | null;
}

export const TYPE_LABEL: Record<string, string> = {
  revenue: "Revenue", fleet_collection: "Fleet collection", vehicle_owner_payment: "Owner payout", payroll: "Payroll",
  supplier_payment: "Supplier payment", transfer: "Transfer", expense_claim: "Expense claim", other: "Other",
  onboarding_fee: "Onboarding fee", management_margin: "Management margin", driver_payroll: "Driver payroll",
};
export const KIVU_REVENUE_TYPES = ["revenue", "management_margin", "onboarding_fee"];
export const OPERATING_COST_TYPES = ["supplier_payment", "payroll", "expense_claim", "other", "driver_payroll"];
// 'approved' is treated as settled: paying a payroll run records its
// ledger rows as approved and stops there, and balances count every
// status, so only items still waiting on a person are chased.
const OPEN = ["pending", "checked"];

export function loadTransactions(ctx: Ctx) {
  return cached(ctx, "transactions", () => rows<TxRow>(ctx.db.from("finance_transactions").select(
    "id, reference, type, direction, amount, transaction_date, description, counterparty, status, account_id, transfer_group_id",
  )));
}

// Open items needing a human, one row per real-world payment (a
// transfer's matching 'in' leg is the same movement, so it's dropped).
export async function openTransactions(ctx: Ctx) {
  return (await loadTransactions(ctx)).filter((t) => OPEN.includes(t.status) && !(t.type === "transfer" && t.direction === "in"));
}

export function txRow(t: TxRow, today: string): string[] {
  const late = daysUntilDate(t.transaction_date, today);
  return [
    esc(t.reference ?? "—"),
    `${TYPE_LABEL[t.type] ?? t.type}${t.counterparty || t.description ? ` · ${esc(t.counterparty ?? t.description ?? "")}` : ""}`,
    rwf(t.amount),
    `${day(t.transaction_date)}${late > 0 ? ` <span style="color:#dc2626;">(${plural(late, "day")} overdue)</span>` : ""}`,
  ];
}

export function txTable(list: TxRow[], today: string, cap = 25): Block["table"] {
  const sorted = [...list].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
  const shown = sorted.slice(0, cap).map((t) => txRow(t, today));
  if (sorted.length > cap) shown.push(["", `+ ${sorted.length - cap} more in Kivu Daily`, "", ""]);
  return { head: ["Ref", "What", "Amount", "Date"], rows: shown };
}

interface PayrollSettings { internal_payment_day: number }
interface PayrollRun { period: string; status: string; total_amount: number }
interface PayrollEmployee { full_name: string; monthly_salary: number; status: string; pending_removal: boolean }

const RUN_NEXT_STEP: Record<string, string> = {
  draft: "Finance: finish and check the payroll run, then send it to the MD for approval.",
  checked: "MD: the payroll run is checked and waiting for your approval.",
  approved: "Finance: payroll is approved — pay everyone and mark the run as paid.",
};

async function payrollReminder(ctx: Ctx, force: boolean): Promise<Built[]> {
  const [settings] = await rows<PayrollSettings>(ctx.db.from("payroll_settings").select("internal_payment_day").limit(1));
  const payday = settings?.internal_payment_day ?? 28;
  const dom = Number(ctx.today.slice(8, 10));
  const isPayday = dom === payday;
  if (!force && !isPayday && dom !== payday - 3) return [];

  const period = monthOf(ctx.today);
  const paydayDate = `${period}-${String(payday).padStart(2, "0")}`;
  const [runs, employees, tx] = await Promise.all([
    rows<PayrollRun>(ctx.db.from("payroll_runs").select("period, status, total_amount").eq("period", period)),
    rows<PayrollEmployee>(ctx.db.from("payroll_employees").select("full_name, monthly_salary, status, pending_removal")),
    openTransactions(ctx),
  ]);
  const run = runs[0];
  if (!force && run?.status === "paid") return [];
  const active = employees.filter((e) => e.status === "active");
  const salaryTotal = active.reduce((s, e) => s + Number(e.monthly_salary ?? 0), 0);
  const driverPayroll = tx.filter((t) => t.type === "driver_payroll" && monthOf(t.transaction_date) === period);

  const blocks: Block[] = [{
    heading: "Staff payroll",
    text: run
      ? `Payroll run for ${monthLabel(period)}: <b>${run.status}</b>, total ${rwf(run.total_amount)}.<br>${RUN_NEXT_STEP[run.status] ?? "Payroll is paid."}`
      : `<b>No payroll run has been prepared for ${monthLabel(period)} yet.</b> Finance: create it from the Payroll page. ${plural(active.length, "active employee")} on payroll, ${rwf(salaryTotal)} a month in total.`,
  }];
  if (driverPayroll.length > 0) {
    blocks.push({ heading: "Driver payroll still open this month", table: txTable(driverPayroll, ctx.today) });
  }
  return [{
    subject: isPayday ? `Payday today: ${monthLabel(period)} payroll` : `Payroll due in 3 days (${day(paydayDate)})`,
    heading: isPayday ? "Payday is today" : `Payroll is due ${longDayShort(paydayDate)}`,
    intro: isPayday
      ? `Today is the ${ordinal(payday)} — staff should be paid today.`
      : `Staff are paid on the ${ordinal(payday)} of each month — that's in 3 days.`,
    blocks,
    inApp: isPayday ? "Payday today" : `Payroll due ${day(paydayDate)}`,
  }];
}

const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const longDayShort = (d: string) => `on ${day(d)}`;

export const financeRules: Record<string, RuleDef> = {
  finance_daily_digest: {
    kind: "scheduled", days: ALL_DAYS, at: hm(8),
    build: async (ctx) => {
      const [open, deposits] = await Promise.all([openTransactions(ctx), loadDeposits(ctx)]);
      const horizon = shiftDay(ctx.today, 3);
      const due = open.filter((t) => t.transaction_date <= horizon);
      const later = open.filter((t) => t.transaction_date > horizon);
      const pendingDeposits = deposits.filter((d) => d.status === "pending");
      const toCheck = due.filter((t) => t.status === "pending");
      const withMd = due.filter((t) => t.status === "checked");
      if (due.length === 0 && pendingDeposits.length === 0) return [];
      const overdue = due.filter((t) => t.transaction_date < ctx.today).length;

      const blocks: Block[] = [];
      if (toCheck.length) blocks.push({ heading: `To check (${toCheck.length})`, table: txTable(toCheck, ctx.today) });
      if (withMd.length) blocks.push({ heading: `Waiting for the MD's approval (${withMd.length})`, text: `${rwf(withMd.reduce((s, t) => s + t.amount, 0))} in total — nothing for you to do until the MD approves.` });
      if (pendingDeposits.length) blocks.push({ heading: "Driver deposits", text: `${plural(pendingDeposits.length, "deposit")} (${rwf(pendingDeposits.reduce((s, d) => s + d.amount, 0))}) waiting for your confirmation on Deposit Confirmations.` });
      return [{
        subject: `Finance today: ${plural(due.length, "item")} due${overdue ? `, ${overdue} overdue` : ""}${pendingDeposits.length ? `, ${plural(pendingDeposits.length, "deposit")} to confirm` : ""}`,
        heading: "Finance — what needs doing today",
        intro: "Everything waiting on you that's dated today, overdue, or due in the next 3 days.",
        blocks,
        footnote: later.length ? `${plural(later.length, "more open item")} (${rwf(later.reduce((s, t) => s + t.amount, 0))}) are dated after ${day(horizon)}.` : undefined,
        inApp: `Finance today: ${plural(due.length, "item")} due${overdue ? `, ${overdue} overdue` : ""}`,
      }];
    },
  },

  payroll_reminder: { kind: "scheduled", days: ALL_DAYS, at: hm(8), build: payrollReminder },

  bank_reconciliation: {
    kind: "scheduled", days: ALL_DAYS, at: hm(8),
    build: async (ctx, force) => {
      if (!force && ctx.today.slice(8, 10) !== "01") return [];
      const period = previousMonth(ctx.today);
      const [accounts, recs] = await Promise.all([
        rows<{ id: string; name: string; bank_name: string | null }>(ctx.db.from("finance_accounts").select("id, name, bank_name").order("name")),
        rows<{ account_id: string }>(ctx.db.from("finance_reconciliations").select("account_id").eq("period", period)),
      ]);
      const missing = accounts.filter((a) => !recs.some((r) => r.account_id === a.id));
      if (missing.length === 0) return [];
      return [{
        subject: `Reconcile ${monthLabel(period)}: ${plural(missing.length, "account")} to check against the bank`,
        heading: `Month-end reconciliation — ${monthLabel(period)}`,
        intro: `A new month has started. Please compare each account's ${monthLabel(period)} closing balance in Kivu Daily with the bank statement and record it on the Reconciliation page.`,
        table: { head: ["Account", "Bank"], rows: missing.map((a) => [esc(a.name), esc(a.bank_name ?? "—")]) },
        inApp: `Reconcile ${monthLabel(period)}: ${plural(missing.length, "account")}`,
      }];
    },
  },

  payroll_removal_requested: {
    kind: "event",
    sample: async () => ({ employee_name: "Example Employee", position: "Driver supervisor", monthly_salary: 300000, requested_by_name: "Finance" }),
    build: async (p) => ({
      subject: `Confirm removal from payroll: ${p.employee_name}`,
      heading: "A payroll removal needs your confirmation",
      intro: `${esc(String(p.requested_by_name ?? "Finance"))} asked to remove <b>${esc(String(p.employee_name))}</b>${p.position ? ` (${esc(String(p.position))})` : ""}${p.monthly_salary ? `, ${rwf(Number(p.monthly_salary))} a month` : ""} from payroll.`
        + "<br><br>Nothing is removed until you confirm it on the Payroll page — or cancel the request there.",
      inApp: `Confirm payroll removal: ${p.employee_name}`,
    }),
  },

  payroll_removal_decided: {
    kind: "event",
    sample: async () => ({ employee_name: "Example Employee", decision: "confirmed", decided_by_name: "Frabrice" }),
    build: async (p) => {
      const confirmed = p.decision === "confirmed";
      return {
        subject: `Payroll removal ${confirmed ? "confirmed" : "declined"}: ${p.employee_name}`,
        heading: confirmed ? "Payroll removal confirmed" : "Payroll removal declined",
        intro: confirmed
          ? `${esc(String(p.decided_by_name ?? "The MD"))} confirmed your request — <b>${esc(String(p.employee_name))}</b> has been removed from payroll.`
          : `${esc(String(p.decided_by_name ?? "The MD"))} declined your request — <b>${esc(String(p.employee_name))}</b> stays on payroll.`,
        inApp: `Payroll removal ${confirmed ? "confirmed" : "declined"}: ${p.employee_name}`,
      };
    },
  },
};
