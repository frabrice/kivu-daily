import { daysUntilDate } from "../_shared/depositRules.ts";
import { Ctx, day, plural, rows, rwf } from "./core.ts";
import { activeStandings, car, loadDeposits, loadDrivers, PAUSE_REASON } from "./drivers.ts";
import { openTransactions, TYPE_LABEL } from "./finance.ts";
import { carsWithoutDriver, loadFlaggedStories } from "./operations.ts";
import { isOverdue, isResponseOverdue, loadTickets, UNRESOLVED } from "./tickets.ts";

// Smart tasks: created from live data, only when there is real work, with
// the specifics (who, how much) in the task, and completed automatically
// when the work is done. Runs on every notifications-run (every 5 minutes
// and on events). One task per person per day per kind (smart_key).
//
// Each kind returns:
// - assignments: who should have work today and the items it covers
// - open: every item still open anywhere (an item missing from it is done,
//   even for someone no longer assigned - e.g. an agent whose shift ended)

export interface SmartItem { id: string; label: string; detail?: string }
interface StoredItem extends SmartItem { done: boolean }
interface Assignment { userId: string; items: SmartItem[] }
interface SmartResult { assignments: Assignment[]; open: Set<string> }

interface ListKind {
  key: string; priority: "normal" | "high"; due: string | null;
  title: (open: number) => string; doneTitle: string; intro: string;
  compute: (ctx: Ctx) => Promise<SmartResult>;
}
interface TargetKind {
  key: string; priority: "normal" | "high"; due: string | null; target: number;
  title: (done: number, target: number) => string; intro: string;
  compute: (ctx: Ctx) => Promise<{ userId: string; done: number }[]>;
}

interface TaskRow {
  id: string; user_id: string; title: string; completed: boolean; auto_completed: boolean;
  smart_key: string; smart_items: StoredItem[] | null; smart_total: number | null; smart_done: number | null;
}

const one = (ctx: Ctx, duty: string) => ctx.responsibilities[duty] ?? null;
const md = (ctx: Ctx) => ctx.profiles.find((p) => p.role === "managing_director" && p.is_active)?.id ?? null;
const assign = (userId: string | null, items: SmartItem[]): Assignment[] => (userId && items.length ? [{ userId, items }] : []);
const setOf = (items: SmartItem[]) => new Set(items.map((i) => i.id));

async function onShiftAgents(ctx: Ctx): Promise<string[]> {
  const open = await rows<{ agent_id: string }>(ctx.db.from("call_center_shifts").select("agent_id").eq("status", "open"));
  return [...new Set(open.map((s) => s.agent_id))].sort();
}

const finance = (ctx: Ctx) => ctx.responsibilities["route_finance"] ?? null;

