import { countWorkingDays, shiftDay, SUNDAY_RULE_START, mondayOf, DAILY_DEPOSIT_RATE } from "../_shared/depositRules.ts";
import { activeStandings, loadDeposits, loadDrivers } from "./drivers.ts";
import { KIVU_REVENUE_TYPES, loadTransactions, OPERATING_COST_TYPES, TYPE_LABEL, type TxRow } from "./finance.ts";
import { loadPlatformCars, loadVehicles } from "./operations.ts";
import { loadTickets } from "./tickets.ts";
import { loadRecentTasks } from "./workspace.ts";
import { ALL_DAYS, Block, Built, Ctx, esc, hm, MON_SAT, monthLabel, monthOf, plural, previousMonth, RuleDef, rows, rwf } from "./core.ts";

// "Money & growth" for the MD and Finance: where the money is, where it's
// leaking, and the few things to do today to make more of it. Every tip is
// computed from live data and carries its own number - nothing generic.

interface Tip { weight: number; text: string }

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 100);
const sumTx = (list: TxRow[], types: string[], dir: "in" | "out") =>
  list.filter((t) => t.status !== "rejected" && types.includes(t.type) && t.direction === dir).reduce((s, t) => s + Number(t.amount), 0);

async function snapshot(ctx: Ctx) {
  const today = ctx.today;
  const weekStart = mondayOf(today);
  const [standings, drivers, deposits, tx, vehicles, platformCars, tickets, tasks, accounts, runs, settings] = await Promise.all([
    activeStandings(ctx), loadDrivers(ctx), loadDeposits(ctx), loadTransactions(ctx), loadVehicles(ctx), loadPlatformCars(ctx), loadTickets(ctx), loadRecentTasks(ctx),
    rows<{ id: string; key: string; name: string; opening_balance: number }>(ctx.db.from("finance_accounts").select("id, key, name, opening_balance")),
    rows<{ period: string; status: string; total_amount: number }>(ctx.db.from("payroll_runs").select("period, status, total_amount").eq("period", monthOf(today))),
    rows<{ internal_payment_day: number }>(ctx.db.from("payroll_settings").select("internal_payment_day").limit(1)),
  ]);

  // Driver collections this week: what working days so far should have
  // brought in vs what was actually logged.
  let expectedWeek = 0;
  for (const r of standings) {
    const from = r.d.start_date! > weekStart ? r.d.start_date! : weekStart;
    if (from <= today) expectedWeek += countWorkingDays(from, today, r.d.rest_day) * DAILY_DEPOSIT_RATE;
  }
  const collectedWeek = deposits.filter((d) => d.paid_date >= weekStart && d.paid_date <= today).reduce((s, d) => s + d.amount, 0);
  const owes = standings.reduce((s, r) => s + r.s.owes, 0);
  const behind = standings.reduce((s, r) => s + r.s.weekBehind, 0);
  const owingDrivers = standings.filter((r) => r.s.owes > 0);
  const daysLostWeek = standings.reduce((s, r) => s + (r.s.current && r.s.current.start === weekStart ? r.s.current.daysLost : 0), 0);

  // Empty driver slots: every car can run a day and a night driver.
  const activeByCar = new Map<string, number>();
  for (const d of drivers) if (d.contract_status === "active" && d.vehicle_id) activeByCar.set(d.vehicle_id, (activeByCar.get(d.vehicle_id) ?? 0) + 1);
  const emptySlots = vehicles.reduce((s, v) => s + Math.max(0, 2 - (activeByCar.get(v.id) ?? 0)), 0);
  const idleCars = vehicles.filter((v) => !activeByCar.get(v.id));
  const applicants = drivers.filter((d) => d.contract_status === "active" && !d.vehicle_id && d.stage !== "inactive").length;

  // Money month-to-date vs the same days last month.
  const dom = Number(today.slice(8, 10));
  const prevMonth = previousMonth(today);
  const mtd = tx.filter((t) => monthOf(t.transaction_date) === monthOf(today) && t.transaction_date <= today);
  const prevMtd = tx.filter((t) => monthOf(t.transaction_date) === prevMonth && Number(t.transaction_date.slice(8, 10)) <= dom);
  const money = (list: TxRow[]) => {
    const revenue = sumTx(list, KIVU_REVENUE_TYPES, "in");
    const collections = sumTx(list, ["fleet_collection"], "in");
    const owners = sumTx(list, ["vehicle_owner_payment"], "out");
    const costs = sumTx(list, OPERATING_COST_TYPES, "out");
    return { revenue, collections, owners, costs, net: revenue + collections - owners - costs };
  };
  const now = money(mtd);
  const before = money(prevMtd);
  const costByType = new Map<string, number>();
  for (const t of mtd.filter((x) => x.status !== "rejected" && x.direction === "out" && OPERATING_COST_TYPES.includes(x.type))) costByType.set(t.type, (costByType.get(t.type) ?? 0) + Number(t.amount));
  const topCost = [...costByType].sort((a, b) => b[1] - a[1])[0];

  // Cash and what's about to go out.
  const balance = (key: string) => {
    const acc = accounts.find((a) => a.key === key);
    if (!acc) return 0;
    return Number(acc.opening_balance) + tx.filter((t) => t.account_id === acc.id && t.status !== "rejected").reduce((s, t) => s + (t.direction === "in" ? 1 : -1) * Number(t.amount), 0);
  };
  const cash = accounts.map((a) => ({ name: a.name, amount: balance(a.key) }));
  const open = tx.filter((t) => ["pending", "checked"].includes(t.status) && !(t.type === "transfer" && t.direction === "in"));
  const ownersDue7 = open.filter((t) => t.type === "vehicle_owner_payment" && t.transaction_date <= shiftDay(today, 7)).reduce((s, t) => s + Number(t.amount), 0);
  const fleetAccount = balance("bank_of_kigali");
  const waitingMd = open.filter((t) => t.status === "checked");
  const stale = open.filter((t) => t.status === "pending" && t.transaction_date <= shiftDay(today, -3));

  const payday = settings[0]?.internal_payment_day ?? 28;
  const run = runs[0];

  // Call Center and team discipline over the last 7 days.
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const recentTickets = tickets.filter((t) => t.created_at >= weekAgo);
  const solvedSpot = recentTickets.filter((t) => t.resolved_on_call && !t.outcome_kind).length;
  const contacts = recentTickets.filter((t) => !t.outcome_kind || t.outcome_kind === "info_given").length;
  const duties = tasks.filter((t) => t.recurring_task_id && t.date >= shiftDay(today, -7) && t.date < today);
  const dutiesDone = duties.filter((t) => t.completed).length;
  const branding = platformCars.filter((c) => c.branding_status === "to_contact" || c.branding_status === "scheduled").length;
  const devices = platformCars.filter((c) => c.device_status === "to_contact" || c.device_status === "agreed").length;

  return {
    today, weekStart, expectedWeek, collectedWeek, owes, behind, owingDrivers, daysLostWeek, emptySlots, idleCars, applicants,
    now, before, topCost, cash, ownersDue7, fleetAccount, waitingMd, stale, payday, run, contacts, solvedSpot, duties: duties.length, dutiesDone,
    branding, devices, activeDrivers: standings.length,
  };
}

