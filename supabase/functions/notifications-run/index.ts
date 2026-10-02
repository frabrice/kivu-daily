import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendWithResend, wrapEmail } from "../_shared/email.ts";
import {
  computeDepositStanding, firstSundayPayment, isoWeekday, sundayOf, shiftDay,
  SUNDAY_RULE_START, WEEKLY_DEPOSIT_AMOUNT, type DepositStanding, type RestDayKey,
} from "../_shared/depositRules.ts";

// Runs every 5 minutes (pg_cron -> pg_net, authenticated by a shared
// secret). Each run: (1) builds any scheduled digest that's due today in
// Kigali time and hasn't run yet, (2) turns new database events into
// emails, (3) sends everything pending in the outbox. The MD can also
// call it with { mode: 'test', rule_key } to receive one rule's email
// themselves, built from live data, without anyone else being emailed.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const cronSecret = Deno.env.get("NOTIFICATIONS_CRON_SECRET");
const appUrl = Deno.env.get("APP_URL") || "https://kivu-daily.app";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const SCHEDULE: Record<string, { days: number[]; at: number }> = {
  driver_call_list: { days: [6], at: 9 * 60 },
  driver_still_unpaid: { days: [7], at: 18 * 60 },
  driver_not_cleared_monday: { days: [1], at: 7 * 60 },
  driver_not_cleared_summary: { days: [1], at: 7 * 60 },
  driver_not_cleared_daily: { days: [2, 3, 4, 5, 6, 7], at: 7 * 60 },
  driver_escalation: { days: ALL_DAYS, at: 7 * 60 },
  deposits_to_confirm: { days: ALL_DAYS, at: 17 * 60 },
};
const QUIET_FROM = 20 * 60;
const QUIET_UNTIL = 6 * 60 + 30;

