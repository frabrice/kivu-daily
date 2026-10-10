import {
  computeDepositStanding, firstSundayPayment, sundayOf, shiftDay,
  SUNDAY_RULE_START, WEEKLY_DEPOSIT_AMOUNT, type DepositStanding, type RestDayKey,
} from "../_shared/depositRules.ts";
import { ALL_DAYS, Block, Built, cached, Ctx, day, esc, hm, personName, plural, RuleDef, rows, rwf, Tone } from "./core.ts";

// Driver weekly payments (Phase 1): the Sunday cadence Janviere runs,
// and Finance's deposit confirmations.

export interface DriverRow {
  id: string; full_name: string; phone: string | null; start_date: string | null; rest_day: RestDayKey | null;
  initial_deposit_paid: boolean; initial_deposit_amount: number | null; initial_deposit_date: string | null;
  contract_status: string; vehicle_id: string | null; shift: string | null; stage: string; created_at: string;
  vehicle: { plate_number: string } | null;
  pauses: { id: string; group_id: string; reason: string; note: string | null; start_date: string; end_date: string | null; approval_status: string; recorded_by: string | null; created_at: string }[];
}
export interface DepositRow { id: string; driver_id: string; paid_date: string; amount: number; created_at: string; status: string; created_by: string | null }

export function loadDrivers(ctx: Ctx) {
  return cached(ctx, "drivers", () => rows<DriverRow>(ctx.db.from("drivers").select(
    "id, full_name, phone, start_date, rest_day, initial_deposit_paid, initial_deposit_amount, initial_deposit_date, contract_status, vehicle_id, shift, stage, created_at, vehicle:vehicles(plate_number), pauses:driver_pauses(id, group_id, reason, note, start_date, end_date, approval_status, recorded_by, created_at)",
  )));
}

export function loadDeposits(ctx: Ctx) {
  return cached(ctx, "deposits", () => rows<DepositRow>(ctx.db.from("driver_deposits").select("id, driver_id, paid_date, amount, created_at, status, created_by")));
}

export interface StandingRow { d: DriverRow; s: DepositStanding; deps: DepositRow[] }

// Same population as the app's leaderboard: contract not ended, has a
// car and a start date.
export async function activeStandings(ctx: Ctx, today = ctx.today): Promise<StandingRow[]> {
  const [drivers, deposits] = await Promise.all([loadDrivers(ctx), loadDeposits(ctx)]);
  return drivers
    .filter((d) => d.contract_status === "active" && d.vehicle_id && d.start_date)
    .map((d) => {
      const deps = deposits.filter((x) => x.driver_id === d.id);
      return { d, s: computeDepositStanding(d, deps, today), deps };
    })
    .sort((a, b) => a.d.full_name.localeCompare(b.d.full_name));
}

export const car = (d: DriverRow) => `${d.vehicle?.plate_number ?? "—"}${d.shift ? ` (${d.shift})` : ""}`;
const switchoverSunday = shiftDay(SUNDAY_RULE_START, -1);