function tips(s: Awaited<ReturnType<typeof snapshot>>): Tip[] {
  const out: Tip[] = [];
  const rate = pct(s.collectedWeek, s.expectedWeek);
  if (s.expectedWeek > 0 && rate < 95) {
    out.push({ weight: 100 - rate, text: `<b>Collections are at ${rate}%</b> of what this week's driving should have brought in (${rwf(s.collectedWeek)} of ${rwf(s.expectedWeek)}). ${plural(s.owingDrivers.length, "driver")} owe ${rwf(s.owes)} for days already worked${s.owingDrivers.length ? ` — start with ${s.owingDrivers.sort((a, b) => b.s.owes - a.s.owes).slice(0, 3).map((r) => esc(r.d.full_name)).join(", ")}` : ""}. Ask Janviere to call them before noon.` });
  } else if (s.expectedWeek > 0) {
    out.push({ weight: 1, text: `Collections are on track this week: ${rwf(s.collectedWeek)} in (${rate}% of what driving so far should bring). Keep the Sunday rhythm.` });
  }
  if (s.emptySlots > 0) {
    const weekly = s.emptySlots * DAILY_DEPOSIT_RATE * 6;
    out.push({ weight: 60 + s.emptySlots * 5, text: `<b>${plural(s.emptySlots, "driver slot")} empty</b>${s.idleCars.length ? ` (${plural(s.idleCars.length, "car")} with no driver at all: ${s.idleCars.map((v) => esc(v.plate_number)).join(", ")})` : ""} — that's about <b>${rwf(weekly)} a week</b> in driver payments we're not collecting. ${s.applicants ? `${plural(s.applicants, "driver")} without a car are waiting — place them.` : "Operations: recruit and onboard this week."}` });
  }
  if (s.daysLostWeek > 0 && s.today >= SUNDAY_RULE_START) {
    out.push({ weight: 40 + s.daysLostWeek, text: `${plural(s.daysLostWeek, "working day")} lost this week to drivers who weren't cleared — about ${rwf(s.daysLostWeek * DAILY_DEPOSIT_RATE)}. Fleet must keep uncleared drivers off the road and give the car to someone who pays.` });
  }
  if (s.ownersDue7 > 0 && s.ownersDue7 > s.fleetAccount) {
    out.push({ weight: 90, text: `<b>Owner payouts due in the next 7 days (${rwf(s.ownersDue7)}) are more than the Fleet Collection account holds (${rwf(s.fleetAccount)}).</b> Chase driver payments now or plan a transfer — late owner payouts cost us their trust and their cars.` });
  }
  if (s.waitingMd.length) {
    out.push({ weight: 50, text: `${plural(s.waitingMd.length, "payment")} (${rwf(s.waitingMd.reduce((a, t) => a + Number(t.amount), 0))}) checked by Finance and waiting for the MD's approval. Approving the same day keeps owners and suppliers paid on time.` });
  }
  if (s.stale.length) {
    out.push({ weight: 45, text: `${plural(s.stale.length, "payment")} have waited more than 3 days to be checked (${rwf(s.stale.reduce((a, t) => a + Number(t.amount), 0))}). Finance: clear them today — the older they get, the harder they are to account for.` });
  }
  if (s.now.net < 0) {
    out.push({ weight: 70, text: `<b>This month is negative so far: ${rwf(s.now.net)}.</b> ${s.topCost ? `The biggest cost is ${TYPE_LABEL[s.topCost[0]] ?? s.topCost[0]} (${rwf(s.topCost[1])}) — review it line by line.` : ""} Every expense should have a receipt and a reason.` });
  } else if (s.before.net !== 0) {
    const change = s.now.net - s.before.net;
    out.push({ weight: change < 0 ? 35 : 2, text: `Net cash flow this month: ${rwf(s.now.net)}, ${change >= 0 ? "up" : "down"} ${rwf(Math.abs(change))} on the same days last month.${change < 0 && s.topCost ? ` Biggest cost: ${TYPE_LABEL[s.topCost[0]] ?? s.topCost[0]} (${rwf(s.topCost[1])}).` : ""}` });
  }
  const dom = Number(s.today.slice(8, 10));
  if (s.payday - dom <= 3 && s.payday - dom >= 0 && (!s.run || s.run.status === "draft")) {
    out.push({ weight: 65, text: `Payday is the ${s.payday}th and this month's payroll run is ${s.run ? "still a draft" : "not prepared"}. Finance: prepare it for approval today.` });
  }
  if (s.duties >= 10) {
    const r = pct(s.dutiesDone, s.duties);
    if (r < 80) out.push({ weight: 30 + (80 - r), text: `Standing duties were done ${r}% of the time last week (${s.dutiesDone} of ${s.duties}). The morning briefing names who missed what — follow up with them directly.` });
  }
  if (s.contacts >= 10) {
    const r = pct(s.solvedSpot, s.contacts);
    if (r < 50) out.push({ weight: 20, text: `Only ${r}% of Call Center contacts were solved on the spot last week. More answers in the Script Book (MD Panel can edit cards) means fewer cases handed on.` });
  }
  if (s.branding + s.devices > 0) {
    out.push({ weight: 15, text: `${plural(s.branding, "car")} waiting for branding and ${plural(s.devices, "owner")} waiting for a device — each is extra revenue. Fleet Manager: close them this week.` });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 6);
}