const LIST_KINDS: ListKind[] = [
  {
    key: "pauses_to_review", priority: "normal", due: "12:00",
    title: (n) => `Approve or reject ${plural(n, "driver pause")}`, doneTitle: "Driver pauses reviewed",
    intro: "Days paused for sick drivers, cars in the garage, etc. don't count while the pause stands. Check each one (Driver days off).",
    compute: async (ctx) => {
      const seen = new Set<string>();
      const items: SmartItem[] = [];
      for (const d of await loadDrivers(ctx)) for (const p of d.pauses) {
        if (p.approval_status !== "pending" || seen.has(p.group_id)) continue;
        seen.add(p.group_id);
        items.push({ id: p.group_id, label: `${d.full_name} — ${PAUSE_REASON[p.reason] ?? p.reason}`, detail: `${day(p.start_date)}${p.end_date ? `–${day(p.end_date)}` : " onward"} · by ${ctx.profiles.find((x) => x.id === p.recorded_by)?.full_name.trim().split(/\s+/)[0] ?? "—"}` });
      }
      return { assignments: [...assign(md(ctx), items), ...assign(finance(ctx), items)], open: setOf(items) };
    },
  },
  {
    key: "pauses_check_in", priority: "normal", due: "12:00",
    title: (n) => `Check on ${plural(n, "paused driver")}`, doneTitle: "Paused drivers checked",
    intro: "Open-ended pauses for more than 3 days. Call the driver (or garage): resume them in Kivu Daily as soon as they're back.",
    compute: async (ctx) => {
      const limit = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const items: SmartItem[] = [];
      for (const d of await loadDrivers(ctx)) for (const p of d.pauses) {
        if (p.end_date || p.approval_status === "rejected" || p.start_date > limit) continue;
        items.push({ id: p.id, label: d.full_name, detail: `${PAUSE_REASON[p.reason] ?? p.reason} since ${day(p.start_date)}${d.phone ? ` · ${d.phone}` : ""}` });
      }
      return { assignments: assign(one(ctx, "fleet_manager"), items), open: setOf(items) };
    },
  },
  {
    key: "deposits_confirm", priority: "high", due: "17:00",
    title: (n) => `Confirm ${plural(n, "driver deposit")}`, doneTitle: "Driver deposits confirmed",
    intro: "Confirm each payment once you've seen the money arrive (Deposit Confirmations), or reject it if it's a mistake.",
    compute: async (ctx) => {
      const [deposits, drivers] = await Promise.all([loadDeposits(ctx), loadDrivers(ctx)]);
      const items = deposits.filter((d) => d.status === "pending").sort((a, b) => a.paid_date.localeCompare(b.paid_date))
        .map((d) => ({ id: d.id, label: drivers.find((x) => x.id === d.driver_id)?.full_name ?? "Unknown driver", detail: `${rwf(d.amount)} · paid ${day(d.paid_date)}` }));
      return { assignments: assign(one(ctx, "deposit_confirmation"), items), open: setOf(items) };
    },
  },
  {
    key: "drivers_owing_calls", priority: "high", due: "10:00",
    title: (n) => `Call ${plural(n, "driver")} who owe us`, doneTitle: "Every driver has paid",
    intro: "Call each driver below and get today's payment. They tick off by themselves the moment the payment is logged.",
    compute: async (ctx) => {
      const items = (await activeStandings(ctx)).filter((r) => !r.s.isCleared || r.s.owes > 0 || r.s.weekBehind > 0)
        .sort((a, b) => b.s.owes - a.s.owes || b.s.weekBehind - a.s.weekBehind)
        .map((r) => ({ id: r.d.id, label: r.d.full_name, detail: `${r.d.phone ?? "no phone"} · ${r.s.owes > 0 ? `owes ${rwf(r.s.owes)} · ` : ""}behind ${rwf(r.s.weekBehind)}` }));
      return { assignments: assign(one(ctx, "driver_payment_followup"), items), open: setOf(items) };
    },
  },
  {
    key: "cars_off_road", priority: "high", due: "09:00",
    title: (n) => `Keep ${plural(n, "car")} off the road until the driver pays`, doneTitle: "Every driver is cleared to drive",
    intro: "These drivers are not cleared to drive. Each one ticks off by itself when they pay in full.",
    compute: async (ctx) => {
      const items = (await activeStandings(ctx)).filter((r) => !r.s.isCleared)
        .map((r) => ({ id: r.d.id, label: car(r.d), detail: `${r.d.full_name} · ${r.s.pausedToday ? `paused (${(PAUSE_REASON[r.s.pausedToday.reason ?? ""] ?? "").toLowerCase()}) · ` : ""}${plural(r.s.current?.daysLost ?? 0, "day")} unpaid · behind ${rwf(r.s.weekBehind)}` }));
      return { assignments: assign(one(ctx, "route_operations"), items), open: setOf(items) };
    },
  },
  {
    key: "idle_cars", priority: "normal", due: "12:00",
    title: (n) => `Find drivers for ${plural(n, "idle car")}`, doneTitle: "Every car has a driver",
    intro: "Cars with no driver on an active contract earn nothing for us or the owner. Swap in a Ready driver or recruit.",
    compute: async (ctx) => {
      const items = (await carsWithoutDriver(ctx)).map((v) => ({ id: v.id, label: v.plate_number }));
      return { assignments: assign(one(ctx, "route_operations"), items), open: setOf(items) };
    },
  },
  {
    key: "noninsider_followup", priority: "normal", due: "12:00",
    title: (n) => `Contact ${plural(n, "Non-Insider driver")} who want our device or branding`, doneTitle: "Non-Insider drivers followed up",
    intro: "Agree the payment and a date, then move the car on in Branding & Devices — it ticks off here by itself.",
    compute: async (ctx) => {
      const list = await rows<{ platform_driver_id: string; device_answer: string | null; branding_answer: string | null; driver: { full_name: string; phone: string | null; car: { plate_number: string; branding_status: string | null; device_status: string | null } | null } | null }>(
        ctx.db.from("platform_outreach_status").select("platform_driver_id, device_answer, branding_answer, driver:platform_drivers(full_name, phone, car:platform_cars(plate_number, branding_status, device_status))").or("device_answer.eq.yes,branding_answer.eq.yes"));
      const waiting = (s: typeof list[number]) => (s.device_answer === "yes" && (s.driver?.car?.device_status ?? "to_contact") === "to_contact") || (s.branding_answer === "yes" && (s.driver?.car?.branding_status ?? "to_contact") === "to_contact");
      const items = list.filter(waiting).map((s) => ({
        id: s.platform_driver_id, label: s.driver?.full_name ?? "Unknown driver",
        detail: `${s.driver?.phone ?? "no phone"} · ${s.driver?.car?.plate_number ?? "no car"} · wants ${[s.device_answer === "yes" ? "device" : "", s.branding_answer === "yes" ? "branding" : ""].filter(Boolean).join(" + ")}`,
      }));
      return { assignments: assign(one(ctx, "fleet_manager"), items), open: setOf(items) };
    },
  },
  {
    key: "payments_to_check", priority: "normal", due: "11:00",
    title: (n) => `Check ${plural(n, "payment")} and send to the MD`, doneTitle: "Payments checked",
    intro: "Check each entry against its receipt, then mark it checked so it goes to the MD for approval.",
    compute: async (ctx) => {
      const items = (await openTransactions(ctx)).filter((t) => t.status === "pending").sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
        .map((t) => ({ id: t.id, label: `${TYPE_LABEL[t.type] ?? t.type}${t.counterparty ? ` · ${t.counterparty}` : ""}`, detail: `${rwf(t.amount)} · ${day(t.transaction_date)}${daysUntilDate(t.transaction_date, ctx.today) > 0 ? " · overdue" : ""}` }));
      return { assignments: assign(one(ctx, "route_finance"), items), open: setOf(items) };
    },
  },
  {
    key: "md_approvals", priority: "high", due: "10:00",
    title: (n) => `Approve or reject ${plural(n, "item")}`, doneTitle: "Nothing waiting for your approval",
    intro: "Checked by Finance and waiting for you.",
    compute: async (ctx) => {
      const [tx, runs, removals] = await Promise.all([
        openTransactions(ctx),
        rows<{ id: string; period: string; total_amount: number; status: string }>(ctx.db.from("payroll_runs").select("id, period, total_amount, status").eq("status", "checked")),
        rows<{ id: string; full_name: string }>(ctx.db.from("payroll_employees").select("id, full_name").eq("pending_removal", true)),
      ]);
      const items: SmartItem[] = [
        ...tx.filter((t) => t.status === "checked").map((t) => ({ id: t.id, label: `${TYPE_LABEL[t.type] ?? t.type}${t.counterparty ? ` · ${t.counterparty}` : ""}`, detail: rwf(t.amount) })),
        ...runs.map((r) => ({ id: `run:${r.id}`, label: `Payroll run ${r.period}`, detail: rwf(r.total_amount) })),
        ...removals.map((r) => ({ id: `removal:${r.id}`, label: `Payroll removal: ${r.full_name}` })),
      ];
      return { assignments: assign(md(ctx), items), open: setOf(items) };
    },
  },
  {
    key: "md_emergencies", priority: "high", due: null,
    title: (n) => `Acknowledge ${plural(n, "emergency", "emergencies")}`, doneTitle: "Emergencies acknowledged",
    intro: "An emergency can't be closed until you acknowledge it (From Call Center).",
    compute: async (ctx) => {
      const items = (await loadTickets(ctx)).filter((t) => t.priority === "emergency" && !t.md_acknowledged_at && t.status !== "closed")
        .map((t) => ({ id: t.id, label: `${t.reference} · ${t.caller_name}`, detail: t.situation ?? undefined }));
      return { assignments: assign(md(ctx), items), open: setOf(items) };
    },
  },
  {
    key: "cases_assigned", priority: "normal", due: null,
    title: (n) => `Answer ${plural(n, "Call Center case")}`, doneTitle: "Your Call Center cases are answered",
    intro: "Callers waiting on you (From Call Center). Respond within 2 hours of assignment.",
    compute: async (ctx) => {
      const open = (await loadTickets(ctx)).filter((t) => UNRESOLVED.includes(t.status) && t.assignee_id);
      const by = new Map<string, SmartItem[]>();
      for (const t of open) {
        const late = isResponseOverdue(t) ? "no response in 2 h" : isOverdue(t) ? "overdue" : "";
        by.set(t.assignee_id!, [...(by.get(t.assignee_id!) ?? []), { id: t.id, label: `${t.reference} · ${t.caller_name}`, detail: [t.situation, late].filter(Boolean).join(" · ") || undefined }]);
      }
      return { assignments: [...by].map(([userId, items]) => ({ userId, items })), open: new Set(open.map((t) => t.id)) };
    },
  },
  {
    key: "it_issues", priority: "normal", due: "12:00",
    title: (n) => `Work on ${plural(n, "flagged issue")}`, doneTitle: "Flagged issues handled",
    intro: "Problems other departments flagged to IT (IT Hub → Issues).",
    compute: async (ctx) => {
      const items = (await loadFlaggedStories(ctx)).filter((s) => s.status !== "done")
        .map((s) => ({ id: s.id, label: (s.title?.trim() || s.need?.trim() || "Issue").slice(0, 90), detail: s.status === "backlog" ? "not started" : s.status.replace("_", " ") }));
      return { assignments: assign(one(ctx, "route_it"), items), open: setOf(items) };
    },
  },
  {
    key: "callbacks", priority: "high", due: null,
    title: (n) => `Call back ${plural(n, "caller")}`, doneTitle: "Every caller called back",
    intro: "Their case is resolved — tell them, record how they felt, and close it (Calls & Tickets → Call back).",
    compute: async (ctx) => {
      const tickets = (await loadTickets(ctx)).filter((t) => t.status === "resolved").sort((a, b) => (a.resolved_at ?? "").localeCompare(b.resolved_at ?? ""));
      const agents = await onShiftAgents(ctx);
      const by = new Map<string, SmartItem[]>();
      tickets.forEach((t, i) => {
        if (!agents.length) return;
        const a = agents[i % agents.length];
        by.set(a, [...(by.get(a) ?? []), { id: t.id, label: `${t.reference} · ${t.caller_name}`, detail: t.caller_phone }]);
      });
      return { assignments: [...by].map(([userId, items]) => ({ userId, items })), open: new Set(tickets.map((t) => t.id)) };
    },
  },
];

