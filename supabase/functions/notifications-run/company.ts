import { shiftDay, sundayOf, SUNDAY_RULE_START } from "../_shared/depositRules.ts";
import { activeStandings, car, loadDeposits, loadDrivers } from "./drivers.ts";
import { KIVU_REVENUE_TYPES, loadTransactions, openTransactions, OPERATING_COST_TYPES, txTable, type TxRow } from "./finance.ts";
import { carsWithoutDriver, loadCalls, loadFlaggedStories } from "./operations.ts";
import { loadRecentTasks } from "./workspace.ts";
import { isOverdue, loadTickets, UNRESOLVED, waitingFor } from "./tickets.ts";
import {
  activeEmployees, ALL_DAYS, Block, Ctx, day, esc, hm, lastWeek, longDay, monthOf, personName, plural, RuleDef, rows, rwf,
} from "./core.ts";

// The MD's view (Phase 2): a 07:30 morning briefing across the whole
// company, and a Monday report on the week that just ended.

function teamTable(ctx: Ctx, tasks: { user_id: string; completed: boolean }[]) {
  return {
    head: ["Person", "Department", "Done", "Rate"],
    rows: activeEmployees(ctx)
      .map((p) => {
        const mine = tasks.filter((t) => t.user_id === p.id);
        const done = mine.filter((t) => t.completed).length;
        return { p, set: mine.length, done };
      })
      .sort((a, b) => (b.set ? b.done / b.set : -1) - (a.set ? a.done / a.set : -1))
      .map(({ p, set, done }) => [
        esc(p.full_name.trim()), esc(p.department?.name ?? "—"),
        set ? `${done} of ${set}` : '<span style="color:#dc2626;">No tasks set</span>',
        set ? `${Math.round((done / set) * 100)}%` : "—",
      ]),
  };
}

const sum = (list: TxRow[], types: string[], dir: "in" | "out") =>
  list.filter((t) => types.includes(t.type) && t.direction === dir).reduce((s, t) => s + Number(t.amount), 0);