async function sundayLists(key: "call" | "unpaid", ctx: Ctx, force: boolean): Promise<Built[]> {
  if (!force && sundayOf(ctx.today) < switchoverSunday) return [];
  const ruleInForce = ctx.today >= SUNDAY_RULE_START;
  const all = await activeStandings(ctx);
  const dueDate = all[0]?.s.nextDueDate ?? sundayOf(ctx.today);
  const owing = all.filter((r) => r.s.nextDueAmount > 0).sort((a, b) => b.s.nextDueAmount - a.s.nextDueAmount);
  const list = key === "call" ? [...owing, ...all.filter((r) => r.s.nextDueAmount <= 0)] : owing;
  if (list.length === 0) return [];
  const total = owing.reduce((s, r) => s + r.s.nextDueAmount, 0);
  const note = (r: StandingRow) => {
    if (r.s.nextDueAmount <= 0) return "Already paid";
    if (r.s.owes > 0) return `Already owes ${rwf(r.s.owes)} for days worked`;
    if (r.d.start_date && sundayOf(r.d.start_date) === r.s.nextDueDate) return "First Sunday top-up";
    if (r.s.nextDueDate === switchoverSunday && !ruleInForce) return "Switch-over payment";
    return "";
  };
  const table = (rs: StandingRow[], amountHead: string) => ({
    head: ["Driver", "Phone", "Car", amountHead, "Note"],
    rows: rs.map((r) => [esc(r.d.full_name), esc(r.d.phone ?? "—"), esc(car(r.d)), r.s.nextDueAmount > 0 ? rwf(r.s.nextDueAmount) : "—", note(r)]),
  });
  return [key === "call"
    ? {
        subject: `Sunday call list: ${plural(owing.length, "driver")}, ${rwf(total)} due by ${day(dueDate)}`,
        heading: `Sunday call list — due by ${day(dueDate)}`,
        intro: `Please remind every driver below to pay by <b>${day(dueDate)}</b>. Anyone not paid in full by Monday morning won't be cleared to drive.`,
        table: table(list, "Due by Sunday"),
        inApp: `Sunday call list: ${plural(owing.length, "driver")}, ${rwf(total)} due by ${day(dueDate)}`,
      }
    : {
        subject: `Still unpaid: ${plural(owing.length, "driver")} owe ${rwf(total)} — call before Monday`,
        heading: "Still unpaid for the coming week",
        intro: "These drivers haven't paid yet. Please call them tonight — if they haven't paid by Monday morning, they're not cleared to drive.",
        table: table(owing, "Still due"),
        inApp: `Still unpaid: ${plural(owing.length, "driver")} owe ${rwf(total)}`,
      }];
}

async function notCleared(kind: "monday" | "daily" | "summary", ctx: Ctx, force: boolean): Promise<Built[]> {
  if (!force && ctx.today < SUNDAY_RULE_START) return [];
  const all = await activeStandings(ctx);
  // Owes = days already worked unpaid; Behind = rest of the week unpaid.
  const blocked = all.filter((r) => !r.s.isCleared).sort((a, b) => b.s.owes - a.s.owes || b.s.weekBehind - a.s.weekBehind);
  const total = blocked.reduce((s, r) => s + r.s.weekBehind, 0);
  const owesTotal = blocked.reduce((s, r) => s + r.s.owes, 0);
  if (kind === "summary") {
    return [blocked.length === 0
      ? { subject: `All ${all.length} drivers are cleared to drive this week`, heading: "Everyone is cleared to drive", intro: `All ${all.length} active drivers have paid for this week.`, inApp: `All ${all.length} drivers cleared to drive this week` }
      : {
          subject: `${blocked.length} of ${all.length} drivers not cleared to drive — ${rwf(total)} behind`,
          heading: "Drivers not cleared to drive",
          intro: `${blocked.length} of ${all.length} active drivers haven't paid this week in full: ${rwf(total)} behind on the week, of which ${rwf(owesTotal)} is owed for days already worked. Janviere and Fleet have the full call list.`,
          table: { head: ["Driver", "Car", "Owes (days worked)", "Behind (week)"], rows: blocked.map((r) => [esc(r.d.full_name), esc(car(r.d)), r.s.owes > 0 ? rwf(r.s.owes) : "—", rwf(r.s.weekBehind)]) },
          inApp: `${plural(blocked.length, "driver")} not cleared to drive (${rwf(total)} behind)`,
        }];
  }
  if (blocked.length === 0) return [];
  const monday = kind === "monday";
  return [{
    subject: `${monday ? "Not cleared to drive today" : "Still not cleared"}: ${plural(blocked.length, "driver")} (${rwf(total)} behind)`,
    heading: monday ? "Not cleared to drive today" : "Still not cleared to drive",
    intro: monday
      ? "These drivers haven't paid for this week and are <b>not cleared to drive</b> until they do. Fleet: keep these cars off the road or swap the driver. Janviere: call each one now (Call Center, you're copied as backup callers)."
      : "These drivers still haven't paid for this week. Every working day they stay uncleared is a day lost.",
    table: { head: ["Driver", "Phone", "Car", "Owes (days worked)", "Behind (week)", "Days lost"], rows: blocked.map((r) => [esc(r.d.full_name), esc(r.d.phone ?? "—"), esc(car(r.d)), r.s.owes > 0 ? rwf(r.s.owes) : "—", rwf(r.s.weekBehind), String(r.s.current?.daysLost ?? 0)]) },
    inApp: `${monday ? "Not cleared to drive today" : "Still not cleared"}: ${plural(blocked.length, "driver")}`,
  }];
}