const TARGET_KINDS: TargetKind[] = [
  {
    key: "outreach_target", priority: "normal", due: null, target: 15,
    title: (done, target) => `Make ${target} Non-Insider outreach calls (${Math.min(done, target)}/${target})`,
    intro: "Use quiet time on Non-Insider Outreach: updated app, our device (120,000 RWF) and branding (20,000 RWF). Counts by itself as you log calls.",
    compute: async (ctx) => {
      const agents = await onShiftAgents(ctx);
      const startUtc = new Date(`${ctx.today}T00:00:00+02:00`).toISOString();
      const calls = await rows<{ agent_id: string | null }>(ctx.db.from("platform_outreach_calls").select("agent_id").gte("created_at", startUtc));
      // Agents on shift now, plus anyone who already has today's task (shift ended) keeps counting.
      const ids = new Set([...agents, ...calls.map((c) => c.agent_id).filter((x): x is string => !!x)]);
      return [...ids].map((userId) => ({ userId, done: calls.filter((c) => c.agent_id === userId).length, onShift: agents.includes(userId) }))
        .filter((r) => (r as { onShift: boolean }).onShift || r.done > 0);
    },
  },
];

const describe = (intro: string, items: StoredItem[]) => {
  const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);
  const line = (i: StoredItem) => `• ${i.label}${i.detail ? ` — ${i.detail}` : ""}`;
  return [intro, "", ...open.slice(0, 20).map(line), ...(open.length > 20 ? [`…and ${open.length - 20} more`] : []), ...(done.length ? ["", `Done: ${done.map((i) => i.label).join(", ")}`] : [])].join("\n");
};