interface Profile { id: string; full_name: string; email: string | null; role: string; is_active: boolean; department: { slug: string | null } | null }
interface Recipient { id: string; email: string; name: string }
interface Built { subject: string; heading: string; intro: string; table?: { head: string[]; rows: string[][] }; footnote?: string; inApp: string }
interface DriverRow {
  id: string; full_name: string; phone: string | null; start_date: string | null; rest_day: RestDayKey | null;
  initial_deposit_paid: boolean; initial_deposit_amount: number | null; initial_deposit_date: string | null;
  contract_status: string; vehicle_id: string | null; shift: string | null; created_at: string;
  vehicle: { plate_number: string } | null;
}
interface DepositRow { id: string; driver_id: string; paid_date: string; amount: number; created_at: string; status: string; created_by: string | null }
interface FleetData { drivers: DriverRow[]; deposits: DepositRow[] }
interface Ctx { db: SupabaseClient; today: string; profiles: Profile[]; responsibilities: Record<string, string | null>; fleet?: FleetData }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function kigaliNow() {
  const k = new Date(Date.now() + 2 * 3600 * 1000);
  const today = k.toISOString().slice(0, 10);
  return { today, minutes: k.getUTCHours() * 60 + k.getUTCMinutes(), dow: isoWeekday(today) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rwf = (n: number) => `${Math.round(n).toLocaleString("en-US")} RWF`;
const day = (d: string | null) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "—";

async function loadFleet(ctx: Ctx): Promise<FleetData> {
  if (ctx.fleet) return ctx.fleet;
  const [{ data: drivers }, { data: deposits }] = await Promise.all([
    ctx.db.from("drivers").select("id, full_name, phone, start_date, rest_day, initial_deposit_paid, initial_deposit_amount, initial_deposit_date, contract_status, vehicle_id, shift, created_at, vehicle:vehicles(plate_number)"),
    ctx.db.from("driver_deposits").select("id, driver_id, paid_date, amount, created_at, status, created_by"),
  ]);
  ctx.fleet = { drivers: (drivers ?? []) as unknown as DriverRow[], deposits: (deposits ?? []) as DepositRow[] };
  return ctx.fleet;
}

async function activeStandings(ctx: Ctx): Promise<{ d: DriverRow; s: DepositStanding; deps: DepositRow[] }[]> {
  const { drivers, deposits } = await loadFleet(ctx);
  return drivers
    .filter((d) => d.contract_status === "active" && d.vehicle_id && d.start_date)
    .map((d) => {
      const deps = deposits.filter((x) => x.driver_id === d.id);
      return { d, s: computeDepositStanding(d, deps, ctx.today), deps };
    })
    .sort((a, b) => a.d.full_name.localeCompare(b.d.full_name));
}

const car = (d: DriverRow) => `${d.vehicle?.plate_number ?? "—"}${d.shift ? ` (${d.shift})` : ""}`;
const switchoverSunday = shiftDay(SUNDAY_RULE_START, -1);

// ------------------------------------------------------------------
// Scheduled digests. Each returns null when there's nothing worth
// sending (or the rule doesn't apply yet), and `force` (test mode)
// skips the date guards so the MD can preview any rule on any day.
// ------------------------------------------------------------------
async function buildScheduled(key: string, ctx: Ctx, force: boolean): Promise<Built | null> {
  const ruleInForce = ctx.today >= SUNDAY_RULE_START;

  if (key === "driver_call_list" || key === "driver_still_unpaid") {
    if (!force && sundayOf(ctx.today) < switchoverSunday) return null;
    const rows = await activeStandings(ctx);
    const dueDate = rows[0]?.s.nextDueDate ?? sundayOf(ctx.today);
    const owing = rows.filter((r) => r.s.nextDueAmount > 0).sort((a, b) => b.s.nextDueAmount - a.s.nextDueAmount);
    const list = key === "driver_call_list" ? [...owing, ...rows.filter((r) => r.s.nextDueAmount <= 0)] : owing;
    if (list.length === 0) return null;
    const total = owing.reduce((s, r) => s + r.s.nextDueAmount, 0);
    const note = (r: { d: DriverRow; s: DepositStanding }) => {
      if (r.s.nextDueAmount <= 0) return "Already paid";
      if (r.s.owedNow > 0) return `Includes ${rwf(r.s.owedNow)} already overdue`;
      if (r.d.start_date && sundayOf(r.d.start_date) === r.s.nextDueDate) return "First Sunday top-up";
      if (r.s.nextDueDate === switchoverSunday && !ruleInForce) return "Switch-over payment";
      return "";
    };
    return key === "driver_call_list"
      ? {
          subject: `Sunday call list: ${owing.length} driver${owing.length === 1 ? "" : "s"}, ${rwf(total)} due by ${day(dueDate)}`,
          heading: `Sunday call list — due by ${day(dueDate)}`,
          intro: `Please remind every driver below to pay by <b>Sunday ${day(dueDate)}</b>. Anyone not paid in full by Monday morning won't be cleared to drive.`,
          table: { head: ["Driver", "Phone", "Car", "Due by Sunday", "Note"], rows: list.map((r) => [esc(r.d.full_name), esc(r.d.phone ?? "—"), esc(car(r.d)), r.s.nextDueAmount > 0 ? rwf(r.s.nextDueAmount) : "—", note(r)]) },
          inApp: `Sunday call list: ${owing.length} drivers, ${rwf(total)} due by ${day(dueDate)}`,
        }
      : {
          subject: `Still unpaid: ${owing.length} driver${owing.length === 1 ? "" : "s"} owe ${rwf(total)} — call before Monday`,
          heading: "Still unpaid for the coming week",
          intro: `These drivers haven't paid yet. Please call them tonight — if they haven't paid by Monday morning, they're not cleared to drive.`,
          table: { head: ["Driver", "Phone", "Car", "Still due", "Note"], rows: owing.map((r) => [esc(r.d.full_name), esc(r.d.phone ?? "—"), esc(car(r.d)), rwf(r.s.nextDueAmount), note(r)]) },
          inApp: `Still unpaid: ${owing.length} drivers owe ${rwf(total)}`,
        };
  }

  if (key === "driver_not_cleared_monday" || key === "driver_not_cleared_daily" || key === "driver_not_cleared_summary") {
    if (!force && !ruleInForce) return null;
    const rows = await activeStandings(ctx);
    const blocked = rows.filter((r) => !r.s.isCleared).sort((a, b) => b.s.owedNow - a.s.owedNow);
    const total = blocked.reduce((s, r) => s + r.s.owedNow, 0);
    if (key === "driver_not_cleared_summary") {
      return blocked.length === 0
        ? { subject: `All ${rows.length} drivers are cleared to drive this week`, heading: "Everyone is cleared to drive", intro: `All ${rows.length} active drivers have paid for this week.`, inApp: `All ${rows.length} drivers cleared to drive this week` }
        : {
            subject: `${blocked.length} of ${rows.length} drivers not cleared to drive — ${rwf(total)} owed`,
            heading: "Drivers not cleared to drive",
            intro: `${blocked.length} of ${rows.length} active drivers haven't paid for this week. Janviere and Fleet have the full call list.`,
            table: { head: ["Driver", "Car", "Owes"], rows: blocked.map((r) => [esc(r.d.full_name), esc(car(r.d)), rwf(r.s.owedNow)]) },
            inApp: `${blocked.length} drivers not cleared to drive (${rwf(total)} owed)`,
          };
    }
    if (blocked.length === 0) return null;
    const monday = key === "driver_not_cleared_monday";
    return {
      subject: monday
        ? `Not cleared to drive today: ${blocked.length} driver${blocked.length === 1 ? "" : "s"} (${rwf(total)} owed)`
        : `Still not cleared: ${blocked.length} driver${blocked.length === 1 ? "" : "s"} (${rwf(total)} owed)`,
      heading: monday ? "Not cleared to drive today" : "Still not cleared to drive",
      intro: monday
        ? "These drivers haven't paid for this week and are <b>not cleared to drive</b> until they do. Fleet: keep these cars off the road or swap the driver. Janviere: call each one now (Call Center, you're copied as backup callers)."
        : "These drivers still haven't paid for this week. Every working day they stay uncleared is a day lost.",
      table: { head: ["Driver", "Phone", "Car", "Owes", "Days lost"], rows: blocked.map((r) => [esc(r.d.full_name), esc(r.d.phone ?? "—"), esc(car(r.d)), rwf(r.s.owedNow), String(r.s.current?.daysLost ?? 0)]) },
      inApp: `${monday ? "Not cleared to drive today" : "Still not cleared"}: ${blocked.length} drivers`,
    };
  }

  if (key === "driver_escalation") {
    if (!force && !ruleInForce) return null;
    const rows = await activeStandings(ctx);
    const late = rows.filter((r) => !r.s.isCleared && (r.s.current?.daysLost ?? 0) >= 2).sort((a, b) => (b.s.current?.daysLost ?? 0) - (a.s.current?.daysLost ?? 0));
    if (late.length === 0) return null;
    return {
      subject: `Escalation: ${late.length} driver${late.length === 1 ? "" : "s"} uncleared for 2+ working days`,
      heading: "Drivers losing days",
      intro: "These drivers have lost 2 or more working days this week without paying. The last-payment column shows whether any payment has been logged for them recently.",
      table: {
        head: ["Driver", "Car", "Days lost", "Owes", "Last payment logged"],
        rows: late.map((r) => {
          const last = [...r.deps].sort((a, b) => b.paid_date.localeCompare(a.paid_date))[0];
          return [esc(r.d.full_name), esc(car(r.d)), String(r.s.current?.daysLost ?? 0), rwf(r.s.owedNow), last ? `${day(last.paid_date)} · ${rwf(last.amount)}` : "None"];
        }),
      },
      inApp: `Escalation: ${late.length} drivers uncleared 2+ days`,
    };
  }

  if (key === "deposits_to_confirm") {
    const { drivers, deposits } = await loadFleet(ctx);
    const pending = deposits.filter((d) => d.status === "pending").sort((a, b) => a.paid_date.localeCompare(b.paid_date));
    if (pending.length === 0) return null;
    const name = (id: string | null) => ctx.profiles.find((p) => p.id === id)?.full_name ?? "—";
    const driverName = (id: string) => drivers.find((d) => d.id === id)?.full_name ?? "Unknown driver";
    const total = pending.reduce((s, d) => s + d.amount, 0);
    return {
      subject: `${pending.length} deposit${pending.length === 1 ? "" : "s"} waiting for confirmation (${rwf(total)})`,
      heading: "Deposits waiting for your confirmation",
      intro: "Please confirm each deposit once you've seen the money arrive, or reject it if it's a mistake. Open Deposit Confirmations in Kivu Daily.",
      table: { head: ["Driver", "Amount", "Paid on", "Logged by"], rows: pending.map((d) => [esc(driverName(d.driver_id)), rwf(d.amount), day(d.paid_date), esc(name(d.created_by))]) },
      inApp: `${pending.length} deposits waiting for confirmation`,
    };
  }

  return null;
}

// ------------------------------------------------------------------
// Instant events
// ------------------------------------------------------------------
async function buildEvent(key: string, payload: Record<string, unknown>, ctx: Ctx): Promise<Built | null> {
  if (key === "driver_new" || key === "driver_contract_ended") {
    const { drivers, deposits } = await loadFleet(ctx);
    const d = drivers.find((x) => x.id === payload.driver_id);
    if (!d) return null;
    if (key === "driver_new") {
      const first = d.start_date ? firstSundayPayment(d.start_date, d.rest_day) : null;
      return {
        subject: `New driver: ${d.full_name}${d.start_date ? ` starts ${day(d.start_date)}` : ""}`,
        heading: `New driver: ${esc(d.full_name)}`,
        intro: d.start_date
          ? `${esc(d.full_name)} (${esc(d.phone ?? "no phone")}) starts on <b>${day(d.start_date)}</b>${d.rest_day ? `, resting on ${d.rest_day}s` : ""}.`
            + `<br><br><b>${rwf(WEEKLY_DEPOSIT_AMOUNT)}</b> is due before the first shift${d.initial_deposit_paid ? " (already recorded as paid)" : ""}, then <b>${rwf(first!.amount)}</b> by Sunday ${day(first!.date)}, then ${rwf(WEEKLY_DEPOSIT_AMOUNT)} every Sunday.`
          : `${esc(d.full_name)} was added without a start date yet — their payment schedule starts once one is set.`,
        inApp: `New driver ${d.full_name}${d.start_date ? ` starts ${day(d.start_date)}` : ""}`,
      };
    }
    const s = computeDepositStanding(d, deposits.filter((x) => x.driver_id === d.id), ctx.today);
    const owed = s.ruleInForce ? s.owedNow : s.behind;
    return {
      subject: `Driver contract ended: ${d.full_name}`,
      heading: `Contract ended: ${esc(d.full_name)}`,
      intro: `${esc(d.full_name)}'s contract ended on ${day((payload.event_date as string) ?? ctx.today)}${payload.reason ? ` — ${esc(String(payload.reason))}` : ""}. No more payment reminders will go out for them.`
        + `<br><br>${owed > 0 ? `Balance still owed: <b>${rwf(owed)}</b>.` : "No balance owed."}`,
      inApp: `Contract ended: ${d.full_name}${owed > 0 ? ` (owes ${rwf(owed)})` : ""}`,
    };
  }

  if (key === "deposit_rejected") {
    return {
      subject: `Deposit rejected: ${payload.driver_name ?? "a driver"}, ${rwf(Number(payload.amount ?? 0))}`,
      heading: "A deposit you logged was rejected",
      intro: `${esc(String(payload.rejected_by ?? "Finance"))} rejected the ${rwf(Number(payload.amount ?? 0))} deposit you logged for <b>${esc(String(payload.driver_name ?? "a driver"))}</b> (paid ${day((payload.paid_date as string) ?? null)}).`
        + `<br><br>Reason: ${payload.reason ? esc(String(payload.reason)) : "none given"}. If the driver really did pay, log the correct payment again.`,
      inApp: `Deposit rejected: ${payload.driver_name ?? "a driver"} ${rwf(Number(payload.amount ?? 0))}`,
    };
  }
  return null;
}

// ------------------------------------------------------------------
// Recipients, rendering, outbox
// ------------------------------------------------------------------
function resolveAudience(audience: string[], ctx: Ctx, actorId?: string | null): Recipient[] {
  const out = new Map<string, Recipient>();
  const add = (p: Profile | undefined) => { if (p && p.is_active && p.email) out.set(p.id, { id: p.id, email: p.email, name: p.full_name }); };
  for (const token of audience) {
    if (token === "md") ctx.profiles.filter((p) => p.role === "managing_director").forEach(add);
    else if (token === "actor") add(ctx.profiles.find((p) => p.id === actorId));
    else if (token.startsWith("dept:")) ctx.profiles.filter((p) => p.department?.slug === token.slice(5)).forEach(add);
    else if (token.startsWith("resp:")) add(ctx.profiles.find((p) => p.id === ctx.responsibilities[token.slice(5)]));
  }
  return [...out.values()];
}

function render(b: Built, recipientName: string) {
  const table = b.table
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;">
        <tr>${b.table.head.map((h) => `<th style="text-align:left;padding:8px 6px;border-bottom:2px solid #e5e7eb;color:#17263A;">${h}</th>`).join("")}</tr>
        ${b.table.rows.map((r) => `<tr>${r.map((c) => `<td style="padding:8px 6px;border-bottom:1px solid #f1f5f9;">${c}</td>`).join("")}</tr>`).join("")}
      </table>`
    : "";
  const inner = `
    <div class="title">${b.heading}</div>
    <div class="content"><p class="greeting">Hi ${esc(recipientName.split(" ")[0])},</p><p>${b.intro}</p></div>
    ${table}
    ${b.footnote ? `<div class="content" style="font-size:12px;color:#888;"><p>${b.footnote}</p></div>` : ""}
    <div style="text-align:center;"><a href="${appUrl}" class="button">Open Kivu Daily</a></div>`;
  const text = [b.heading, "", b.intro.replace(/<br>/g, "\n").replace(/<[^>]+>/g, ""), "",
    ...(b.table ? [b.table.head.join(" | "), ...b.table.rows.map((r) => r.join(" | "))] : []), "", appUrl].join("\n");
  return { html: wrapEmail(inner), text };
}

async function enqueue(ctx: Ctx, ruleKey: string, dedupeBase: string, built: Built, recipients: Recipient[], isTest = false) {
  let queued = 0;
  for (const r of recipients) {
    const { html, text } = render(built, r.name);
    const { data, error } = await ctx.db.from("notification_outbox").upsert({
      rule_key: ruleKey,
      dedupe_key: `${dedupeBase}:${r.id}`,
      recipient_id: r.id,
      recipient_email: r.email,
      subject: isTest ? `[Test] ${built.subject}` : built.subject,
      html,
      text_body: text,
      in_app_message: built.inApp,
      is_test: isTest,
    }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    if (!error && data && data.length > 0) {
      queued++;
      if (!isTest) await ctx.db.from("notifications").insert({ user_id: r.id, type: ruleKey, message: built.inApp, link: null, read: false });
    }
  }
  return queued;
}

async function sendPending(db: SupabaseClient, onlyIds?: string[]) {
  let query = db.from("notification_outbox").select("*").neq("status", "sent").lt("attempts", 3).order("created_at").limit(50);
  if (onlyIds) query = query.in("id", onlyIds);
  const { data: rows } = await query;
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const row of rows ?? []) {
    const res = await sendWithResend(row.recipient_email, row.subject, row.html, row.text_body);
    await db.from("notification_outbox").update({
      status: res.success ? "sent" : "failed",
      attempts: row.attempts + 1,
      error: res.success ? null : res.error ?? "unknown error",
      sent_at: res.success ? new Date().toISOString() : null,
    }).eq("id", row.id);
    await db.from("email_logs").insert({
      user_id: row.recipient_id, email_type: row.rule_key, recipient_email: row.recipient_email,
      subject: row.subject, status: res.success ? "sent" : "failed", error_message: res.error ?? null,
    });
    results.push({ id: row.id, ok: res.success, error: res.error });
  }
  return results;
}

async function loadContext(db: SupabaseClient, today: string): Promise<Ctx> {
  const [{ data: profiles }, { data: resp }] = await Promise.all([
    db.from("profiles").select("id, full_name, email, role, is_active, department:departments(slug)"),
    db.from("responsibilities").select("key, profile_id"),
  ]);
  const responsibilities: Record<string, string | null> = {};
  for (const r of resp ?? []) responsibilities[r.key] = r.profile_id;
  return { db, today, profiles: (profiles ?? []) as unknown as Profile[], responsibilities };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Auth: the cron secret, or a signed-in MD (test sends only).
    let callerMdId: string | null = null;
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    if (!isCron) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: { user } } = await userClient.auth.getUser();
      const { data: caller } = user ? await db.from("profiles").select("id, role").eq("id", user.id).maybeSingle() : { data: null };
      if (!caller || caller.role !== "managing_director") return json({ error: "Unauthorized" }, 401);
      callerMdId = caller.id;
    }

    const clock = kigaliNow();
    const ctx = await loadContext(db, clock.today);
    const { data: rules } = await db.from("notification_rules").select("key, audience, enabled");
    const ruleMap = new Map((rules ?? []).map((r) => [r.key as string, r as { key: string; audience: string[]; enabled: boolean }]));

    // ---- Test: build one rule from live data, send to the MD only ----
    if (body?.mode === "test") {
      const key = String(body.rule_key ?? "");
      if (!ruleMap.has(key)) return json({ error: "Unknown rule" }, 400);
      let built: Built | null = null;
      if (SCHEDULE[key]) built = await buildScheduled(key, ctx, true);
      else if (key === "deposit_rejected") built = await buildEvent(key, { driver_name: "Example Driver", amount: 180000, paid_date: clock.today, reason: "Example — logged twice by mistake", rejected_by: "Finance" }, ctx);
      else {
        const { drivers } = await loadFleet(ctx);
        const sample = [...drivers].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (sample) built = await buildEvent(key, { driver_id: sample.id, event_date: clock.today, reason: "Example reason" }, ctx);
      }
      if (!built) return json({ sent: false, message: "Nothing to send for this rule right now - it would be skipped today." });
      // Test sends only ever go to the MD - the caller, or (from the
      // scheduler's secret, used for maintenance checks) the active MD.
      const md = ctx.profiles.find((p) => (callerMdId ? p.id === callerMdId : p.role === "managing_director" && p.is_active && !!p.email));
      if (!md?.email) return json({ error: "No MD email to send the test to" }, 400);
      await enqueue(ctx, key, `test:${key}:${Date.now()}`, built, [{ id: md.id, email: md.email, name: md.full_name }], true);
      const { data: queued } = await db.from("notification_outbox").select("id").eq("is_test", true).eq("rule_key", key).eq("status", "pending");
      const results = await sendPending(db, (queued ?? []).map((q) => q.id));
      const failed = results.find((r) => !r.ok);
      return json({ sent: !failed, error: failed?.error ?? null, to: md.email });
    }

    if (!isCron) return json({ error: "Unauthorized" }, 401);

    // ---- Preview: build rules for any date and return them, send nothing ----
    if (body?.mode === "preview") {
      const pctx = await loadContext(db, String(body.today ?? clock.today));
      const out: Record<string, unknown> = {};
      for (const key of SCHEDULE[body.rule_key] ? [body.rule_key as string] : Object.keys(SCHEDULE)) {
        const built = await buildScheduled(key, pctx, false);
        out[key] = built
          ? { subject: built.subject, rows: built.table?.rows.length ?? 0, to: resolveAudience(ruleMap.get(key)?.audience ?? [], pctx).map((r) => r.name) }
          : "skipped";
      }
      return json({ today: pctx.today, preview: out });
    }

    const summary = { scheduled: [] as string[], events: 0, queued: 0, sent: 0, failed: 0 };

    // ---- Scheduled digests ----
    for (const [key, sched] of Object.entries(SCHEDULE)) {
      const rule = ruleMap.get(key);
      if (!rule?.enabled || !sched.days.includes(clock.dow) || clock.minutes < sched.at || clock.minutes >= QUIET_FROM) continue;
      const { error: claimErr } = await db.from("notification_rule_runs").insert({ rule_key: key, period_key: clock.today });
      if (claimErr) continue; // already ran today
      const built = await buildScheduled(key, ctx, false);
      if (!built) continue;
      summary.scheduled.push(key);
      summary.queued += await enqueue(ctx, key, `${key}:${clock.today}`, built, resolveAudience(rule.audience, ctx));
    }

    // ---- Events ----
    const { data: events } = await db.from("notification_events").select("*").is("processed_at", null).order("created_at").limit(50);
    for (const ev of events ?? []) {
      const rule = ruleMap.get(ev.rule_key);
      if (rule?.enabled) {
        const built = await buildEvent(ev.rule_key, ev.payload ?? {}, ctx);
        if (built) summary.queued += await enqueue(ctx, ev.rule_key, `${ev.rule_key}:${ev.id}`, built, resolveAudience(rule.audience, ctx, (ev.payload ?? {}).recipient_id as string | undefined));
      }
      await db.from("notification_events").update({ processed_at: new Date().toISOString() }).eq("id", ev.id);
      summary.events++;
    }

    // ---- Send (held during quiet hours, 20:00-06:30 Kigali) ----
    if (clock.minutes >= QUIET_UNTIL && clock.minutes < QUIET_FROM) {
      const results = await sendPending(db);
      summary.sent = results.filter((r) => r.ok).length;
      summary.failed = results.filter((r) => !r.ok).length;
    }

    return json({ ok: true, kigali: `${clock.today} ${Math.floor(clock.minutes / 60)}:${String(clock.minutes % 60).padStart(2, "0")}`, ...summary });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