// Every morning, to everyone who acts on unpaid drivers: Henry (stops the
// car and takes it back), the MD, Janviere (calls), Bertrand (Fleet) and
// Rodrigue (Finance). A driver stays on it every day until they pay in
// full or their contract ends. Never sent to the Call Center.
async function paymentsMorning(ctx: Ctx): Promise<Built[]> {
  const [all, drivers, deposits] = await Promise.all([activeStandings(ctx), loadDrivers(ctx), loadDeposits(ctx)]);
  const owing = all.filter((r) => !r.s.isCleared || r.s.owes > 0 || r.s.weekBehind > 0)
    .sort((a, b) => Number(a.s.isCleared) - Number(b.s.isCleared) || (b.s.current?.daysLost ?? 0) - (a.s.current?.daysLost ?? 0) || b.s.owes - a.s.owes || b.s.weekBehind - a.s.weekBehind);
  const pending = deposits.filter((d) => d.status === "pending").sort((a, b) => a.paid_date.localeCompare(b.paid_date));
  const owesTotal = owing.reduce((s, r) => s + r.s.owes, 0);
  const behindTotal = owing.reduce((s, r) => s + r.s.weekBehind, 0);
  const daysLost = owing.reduce((s, r) => s + (r.s.current?.daysLost ?? 0), 0);
  const driverName = (id: string) => drivers.find((d) => d.id === id)?.full_name ?? "Unknown driver";

  const blocks: Block[] = [];
  const paused = all.filter((r) => r.s.pausedToday);
  if (paused.length) blocks.push({
    heading: `Paused today (${paused.length})`,
    text: "These days don't count: nothing is owed for them and the driver isn't chased while paused.",
    table: {
      head: ["Driver", "Why", "Since", "Until", "Approval"],
      rows: paused.map((r) => {
        const p = r.s.pausedToday!;
        const row = r.d.pauses.find((x) => x.start_date === p.start_date && x.approval_status !== "rejected");
        return [`<b>${esc(r.d.full_name)}</b><br><span style="color:#6b7280;font-size:12px;">${esc(car(r.d))}</span>`, PAUSE_REASON[p.reason ?? ""] ?? "—",
          day(p.start_date), p.end_date ? day(p.end_date) : "Until back", row?.approval_status === "approved" ? "Approved" : "Waiting for MD / Finance"];
      }),
      tones: paused.map((r) => (r.d.pauses.find((x) => x.start_date === r.s.pausedToday!.start_date)?.approval_status === "approved" ? null : "warning" as const)),
      phoneHide: [2],
    },
  });
  if (pending.length) blocks.push({
    heading: `Payments waiting for Finance (${pending.length})`,
    text: "Logged as paid and counted for now. Rodrigue: confirm or reject each one today so this list is exact.",
    table: { head: ["Driver", "Amount", "Paid on", "Logged by"], rows: pending.map((d) => [esc(driverName(d.driver_id)), rwf(d.amount), day(d.paid_date), esc(personName(ctx, d.created_by))]) },
  });

  if (owing.length === 0) {
    return [{
      subject: `Driver payments ${day(ctx.today)}: all ${all.length} drivers paid up`,
      heading: "Every driver is paid up",
      intro: `All ${all.length} active drivers have paid in full and are cleared to drive today.`,
      alert: { tone: "good", text: "Nothing to chase this morning." },
      stats: [{ label: "Active drivers", value: String(all.length) }, { label: "Not cleared", value: "0", tone: "good" }],
      blocks,
      inApp: `Driver payments: all ${all.length} drivers paid up`,
    }];
  }

  const notCleared = owing.filter((r) => !r.s.isCleared).length;
  const tone = (r: StandingRow): Tone => (!r.s.isCleared || r.s.owes > 0 ? "danger" : "warning");
  const last = (r: StandingRow) => {
    const l = [...r.deps].sort((a, b) => b.paid_date.localeCompare(a.paid_date))[0];
    return l ? `${day(l.paid_date)}<br><span style="color:#6b7280;">${rwf(l.amount)}${l.status === "pending" ? " · not confirmed" : ""}</span>` : "None";
  };
  return [{
    subject: `Driver payments ${day(ctx.today)}: ${plural(owing.length, "driver")} owe money, ${notCleared} not cleared — ${rwf(behindTotal)} unpaid`,
    heading: `${plural(owing.length, "driver")} owe${owing.length === 1 ? "s" : ""} us money today`,
    intro: `Every driver below owes us money. They stay on this report every morning until they pay in full or their contract is ended — we don't lose a single day.`,
    alert: { tone: "danger", text: `<b>Henry:</b> the ${plural(notCleared, "red row")} ${notCleared === 1 ? "is" : "are"} <b>not cleared to drive</b> — keep ${notCleared === 1 ? "that car" : "those cars"} off the road until they pay in full. Amber rows can still drive but haven't paid the rest of the week. <b>Janviere:</b> call every driver below this morning. Log each payment in Kivu Daily the moment it arrives.` },
    stats: [
      { label: "Not cleared", value: `${notCleared} / ${all.length}`, sub: `${plural(owing.length, "driver")} owe money`, tone: notCleared ? "danger" : "warning" },
      { label: "Owed (days driven)", value: rwf(owesTotal), tone: owesTotal > 0 ? "danger" : undefined },
      { label: "Behind this week", value: rwf(behindTotal), tone: "warning" },
      { label: "Working days lost", value: String(daysLost) },
    ],
    table: (() => {
      const showLost = owing.some((r) => (r.s.current?.daysLost ?? 0) > 0);
      const status = (r: StandingRow) => r.s.isCleared
        ? `<span style="color:#b45309;font-weight:600;white-space:nowrap;">Behind</span>`
        : `<span style="color:#b91c1c;font-weight:600;white-space:nowrap;">Not cleared</span>`;
      return {
        head: ["Driver", "Status", ...(showLost ? ["Days lost"] : []), "Owes", "Behind", "Last payment"],
        rows: owing.map((r) => [
          `<b>${esc(r.d.full_name)}</b><br><span style="color:#6b7280;font-size:12px;">${esc(car(r.d))} · ${esc(r.d.phone ?? "no phone")}</span>`,
          status(r), ...(showLost ? [String(r.s.current?.daysLost ?? 0)] : []),
          r.s.owes > 0 ? rwf(r.s.owes) : "—", rwf(r.s.weekBehind), last(r),
        ]),
        align: ["left", "left", ...(showLost ? ["right" as const] : []), "right", "right", "left"] as ("left" | "right")[],
        tones: owing.map(tone),
        phoneHide: [showLost ? 5 : 4],
      };
    })(),
    blocks,
    footnote: "Owes = working days already driven this week that aren't paid (30,000 RWF a day). Behind = what's still unpaid for the whole week. Being cleared to drive needs Behind at zero.",
    inApp: `Driver payments: ${plural(owing.length, "driver")} owe money, ${notCleared} not cleared`,
  }];
}