export const companyRules: Record<string, RuleDef> = {
  md_daily_digest: {
    kind: "scheduled", days: ALL_DAYS, at: hm(7, 30),
    build: async (ctx) => {
      const yesterday = shiftDay(ctx.today, -1);
      const [open, standings, deposits, tasks, idle, flagged, calls, removals, runs] = await Promise.all([
        openTransactions(ctx), activeStandings(ctx), loadDeposits(ctx), loadRecentTasks(ctx), carsWithoutDriver(ctx),
        loadFlaggedStories(ctx), loadCalls(ctx),
        rows<{ full_name: string }>(ctx.db.from("payroll_employees").select("full_name").eq("pending_removal", true)),
        rows<{ status: string; total_amount: number }>(ctx.db.from("payroll_runs").select("status, total_amount").eq("period", monthOf(ctx.today))),
      ]);
      const blocks: Block[] = [];

      // Things only the MD can unblock come first.
      const toApprove = open.filter((t) => t.status === "checked");
      const waiting: string[] = [];
      if (runs[0]?.status === "checked") waiting.push(`This month's payroll run (${rwf(runs[0].total_amount)}) is checked and needs your approval.`);
      if (removals.length) waiting.push(`Payroll removal${removals.length > 1 ? "s" : ""} to confirm: ${removals.map((r) => esc(r.full_name)).join(", ")}.`);
      if (toApprove.length || waiting.length) {
        blocks.push({
          heading: "Waiting on you",
          text: [toApprove.length ? `${plural(toApprove.length, "payment")} checked by Finance and waiting for your approval (${rwf(toApprove.reduce((s, t) => s + t.amount, 0))}).` : "", ...waiting].filter(Boolean).join("<br>"),
          table: toApprove.length ? txTable(toApprove, ctx.today, 10) : undefined,
        });
      }

      const blocked = standings.filter((r) => !r.s.isCleared);
      const owed = blocked.reduce((s, r) => s + r.s.owedNow, 0);
      const dueSunday = standings.filter((r) => r.s.nextDueAmount > 0);
      const dueDate = standings[0]?.s.nextDueDate ?? sundayOf(ctx.today);
      blocks.push({
        heading: "Driver payments",
        text: (ctx.today >= SUNDAY_RULE_START
          ? `<b>${standings.length - blocked.length} of ${standings.length}</b> drivers are cleared to drive.${blocked.length ? ` ${plural(blocked.length, "driver")} owe ${rwf(owed)}: ${blocked.map((r) => esc(r.d.full_name)).join(", ")}.` : ""}`
          : `${plural(blocked.length, "driver")} behind on days already driven (${rwf(owed)}).`)
          + `<br>Due by ${day(dueDate)}: ${rwf(dueSunday.reduce((s, r) => s + r.s.nextDueAmount, 0))} from ${plural(dueSunday.length, "driver")}.`,
      });

      const pendingDeposits = deposits.filter((d) => d.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
      const overdue = open.filter((t) => t.transaction_date < ctx.today);
      blocks.push({
        heading: "Finance",
        text: [
          pendingDeposits.length ? `${plural(pendingDeposits.length, "driver deposit")} waiting for Finance to confirm (oldest logged ${day(pendingDeposits[0].created_at.slice(0, 10))}).` : "All driver deposits are confirmed.",
          overdue.length ? `${plural(overdue.length, "payment")} past their date and not yet posted (${rwf(overdue.reduce((s, t) => s + t.amount, 0))}).` : "No overdue payments.",
        ].join("<br>"),
      });

      const yTasks = tasks.filter((t) => t.date === yesterday);
      blocks.push({
        heading: `Team yesterday (${day(yesterday)})`,
        ...(yTasks.length ? { table: teamTable(ctx, yTasks) } : { text: "Nobody logged tasks yesterday." }),
      });

      const tickets = await loadTickets(ctx);
      const openTickets = tickets.filter((t) => UNRESOLVED.includes(t.status));
      const overdueTickets = openTickets.filter((t) => isOverdue(t));
      const yTickets = tickets.filter((t) => new Date(new Date(t.created_at).getTime() + 2 * 3600000).toISOString().slice(0, 10) === yesterday);
      blocks.push({
        heading: "Call Center tickets",
        text: [
          `Yesterday: ${plural(yTickets.length, "call")} logged, ${yTickets.filter((t) => t.resolved_on_call).length} solved on the call.`,
          `${plural(openTickets.length, "ticket")} open${openTickets.filter((t) => t.priority === "urgent").length ? ` (${openTickets.filter((t) => t.priority === "urgent").length} urgent)` : ""}${overdueTickets.length ? ` — <b style="color:#dc2626;">${overdueTickets.length} overdue</b>:` : "."}`,
        ].join("<br>"),
        table: overdueTickets.length ? {
          head: ["Ticket", "Assigned to", "Issue", "Waiting"],
          rows: overdueTickets.map((t) => [`${esc(t.reference)}${t.priority === "urgent" ? " (urgent)" : ""}`, esc(personName(ctx, t.assignee_id)), esc(t.caller_name), waitingFor(t)]),
        } : undefined,
      });

      const openFlags = flagged.filter((s) => s.status !== "done");
      const yCalls = calls.filter((c) => c.created_at.slice(0, 10) === yesterday).length;
      blocks.push({
        heading: "Operations",
        text: [
          idle.length ? `Cars without a driver: ${idle.map((v) => esc(v.plate_number)).join(", ")}.` : "Every car has a driver.",
          `${plural(openFlags.length, "issue")} flagged to IT still open.`,
          `${plural(yCalls, "call")} logged by Call Center yesterday.`,
        ].join("<br>"),
      });

      return [{
        subject: `Kivu Ride today — ${blocked.length ? `${plural(blocked.length, "driver")} ${ctx.today >= SUNDAY_RULE_START ? "not cleared" : "behind on payments"}` : "all drivers paid up"}${toApprove.length ? `, ${toApprove.length} to approve` : ""}`,
        heading: `Good morning — ${longDay(ctx.today)}`,
        intro: "Your briefing on the whole company.",
        blocks,
        inApp: "Your morning briefing is ready",
      }];
    },
  },

  md_weekly_report: {
    kind: "scheduled", days: [1], at: hm(8),
    build: async (ctx) => {
      const week = lastWeek(ctx.today);
      const inWeek = (d: string) => d >= week.start && d <= week.end;
      const [tx, deposits, drivers, standings, tasks, calls, ended] = await Promise.all([
        loadTransactions(ctx), loadDeposits(ctx), loadDrivers(ctx), activeStandings(ctx), loadRecentTasks(ctx), loadCalls(ctx),
        rows<{ driver_id: string; event_type: string; reason: string | null }>(
          ctx.db.from("driver_contract_events").select("driver_id, event_type, reason").gte("event_date", week.start).lte("event_date", week.end),
        ),
      ]);
      const blocks: Block[] = [];

      const wTx = tx.filter((t) => t.status !== "rejected" && inWeek(t.transaction_date));
      const revenue = sum(wTx, KIVU_REVENUE_TYPES, "in");
      const fleetIn = sum(wTx, ["fleet_collection"], "in");
      const ownersOut = sum(wTx, ["vehicle_owner_payment"], "out");
      const costs = sum(wTx, OPERATING_COST_TYPES, "out");
      blocks.push({
        heading: "Money",
        table: {
          head: ["", "Amount"],
          rows: [
            ["Kivu revenue (fees, margin)", rwf(revenue)],
            ["Driver collections", rwf(fleetIn)],
            ["Paid to car owners", rwf(ownersOut)],
            ["Operating costs", rwf(costs)],
            ["<b>Net cash flow</b>", `<b>${rwf(revenue + fleetIn - ownersOut - costs)}</b>`],
          ],
        },
        text: "Everything recorded for the week except rejected entries, including items not yet posted.",
      });

      const wDeposits = deposits.filter((d) => inWeek(d.paid_date));
      let driverText = `${plural(wDeposits.length, "weekly payment")} logged, ${rwf(wDeposits.reduce((s, d) => s + d.amount, 0))} in total (first deposits are counted in Driver collections above, not here).`;
      if (week.start >= SUNDAY_RULE_START) {
        const results = standings.map((r) => ({ r, p: r.s.periods.find((p) => p.start === week.start && !p.isStartSegment) })).filter((x) => x.p);
        const onTime = results.filter((x) => x.p!.state === "on_time").length;
        const late = results.filter((x) => x.p!.state !== "on_time").sort((a, b) => b.p!.daysLost - a.p!.daysLost);
        driverText += `<br><b>${onTime} of ${results.length}</b> drivers paid on time.`;
        if (late.length) blocks.push({
          heading: "Driver payments",
          text: driverText,
          table: { head: ["Driver", "Car", "Days lost", "Paid on"], rows: late.map((x) => [esc(x.r.d.full_name), esc(car(x.r.d)), String(x.p!.daysLost), x.p!.clearedDate ? day(x.p!.clearedDate) : "Not yet"]) },
        });
        else blocks.push({ heading: "Driver payments", text: driverText });
      } else {
        blocks.push({ heading: "Driver payments", text: driverText });
      }

      const started = drivers.filter((d) => d.start_date && inWeek(d.start_date));
      const changes = [
        started.length ? `New drivers: ${started.map((d) => esc(d.full_name)).join(", ")}.` : "",
        ...ended.map((e) => `${e.event_type === "ended" ? "Contract ended" : "Reactivated"}: ${esc(drivers.find((d) => d.id === e.driver_id)?.full_name ?? "a driver")}${e.reason ? ` (${esc(e.reason)})` : ""}.`),
      ].filter(Boolean);
      if (changes.length) blocks.push({ heading: "Driver changes", text: changes.join("<br>") });

      const wTasks = tasks.filter((t) => inWeek(t.date));
      blocks.push({ heading: "Team", ...(wTasks.length ? { table: teamTable(ctx, wTasks) } : { text: "Nobody logged tasks last week." }) });

      const wCalls = calls.filter((c) => inWeek(c.created_at.slice(0, 10)));
      const byCaller = new Map<string, number>();
      for (const c of wCalls) byCaller.set(personName(ctx, c.caller_id), (byCaller.get(personName(ctx, c.caller_id)) ?? 0) + 1);
      blocks.push({ heading: "Call Center", text: wCalls.length ? `${plural(wCalls.length, "call")} logged — ${[...byCaller].map(([n, c]) => `${esc(n)}: ${c}`).join(", ")}.` : "No calls logged." });

      return [{
        subject: `Week of ${day(week.start)}: net ${rwf(revenue + fleetIn - ownersOut - costs)}, ${plural(wDeposits.length, "weekly payment")}`,
        heading: `Your week in review — ${day(week.start)} to ${day(week.end)}`,
        intro: "How the company did last week.",
        blocks,
        inApp: "Your weekly report is ready",
      }];
    },
  },
};