function kpiTable(s: Awaited<ReturnType<typeof snapshot>>): Block["table"] {
  const vs = (a: number, b: number) => (b ? ` <span style="color:${a >= b ? "#15803d" : "#dc2626"};font-size:11px;">(${a >= b ? "+" : ""}${pct(a - b, Math.abs(b))}% vs last month)</span>` : "");
  return {
    head: ["", ""],
    rows: [
      ["Driver collections this week", `${rwf(s.collectedWeek)} of ${rwf(s.expectedWeek)} expected (${pct(s.collectedWeek, s.expectedWeek)}%)`],
      ["Owed by drivers / behind on the week", `${rwf(s.owes)} / ${rwf(s.behind)} (${s.activeDrivers} active drivers)`],
      ["Kivu revenue this month", `${rwf(s.now.revenue)}${vs(s.now.revenue, s.before.revenue)}`],
      ["Paid to owners / operating costs (month)", `${rwf(s.now.owners)} / ${rwf(s.now.costs)}`],
      ["Net cash flow this month", `<b>${rwf(s.now.net)}</b>${vs(s.now.net, s.before.net)}`],
      ["Cash", s.cash.map((c) => `${esc(c.name)}: ${rwf(c.amount)}`).join("<br>")],
      ["Owner payouts due in 7 days", `${rwf(s.ownersDue7)} (Fleet Collection account: ${rwf(s.fleetAccount)})`],
      ["Empty driver slots", s.emptySlots ? `${s.emptySlots} (≈${rwf(s.emptySlots * DAILY_DEPOSIT_RATE * 6)}/week not collected)` : "None"],
    ],
  };
}

