import { shiftDay, sundayOf, SUNDAY_RULE_START } from "../_shared/depositRules.ts";
import { activeStandings, car, loadDeposits, loadDrivers } from "./drivers.ts";
import { KIVU_REVENUE_TYPES, loadTransactions, openTransactions, OPERATING_COST_TYPES, txTable, type TxRow } from "./finance.ts";
import { carsWithoutDriver, loadCalls, loadFlaggedStories } from "./operations.ts";
import { loadRecentTasks } from "./workspace.ts";
import { hours, IN_TYPES, loadShifts, OUT_TYPES } from "./shifts.ts";
import { weeklyTips } from "./money.ts";
import { CATEGORY_LABEL, isOverdue, isResponseOverdue, loadTickets, UNRESOLVED, waitingFor } from "./tickets.ts";
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
      const owed = standings.reduce((s, r) => s + r.s.owes, 0);
      const behindWeek = standings.reduce((s, r) => s + r.s.weekBehind, 0);
      const dueSunday = standings.filter((r) => r.s.nextDueAmount > 0);
      const dueDate = standings[0]?.s.nextDueDate ?? sundayOf(ctx.today);
      blocks.push({
        heading: "Driver payments",
        stats: [
          { label: "Cleared to drive", value: `${standings.length - blocked.length} / ${standings.length}`, tone: blocked.length ? "danger" : "good" },
          { label: "Owed (days driven)", value: rwf(owed), tone: owed > 0 ? "danger" : undefined },
          { label: "Behind this week", value: rwf(behindWeek), tone: behindWeek > 0 ? "warning" : undefined },
          { label: `Due by ${day(dueDate)}`, value: rwf(dueSunday.reduce((s, r) => s + r.s.nextDueAmount, 0)), sub: plural(dueSunday.length, "driver") },
        ],
        text: blocked.length ? `Not cleared: ${blocked.map((r) => esc(r.d.full_name)).join(", ")}. The full list is in "Driver payments this morning".` : undefined,
      });

      const pendingDeposits = deposits.filter((d) => d.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
      const overdue = open.filter((t) => t.transaction_date < ctx.today);
      blocks.push({
        heading: "Finance",
        stats: [
          { label: "Deposits to confirm", value: String(pendingDeposits.length), sub: pendingDeposits.length ? `oldest logged ${day(pendingDeposits[0].created_at.slice(0, 10))}` : "all confirmed", tone: pendingDeposits.length ? "warning" : "good" },
          { label: "Payments past due", value: String(overdue.length), sub: overdue.length ? rwf(overdue.reduce((s, t) => s + t.amount, 0)) : "none", tone: overdue.length ? "danger" : "good" },
        ],
      });

      const yTasks = tasks.filter((t) => t.date === yesterday);
      // Standing duties are the accountability line: missed ones by name.
      const yDuties = yTasks.filter((t) => t.recurring_task_id);
      const missed = yDuties.filter((t) => !t.completed);
      const missedBy = new Map<string, string[]>();
      for (const t of missed) missedBy.set(personName(ctx, t.user_id), [...(missedBy.get(personName(ctx, t.user_id)) ?? []), t.title]);
      blocks.push({
        heading: `Team yesterday (${day(yesterday)})`,
        stats: yDuties.length ? [
          { label: "Standing duties done", value: `${yDuties.length - missed.length} / ${yDuties.length}`, tone: missed.length ? "warning" : "good" },
          { label: "People who missed one", value: String(missedBy.size), tone: missedBy.size ? "danger" : "good" },
        ] : undefined,
        ...(yTasks.length ? { table: teamTable(ctx, yTasks) } : { text: "Nobody logged tasks yesterday." }),
      });
      if (missedBy.size) blocks.push({
        heading: "Standing duties missed yesterday",
        table: { head: ["Person", "Missed"], rows: [...missedBy].map(([who, titles]) => [`<b>${esc(who)}</b>`, titles.map(esc).join("<br>")]), tones: [...missedBy].map(() => "danger" as const) },
      });

      const tickets = await loadTickets(ctx);
      const openTickets = tickets.filter((t) => UNRESOLVED.includes(t.status));
      const overdueTickets = openTickets.filter((t) => isOverdue(t) || isResponseOverdue(t));
      const unackedEmergencies = tickets.filter((t) => t.priority === "emergency" && !t.md_acknowledged_at && t.status !== "closed");
      const yTickets = tickets.filter((t) => new Date(new Date(t.created_at).getTime() + 2 * 3600000).toISOString().slice(0, 10) === yesterday);
      blocks.push({
        heading: "Call Center cases",
        text: [
          unackedEmergencies.length ? `<b style="color:#7f1d1d;">${plural(unackedEmergencies.length, "emergency", "emergencies")} waiting for your acknowledgement: ${unackedEmergencies.map((t) => esc(t.reference)).join(", ")}.</b>` : "",
          `Yesterday: ${plural(yTickets.length, "contact")} logged, ${yTickets.filter((t) => t.resolved_on_call).length} solved on the call.`,
          `${plural(openTickets.length, "case")} open${openTickets.filter((t) => t.priority !== "normal").length ? ` (${openTickets.filter((t) => t.priority !== "normal").length} urgent or emergency)` : ""}${overdueTickets.length ? ` — <b style="color:#dc2626;">${overdueTickets.length} late</b>:` : "."}`,
        ].filter(Boolean).join("<br>"),
        table: overdueTickets.length ? {
          head: ["Case", "Assigned to", "Caller", "Why late"],
          rows: overdueTickets.map((t) => [`${esc(t.reference)}${t.priority !== "normal" ? ` (${t.priority})` : ""}`, esc(personName(ctx, t.assignee_id)), esc(t.caller_name),
            isResponseOverdue(t) ? `No response in ${waitingFor({ ...t, created_at: t.assigned_at ?? t.created_at })}` : `Unresolved for ${waitingFor(t)}`]),
        } : undefined,
      });

      const openFlags = flagged.filter((s) => s.status !== "done");
      const yCalls = calls.filter((c) => c.created_at.slice(0, 10) === yesterday).length;
      blocks.push({
        heading: "Operations",
        stats: [
          { label: "Cars without a driver", value: String(idle.length), tone: idle.length ? "warning" : "good" },
          { label: "IT issues open", value: String(openFlags.length) },
          { label: "Driver calls yesterday", value: String(yCalls) },
        ],
        text: idle.length ? `Cars without a driver: ${idle.map((v) => esc(v.plate_number)).join(", ")}.` : undefined,
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
      const wDuties = wTasks.filter((t) => t.recurring_task_id);
      blocks.push({
        heading: "Team",
        text: wDuties.length ? `Standing duties done last week: <b>${Math.round((wDuties.filter((t) => t.completed).length / wDuties.length) * 100)}%</b> (${wDuties.filter((t) => t.completed).length} of ${wDuties.length}). Each person's rate is below — "Done" includes standing duties.` : undefined,
        ...(wTasks.length ? { table: teamTable(ctx, wTasks) } : { text: "Nobody logged tasks last week." }),
      });

      const wCalls = calls.filter((c) => inWeek(c.created_at.slice(0, 10)));
      const byCaller = new Map<string, number>();
      for (const c of wCalls) byCaller.set(personName(ctx, c.caller_id), (byCaller.get(personName(ctx, c.caller_id)) ?? 0) + 1);
      // Inbound desk (tickets) + outbound driver calls.
      const kigaliDay = (iso: string) => new Date(new Date(iso).getTime() + 2 * 3600000).toISOString().slice(0, 10);
      const allTickets = await loadTickets(ctx);
      const wTickets = allTickets.filter((t) => inWeek(kigaliDay(t.created_at)));
      const onCall = wTickets.filter((t) => t.resolved_on_call).length;
      const cases = wTickets.filter((t) => !t.resolved_on_call);
      const resolvedInWeek = allTickets.filter((t) => t.resolved_at && !t.resolved_on_call && inWeek(kigaliDay(t.resolved_at)));
      const avgHours = resolvedInWeek.length
        ? resolvedInWeek.reduce((s, t) => s + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 3600000, 0) / resolvedInWeek.length
        : null;
      const lateResponse = cases.filter((t) => {
        const start = new Date(t.assigned_at ?? t.created_at).getTime();
        const first = t.first_response_at ? new Date(t.first_response_at).getTime() : Date.now();
        return t.priority !== "emergency" && first - start > 2 * 3600000;
      }).length;
      const topics = new Map<string, number>();
      for (const t of wTickets) topics.set(t.situation ?? CATEGORY_LABEL[t.category] ?? t.category, (topics.get(t.situation ?? CATEGORY_LABEL[t.category] ?? t.category) ?? 0) + 1);
      const top = [...topics].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const closedWeek = allTickets.filter((t) => t.satisfaction && t.resolved_at && inWeek(kigaliDay(t.resolved_at)));
      const sat = (k: string) => closedWeek.filter((t) => t.satisfaction === k).length;
      const emergenciesWeek = wTickets.filter((t) => t.priority === "emergency").length;
      blocks.push({
        heading: "Call Center",
        text: [
          wTickets.length
            ? `<b>${plural(wTickets.length, "contact")}</b> logged — ${onCall} solved on the spot (${Math.round((onCall / wTickets.length) * 100)}%), ${plural(cases.length, "case")} handed on${emergenciesWeek ? `, <b style="color:#7f1d1d;">${plural(emergenciesWeek, "emergency", "emergencies")}</b>` : ""}.`
            : "No inbound contacts logged.",
          resolvedInWeek.length ? `${plural(resolvedInWeek.length, "case")} resolved, on average ${avgHours! < 24 ? `${Math.round(avgHours!)} h` : `${(avgHours! / 24).toFixed(1)} days`} after the call.` : "",
          cases.length ? `Two-hour response standard: ${cases.length - lateResponse} of ${cases.length} met it${lateResponse ? ` — <b style="color:#dc2626;">${lateResponse} missed</b>` : ""}.` : "",
          top.length ? `Top reasons: ${top.map(([n, c]) => `${esc(n)} (${c})`).join(", ")}.` : "",
          closedWeek.length ? `Caller satisfaction at close: ${sat("happy")} happy, ${sat("neutral")} neutral, ${sat("unhappy")} unhappy.` : "",
          wCalls.length ? `Driver calls: ${plural(wCalls.length, "call")} — ${[...byCaller].map(([n, c]) => `${esc(n)}: ${c}`).join(", ")}.` : "No driver calls logged.",
        ].filter(Boolean).join("<br>"),
      });

      // Shifts per agent (agent-reported calls vs what was logged).
      const wShifts = (await loadShifts(ctx, `${week.start}T00:00:00+02:00`)).filter((x) => inWeek(kigaliDay(x.started_at)));
      if (wShifts.length) {
        const agents = new Map<string, typeof wShifts>();
        for (const x of wShifts) agents.set(x.agent_id, [...(agents.get(x.agent_id) ?? []), x]);
        const tot = (k: string) => wShifts.reduce((acc, x) => acc + Number(x.report[k] ?? 0), 0);
        const mix = (types: [string, string][]) => types.map(([k, l]) => [l, tot(k)] as const).filter(([, v]) => v > 0).map(([l, v]) => `${v} ${l}`).join(" · ");
        const inMix = mix(IN_TYPES);
        const outMix = mix(OUT_TYPES);
        if (inMix || outMix) blocks.push({ heading: "Calls by type", text: [inMix && `<b>Received ${tot("calls_received")}</b> — ${inMix}`, outMix && `<b>Made ${tot("calls_made")}</b> — ${outMix}`].filter(Boolean).join("<br>") });
        blocks.push({
          heading: "Call Center shifts",
          table: {
            head: ["Agent", "Shifts", "Time", "Late", "Calls in / out (reported)", "Logged", "Not ended"],
            rows: [...agents].map(([id, list]) => {
              const sum = (f: (x: typeof list[number]) => number) => list.reduce((acc, x) => acc + f(x), 0);
              return [esc(personName(ctx, id)), String(list.length), hours(sum((x) => x.stats.minutes ?? 0)), String(list.filter((x) => x.late_minutes > 10).length),
                `${sum((x) => Number(x.report.calls_received ?? 0))} / ${sum((x) => Number(x.report.calls_made ?? 0))}`,
                String(sum((x) => x.stats.contacts_logged ?? 0)), String(list.filter((x) => x.status === "auto_closed").length)];
            }),
          },
        });
      }

      const focus = await weeklyTips(ctx);
      if (focus.length) blocks.push({ heading: "What to focus on this week", text: focus.map((t, i) => `${i + 1}. ${t}`).join("<br><br>") });

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