export const PAUSE_REASON: Record<string, string> = {
  sick: "Sick", garage: "Car in the garage", accident: "Accident", family: "Family emergency", leave: "Approved leave", other: "Other",
};

export const driverRules: Record<string, RuleDef> = {
  driver_pause_recorded: {
    kind: "event",
    sample: async (ctx) => {
      const d = (await loadDrivers(ctx)).find((x) => x.pauses.length);
      return d ? { group_id: d.pauses[0].group_id } : null;
    },
    build: async (payload, ctx) => {
      const rows = (await loadDrivers(ctx)).flatMap((d) => d.pauses.filter((p) => p.group_id === payload.group_id).map((p) => ({ d, p })));
      if (!rows.length) return null;
      const { p } = rows[0];
      const who = rows.map((r) => r.d.full_name).join(" and ");
      const span = `${day(p.start_date)}${p.end_date ? ` – ${day(p.end_date)}` : " until they're back"}`;
      const by = personName(ctx, p.recorded_by);
      return {
        subject: `Driver paused: ${who} — ${PAUSE_REASON[p.reason] ?? p.reason}, ${span}`,
        heading: `${esc(who)} paused`,
        intro: `${esc(by)} paused ${esc(who)} (${PAUSE_REASON[p.reason] ?? p.reason}) from ${span}.${p.note ? ` Note: ${esc(p.note)}` : ""} These days don't count while the pause stands. Approve or reject it in Kivu Daily (Driver days off).`,
        inApp: `${by.split(" ")[0]} paused ${who} (${(PAUSE_REASON[p.reason] ?? p.reason).toLowerCase()}), ${span} — to approve`,
      };
    },
  },

  driver_payments_morning: { kind: "scheduled", days: ALL_DAYS, at: hm(6, 30), build: (ctx) => paymentsMorning(ctx) },
  driver_call_list: { kind: "scheduled", days: [6], at: hm(9), build: (ctx, f) => sundayLists("call", ctx, f) },
  driver_still_unpaid: { kind: "scheduled", days: [7], at: hm(18), build: (ctx, f) => sundayLists("unpaid", ctx, f) },
  driver_not_cleared_monday: { kind: "scheduled", days: [1], at: hm(7), build: (ctx, f) => notCleared("monday", ctx, f) },
  driver_not_cleared_summary: { kind: "scheduled", days: [1], at: hm(7), build: (ctx, f) => notCleared("summary", ctx, f) },
  driver_not_cleared_daily: { kind: "scheduled", days: [2, 3, 4, 5, 6, 7], at: hm(7), build: (ctx, f) => notCleared("daily", ctx, f) },

  driver_escalation: {
    kind: "scheduled", days: ALL_DAYS, at: hm(7),
    build: async (ctx, force) => {
      if (!force && ctx.today < SUNDAY_RULE_START) return [];
      const late = (await activeStandings(ctx))
        .filter((r) => !r.s.isCleared && (r.s.current?.daysLost ?? 0) >= 2)
        .sort((a, b) => (b.s.current?.daysLost ?? 0) - (a.s.current?.daysLost ?? 0));
      if (late.length === 0) return [];
      return [{
        subject: `Escalation: ${plural(late.length, "driver")} uncleared for 2+ working days`,
        heading: "Drivers losing days",
        intro: "These drivers have lost 2 or more working days this week without paying. The last-payment column shows whether any payment has been logged for them recently.",
        table: {
          head: ["Driver", "Car", "Days lost", "Owes (days worked)", "Behind (week)", "Last payment logged"],
          rows: late.map((r) => {
            const last = [...r.deps].sort((a, b) => b.paid_date.localeCompare(a.paid_date))[0];
            return [esc(r.d.full_name), esc(car(r.d)), String(r.s.current?.daysLost ?? 0), rwf(r.s.owes), rwf(r.s.weekBehind), last ? `${day(last.paid_date)} · ${rwf(last.amount)}` : "None"];
          }),
        },
        inApp: `Escalation: ${plural(late.length, "driver")} uncleared 2+ days`,
      }];
    },
  },

  deposits_to_confirm: {
    kind: "scheduled", days: ALL_DAYS, at: hm(17),
    build: async (ctx) => {
      const [drivers, deposits] = await Promise.all([loadDrivers(ctx), loadDeposits(ctx)]);
      const pending = deposits.filter((d) => d.status === "pending").sort((a, b) => a.paid_date.localeCompare(b.paid_date));
      if (pending.length === 0) return [];
      const driverName = (id: string) => drivers.find((d) => d.id === id)?.full_name ?? "Unknown driver";
      const total = pending.reduce((s, d) => s + d.amount, 0);
      return [{
        subject: `${plural(pending.length, "deposit")} waiting for confirmation (${rwf(total)})`,
        heading: "Deposits waiting for your confirmation",
        intro: "Please confirm each deposit once you've seen the money arrive, or reject it if it's a mistake. Open Deposit Confirmations in Kivu Daily.",
        table: { head: ["Driver", "Amount", "Paid on", "Logged by"], rows: pending.map((d) => [esc(driverName(d.driver_id)), rwf(d.amount), day(d.paid_date), esc(personName(ctx, d.created_by))]) },
        inApp: `${plural(pending.length, "deposit")} waiting for confirmation`,
      }];
    },
  },

  driver_new: {
    kind: "event",
    sample: async (ctx) => {
      const latest = [...await loadDrivers(ctx)].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return latest ? { driver_id: latest.id } : null;
    },
    build: async (payload, ctx) => {
      const d = (await loadDrivers(ctx)).find((x) => x.id === payload.driver_id);
      if (!d) return null;
      const first = d.start_date ? firstSundayPayment(d.start_date, d.rest_day) : null;
      return {
        subject: `New driver: ${d.full_name}${d.start_date ? ` starts ${day(d.start_date)}` : ""}`,
        heading: `New driver: ${esc(d.full_name)}`,
        intro: d.start_date && first
          ? `${esc(d.full_name)} (${esc(d.phone ?? "no phone")}) starts on <b>${day(d.start_date)}</b>${d.rest_day ? `, resting on ${d.rest_day}s` : ""}.`
            + `<br><br><b>${rwf(WEEKLY_DEPOSIT_AMOUNT)}</b> is due before the first shift${d.initial_deposit_paid ? " (already recorded as paid)" : ""}, then <b>${rwf(first.amount)}</b> by ${day(first.date)}, then ${rwf(WEEKLY_DEPOSIT_AMOUNT)} every Sunday.`
          : `${esc(d.full_name)} was added without a start date yet — their payment schedule starts once one is set.`,
        inApp: `New driver ${d.full_name}${d.start_date ? ` starts ${day(d.start_date)}` : ""}`,
      };
    },
  },

  driver_contract_ended: {
    kind: "event",
    sample: async (ctx) => {
      const latest = [...await loadDrivers(ctx)].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return latest ? { driver_id: latest.id, event_date: ctx.today, reason: "Example reason" } : null;
    },
    build: async (payload, ctx) => {
      const [drivers, deposits] = await Promise.all([loadDrivers(ctx), loadDeposits(ctx)]);
      const d = drivers.find((x) => x.id === payload.driver_id);
      if (!d) return null;
      const s = computeDepositStanding(d, deposits.filter((x) => x.driver_id === d.id), ctx.today);
      // At contract end, what he really owes is the days he worked unpaid.
      const owed = s.owes;
      return {
        subject: `Driver contract ended: ${d.full_name}`,
        heading: `Contract ended: ${esc(d.full_name)}`,
        intro: `${esc(d.full_name)}'s contract ended on ${day((payload.event_date as string) ?? ctx.today)}${payload.reason ? ` — ${esc(String(payload.reason))}` : ""}. No more payment reminders will go out for them.`
          + `<br><br>${owed > 0 ? `Balance still owed: <b>${rwf(owed)}</b>.` : "No balance owed."}`,
        inApp: `Contract ended: ${d.full_name}${owed > 0 ? ` (owes ${rwf(owed)})` : ""}`,
      };
    },
  },

  deposit_rejected: {
    kind: "event",
    sample: async (ctx) => ({ driver_name: "Example Driver", amount: 180000, paid_date: ctx.today, reason: "Example — logged twice by mistake", rejected_by: "Finance" }),
    build: async (payload) => ({
      subject: `Deposit rejected: ${payload.driver_name ?? "a driver"}, ${rwf(Number(payload.amount ?? 0))}`,
      heading: "A deposit you logged was rejected",
      intro: `${esc(String(payload.rejected_by ?? "Finance"))} rejected the ${rwf(Number(payload.amount ?? 0))} deposit you logged for <b>${esc(String(payload.driver_name ?? "a driver"))}</b> (paid ${day((payload.paid_date as string) ?? null)}).`
        + `<br><br>Reason: ${payload.reason ? esc(String(payload.reason)) : "none given"}. If the driver really did pay, log the correct payment again.`,
      inApp: `Deposit rejected: ${payload.driver_name ?? "a driver"} ${rwf(Number(payload.amount ?? 0))}`,
    }),
  },
};