export async function syncSmartTasks(ctx: Ctx): Promise<{ created: number; updated: number; completed: number; errors: string[] }> {
  const out = { created: 0, updated: 0, completed: 0, errors: [] as string[] };
  const existing = await rows<TaskRow>(ctx.db.from("tasks").select("id, user_id, title, completed, auto_completed, smart_key, smart_items, smart_total, smart_done").eq("date", ctx.today).not("smart_key", "is", null));
  const now = new Date().toISOString();
  const active = new Set(ctx.profiles.filter((p) => p.is_active).map((p) => p.id));

  for (const kind of LIST_KINDS) {
    try {
      const { assignments, open } = await kind.compute(ctx);
      const mine = existing.filter((t) => t.smart_key === kind.key);
      const handled = new Set<string>();
      for (const a of assignments.filter((x) => active.has(x.userId))) {
        handled.add(a.userId);
        const ex = mine.find((t) => t.user_id === a.userId);
        if (!ex) {
          const items = a.items.map((i) => ({ ...i, done: false }));
          const { error } = await ctx.db.from("tasks").insert({
            user_id: a.userId, date: ctx.today, title: kind.title(items.length), description: describe(kind.intro, items),
            smart_key: kind.key, smart_items: items, smart_total: items.length, smart_done: 0, priority: kind.priority, due_time: kind.due,
          });
          if (error) out.errors.push(`${kind.key}: ${error.message}`); else out.created++;
          continue;
        }
        const prev = new Map((ex.smart_items ?? []).map((i) => [i.id, i]));
        const isNew = a.items.some((i) => !prev.has(i.id));
        for (const i of a.items) prev.set(i.id, { ...i, done: false });
        const items = [...prev.values()].map((i) => (open.has(i.id) ? i : { ...i, done: true }));
        const left = items.filter((i) => !i.done).length;
        // Reopen when new work arrives, or when it had been auto-completed.
        const completed = left === 0 ? true : ex.completed && !ex.auto_completed && !isNew;
        await writeIfChanged(ctx, ex, {
          title: left ? kind.title(left) : kind.doneTitle, description: describe(kind.intro, items), smart_items: items,
          smart_total: items.length, smart_done: items.length - left, completed,
          auto_completed: left === 0 ? true : completed && ex.auto_completed, completed_at: completed ? (ex.completed ? undefined : now) : null,
        }, out);
      }
      // People with no work left today: tick off what's resolved; finish if all done.
      for (const ex of mine.filter((t) => !handled.has(t.user_id))) {
        const items = (ex.smart_items ?? []).map((i) => (open.has(i.id) ? i : { ...i, done: true }));
        const left = items.filter((i) => !i.done).length;
        await writeIfChanged(ctx, ex, {
          title: left ? kind.title(left) : kind.doneTitle, description: describe(kind.intro, items), smart_items: items,
          smart_total: items.length, smart_done: items.length - left,
          completed: left === 0 ? true : ex.completed, auto_completed: left === 0 ? (ex.completed ? ex.auto_completed : true) : ex.auto_completed,
          completed_at: left === 0 && !ex.completed ? now : undefined,
        }, out);
      }
    } catch (err) {
      out.errors.push(`${kind.key}: ${err instanceof Error ? err.message : err}`);
    }
  }

  for (const kind of TARGET_KINDS) {
    try {
      for (const r of await kind.compute(ctx)) {
        if (!active.has(r.userId)) continue;
        const ex = existing.find((t) => t.smart_key === kind.key && t.user_id === r.userId);
        const done = Math.min(r.done, kind.target);
        const fields = { title: kind.title(done, kind.target), description: kind.intro, smart_total: kind.target, smart_done: done };
        if (!ex) {
          const { error } = await ctx.db.from("tasks").insert({ user_id: r.userId, date: ctx.today, smart_key: kind.key, priority: kind.priority, due_time: kind.due, ...fields, completed: done >= kind.target, auto_completed: done >= kind.target, completed_at: done >= kind.target ? now : null });
          if (error) out.errors.push(`${kind.key}: ${error.message}`); else out.created++;
        } else {
          await writeIfChanged(ctx, ex, { ...fields, completed: done >= kind.target || ex.completed, auto_completed: done >= kind.target ? true : ex.auto_completed, completed_at: done >= kind.target && !ex.completed ? now : undefined }, out);
        }
      }
    } catch (err) {
      out.errors.push(`${kind.key}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return out;
}

async function writeIfChanged(ctx: Ctx, ex: TaskRow, next: Record<string, unknown>, out: { updated: number; completed: number; errors: string[] }) {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    const cur = (ex as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(cur ?? null) !== JSON.stringify(v ?? null)) patch[k] = v;
  }
  if (!Object.keys(patch).length) return;
  if (patch.completed === true && !ex.completed) out.completed++;
  const { error } = await ctx.db.from("tasks").update(patch).eq("id", ex.id);
  if (error) out.errors.push(`${ex.smart_key}: ${error.message}`); else out.updated++;
}

// For the morning email and the 16:00 nudge.
export interface TodayTask { user_id: string; title: string; description: string | null; completed: boolean; priority: string; due_time: string | null; smart_key: string | null; smart_total: number | null; smart_done: number | null; date: string; recurring_task_id: string | null }
export function loadTodayTasks(ctx: Ctx) {
  return rows<TodayTask>(ctx.db.from("tasks").select("user_id, title, description, completed, priority, due_time, smart_key, smart_total, smart_done, date, recurring_task_id").eq("date", ctx.today));
}