export const moneyRules: Record<string, RuleDef> = {
  money_daily: {
    kind: "scheduled", days: MON_SAT, at: hm(7, 45),
    build: async (ctx): Promise<Built[]> => {
      const s = await snapshot(ctx);
      const t = tips(s);
      return [{
        subject: `Money & growth: ${pct(s.collectedWeek, s.expectedWeek)}% collected this week · net ${rwf(s.now.net)} this month${s.emptySlots ? ` · ${s.emptySlots} empty slots` : ""}`,
        heading: "Money & growth brief",
        intro: "Where the money is today, where it's leaking, and what to do about it — for the MD and Finance.",
        blocks: [
          { table: kpiTable(s) },
          { heading: "What to do today", text: t.length ? t.map((x, i) => `${i + 1}. ${x.text}`).join("<br><br>") : "Nothing urgent — every number is on track." },
        ],
        inApp: "Money & growth brief is ready",
      }];
    },
  },

  money_monthly: {
    kind: "scheduled", days: ALL_DAYS, at: hm(9),
    build: async (ctx, force): Promise<Built[]> => {
      if (!force && ctx.today.slice(8, 10) !== "01") return [];
      const tx = await loadTransactions(ctx);
      const last = previousMonth(ctx.today);
      const before = previousMonth(`${last}-15`);
      const m = (ym: string) => {
        const list = tx.filter((t) => monthOf(t.transaction_date) === ym);
        const revenue = sumTx(list, KIVU_REVENUE_TYPES, "in");
        const collections = sumTx(list, ["fleet_collection"], "in");
        const owners = sumTx(list, ["vehicle_owner_payment"], "out");
        const costs = sumTx(list, OPERATING_COST_TYPES, "out");
        const byCost = OPERATING_COST_TYPES.map((k) => [k, sumTx(list, [k], "out")] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        return { revenue, collections, owners, costs, net: revenue + collections - owners - costs, byCost };
      };
      const a = m(last);
      const b = m(before);
      const diff = (x: number, y: number) => `${rwf(x)}${y ? ` <span style="color:${x >= y ? "#15803d" : "#dc2626"};font-size:11px;">(${x >= y ? "+" : "−"}${rwf(Math.abs(x - y))})</span>` : ""}`;
      const s = await snapshot(ctx);
      const t = tips(s);
      return [{
        subject: `${monthLabel(last)} in numbers: net ${rwf(a.net)}`,
        heading: `${monthLabel(last)} — month in review`,
        intro: `How ${monthLabel(last)} went, compared with ${monthLabel(before)}. Close the books: reconcile every account and make sure each expense has its receipt.`,
        blocks: [
          {
            table: {
              head: ["", monthLabel(last)],
              rows: [
                ["Kivu revenue (fees, margin)", diff(a.revenue, b.revenue)],
                ["Driver collections", diff(a.collections, b.collections)],
                ["Paid to car owners", diff(a.owners, b.owners)],
                ["Operating costs", diff(a.costs, b.costs)],
                ["<b>Net cash flow</b>", `<b>${diff(a.net, b.net)}</b>`],
              ],
            },
          },
          ...(a.byCost.length ? [{ heading: "Where the costs went", table: { head: ["Cost", "Amount"], rows: a.byCost.map(([k, v]) => [TYPE_LABEL[k] ?? k, rwf(v)]) } }] : []),
          { heading: "Focus for this month", text: t.length ? t.map((x, i) => `${i + 1}. ${x.text}`).join("<br><br>") : "Keep going — nothing is off track." },
        ],
        inApp: `${monthLabel(last)} in numbers is ready`,
      }];
    },
  },
};

// The weekly report reuses the same tips.
export async function weeklyTips(ctx: Ctx): Promise<string[]> {
  return tips(await snapshot(ctx)).map((t) => t.text);
}
