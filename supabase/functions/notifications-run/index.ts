import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendWithResend } from "../_shared/email.ts";
import { renderEmail } from "./render.ts";
import { isoWeekday } from "../_shared/depositRules.ts";
import { Built, Ctx, longDay, Profile, Recipient, RuleDef, ScheduledRule } from "./core.ts";
import { driverRules } from "./drivers.ts";
import { financeRules } from "./finance.ts";
import { operationsRules } from "./operations.ts";
import { workspaceRules } from "./workspace.ts";
import { companyRules } from "./company.ts";
import { ticketRules } from "./tickets.ts";
import { shiftRules } from "./shifts.ts";
import { moneyRules } from "./money.ts";
import { outreachRules } from "./outreach.ts";

// Runs every 5 minutes (pg_cron -> pg_net, authenticated by a shared
// secret). Each run: (1) builds any scheduled email that's due today in
// Kigali time and hasn't run yet, (2) turns new database events into
// emails, (3) sends everything pending in the outbox. The MD can also
// call it with { mode: 'test', rule_key } to receive one rule's email
// themselves, built from live data, without anyone else being emailed.
// What each email says lives in the per-area modules; this file only
// decides when, to whom, and makes sure nothing goes out twice.

const RULES: Record<string, RuleDef> = { ...driverRules, ...financeRules, ...companyRules, ...operationsRules, ...workspaceRules, ...ticketRules, ...shiftRules, ...moneyRules, ...outreachRules };

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
// Notifications come from their own address, separate from account invites.
const notificationsFrom = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") || "Kivu Daily <updates@kivuride.com>";

const QUIET_FROM = 20 * 60;
const QUIET_UNTIL = 6 * 60 + 30;
// A scheduled email only goes out within 3 hours of its time - if a run
// is missed, a morning reminder arriving in the evening is worse than none.
const CATCH_UP = 180;

interface RuleRow { key: string; audience: string[]; enabled: boolean; in_app: boolean; preference_key: string | null }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function kigaliNow() {
  const k = new Date(Date.now() + 2 * 3600 * 1000);
  const today = k.toISOString().slice(0, 10);
  return { today, minutes: k.getUTCHours() * 60 + k.getUTCMinutes(), dow: isoWeekday(today) };
}

// ------------------------------------------------------------------
// Recipients
// ------------------------------------------------------------------
interface Audience { ctx: Ctx; prefs: Map<string, Record<string, boolean>> }

function resolveRecipients(rule: RuleRow, built: Built, a: Audience, payload: Record<string, unknown> = {}): Recipient[] {
  const { ctx } = a;
  const out = new Map<string, Recipient>();
  const add = (p: Profile | undefined) => { if (p && p.is_active && p.email) out.set(p.id, { id: p.id, email: p.email, name: p.full_name.trim() }); };
  if (built.recipients) {
    built.recipients.forEach((id) => add(ctx.profiles.find((p) => p.id === id)));
  } else {
    for (const token of rule.audience) {
      if (token === "md") ctx.profiles.filter((p) => p.role === "managing_director").forEach(add);
      else if (token === "employees") ctx.profiles.filter((p) => p.role === "employee").forEach(add);
      else if (token === "actor") add(ctx.profiles.find((p) => p.id === payload.recipient_id));
      else if (token.startsWith("dept:")) ctx.profiles.filter((p) => p.department?.slug === token.slice(5)).forEach(add);
      else if (token.startsWith("resp:")) add(ctx.profiles.find((p) => p.id === ctx.responsibilities[token.slice(5)]));
    }
  }
  // Nobody is emailed about something they just did themselves.
  if (payload.actor_id && payload.actor_id !== payload.recipient_id) out.delete(String(payload.actor_id));
  // Personal emails respect the person's own Settings switches.
  if (rule.preference_key) {
    for (const id of [...out.keys()]) if (a.prefs.get(id)?.[rule.preference_key] === false) out.delete(id);
  }
  return [...out.values()];
}

// ------------------------------------------------------------------
// Rendering & outbox
// ------------------------------------------------------------------
async function enqueue(ctx: Ctx, rule: RuleRow, dedupeBase: string, built: Built, recipients: Recipient[], isTest = false) {
  let queued = 0;
  for (const r of recipients) {
    const { html, text } = renderEmail(built, r.name, appUrl, longDay(ctx.today));
    const { data, error } = await ctx.db.from("notification_outbox").upsert({
      rule_key: rule.key,
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
      if (!isTest && rule.in_app) await ctx.db.from("notifications").insert({ user_id: r.id, type: rule.key, message: built.inApp, link: null, read: false });
    }
  }
  return queued;
}

// Runs can overlap (every new event triggers one, plus the 5-minute
// cron), so rows are claimed atomically before sending - two runs can
// never send the same email.
async function sendPending(db: SupabaseClient, onlyIds?: string[], ruleKeys?: string[]) {
  const { data: claimed, error: claimError } = await db.rpc("claim_notification_outbox", { p_limit: 50, p_only: onlyIds ?? null, p_rule_keys: ruleKeys ?? null });
  if (claimError) throw new Error(claimError.message);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const row of (claimed ?? []) as Record<string, any>[]) {
    const res = await sendWithResend(row.recipient_email, row.subject, row.html, row.text_body, undefined, notificationsFrom);
    await db.from("notification_outbox").update({
      status: res.success ? "sent" : "failed",
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
    db.from("profiles").select("id, full_name, email, role, is_active, department:departments(slug, name)"),
    db.from("responsibilities").select("key, profile_id"),
  ]);
  const responsibilities: Record<string, string | null> = {};
  for (const r of resp ?? []) responsibilities[r.key] = r.profile_id;
  return { db, today, profiles: (profiles ?? []) as unknown as Profile[], responsibilities, cache: new Map() };
}

async function loadPrefs(db: SupabaseClient) {
  const { data } = await db.from("email_preferences").select("*");
  return new Map((data ?? []).map((p: Record<string, unknown>) => [String(p.user_id), p as Record<string, boolean>]));
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
    const { data: ruleRows } = await db.from("notification_rules").select("key, audience, enabled, in_app, preference_key");
    const ruleMap = new Map((ruleRows ?? []).map((r) => [r.key as string, r as RuleRow]));

    // ---- Test: build one rule from live data, send to the MD only ----
    if (body?.mode === "test") {
      const key = String(body.rule_key ?? "");
      const def = RULES[key];
      const rule = ruleMap.get(key);
      if (!def || !rule) return json({ error: "Unknown rule" }, 400);
      let built: Built | null = null;
      if (def.kind === "scheduled") built = (await def.build(ctx, true))[0] ?? null;
      else {
        const sample = await def.sample(ctx);
        if (sample) built = await def.build(sample, ctx);
      }
      if (!built) return json({ sent: false, message: "Nothing to send for this rule right now - it would be skipped today." });
      // Test sends only ever go to the MD - the caller, or (from the
      // scheduler's secret, used for maintenance checks) the active MD.
      const md = ctx.profiles.find((p) => (callerMdId ? p.id === callerMdId : p.role === "managing_director" && p.is_active && !!p.email));
      if (!md?.email) return json({ error: "No MD email to send the test to" }, 400);
      await enqueue(ctx, rule, `test:${key}:${Date.now()}`, built, [{ id: md.id, email: md.email, name: md.full_name.trim() }], true);
      const { data: queued } = await db.from("notification_outbox").select("id").eq("is_test", true).eq("rule_key", key).eq("status", "pending");
      const results = await sendPending(db, (queued ?? []).map((q) => q.id));
      const failed = results.find((r) => !r.ok);
      return json({ sent: !failed, error: failed?.error ?? null, to: md.email });
    }

    if (!isCron) return json({ error: "Unauthorized" }, 401);
    const audience: Audience = { ctx, prefs: await loadPrefs(db) };

    // ---- Preview: build scheduled rules for any date, send nothing ----
    if (body?.mode === "preview") {
      const pctx = await loadContext(db, String(body.today ?? clock.today));
      const pa: Audience = { ctx: pctx, prefs: audience.prefs };
      const keys = body.rule_key ? [String(body.rule_key)] : Object.keys(RULES).filter((k) => RULES[k].kind === "scheduled");
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const def = RULES[key];
        const rule = ruleMap.get(key);
        if (!def || !rule || def.kind !== "scheduled") { out[key] = "not a scheduled rule"; continue; }
        const built = await def.build(pctx, false);
        // { html: true } also returns the rendered email, so the design can be
        // checked without sending anything.
        out[key] = built.length === 0 ? "skipped" : built.map((b) => ({
          subject: b.subject, to: resolveRecipients(rule, b, pa).map((r) => r.name),
          ...(body.html ? { html: renderEmail(b, "Preview", appUrl, longDay(pctx.today)).html } : {}),
        }));
      }
      return json({ today: pctx.today, preview: out });
    }

    const summary = { scheduled: [] as string[], events: 0, queued: 0, sent: 0, failed: 0, errors: [] as string[] };

    // ---- Standing duties: create today's recurring tasks once, from 05:00 ----
    if (clock.minutes >= 5 * 60) {
      const { error: claimErr } = await db.from("notification_rule_runs").insert({ rule_key: "recurring_tasks", period_key: clock.today });
      if (!claimErr) {
        const { error: genErr } = await db.rpc("generate_recurring_tasks", { p_date: clock.today });
        if (genErr) {
          summary.errors.push(`generate_recurring_tasks: ${genErr.message}`);
          await db.from("notification_rule_runs").delete().eq("rule_key", "recurring_tasks").eq("period_key", clock.today);
        }
      }
    }

    // ---- Scheduled emails ----
    for (const [key, def] of Object.entries(RULES)) {
      if (def.kind !== "scheduled") continue;
      const rule = ruleMap.get(key);
      const s = def as ScheduledRule;
      if (!rule?.enabled || !s.days.includes(clock.dow) || clock.minutes < s.at || clock.minutes >= s.at + CATCH_UP || clock.minutes >= QUIET_FROM) continue;
      if (s.when && !s.when(clock.today)) continue;
      const { error: claimErr } = await db.from("notification_rule_runs").insert({ rule_key: key, period_key: clock.today });
      if (claimErr) continue; // already ran today
      try {
        const built = await s.build(ctx, false);
        if (built.length) summary.scheduled.push(key);
        for (const b of built) summary.queued += await enqueue(ctx, rule, `${key}:${clock.today}`, b, resolveRecipients(rule, b, audience));
      } catch (err) {
        // One broken rule must never stop the others; free the claim so
        // the next run retries it.
        summary.errors.push(`${key}: ${err instanceof Error ? err.message : err}`);
        console.error("notifications-run rule failed", key, err);
        await db.from("notification_rule_runs").delete().eq("rule_key", key).eq("period_key", clock.today);
      }
    }

    // ---- Call Center shifts left open more than 10 hours ----
    const { error: staleError } = await db.rpc("auto_close_stale_shifts");
    if (staleError) summary.errors.push(`auto_close_stale_shifts: ${staleError.message}`);

    // ---- Two-hour response check (Script Book standard) ----
    const { error: overdueError } = await db.rpc("flag_response_overdue");
    if (overdueError) summary.errors.push(`flag_response_overdue: ${overdueError.message}`);

    // ---- Events ----
    const { data: events } = await db.from("notification_events").select("*").is("processed_at", null).order("created_at").limit(50);
    for (const ev of events ?? []) {
      const def = RULES[ev.rule_key];
      const rule = ruleMap.get(ev.rule_key);
      try {
        if (def?.kind === "event" && rule?.enabled) {
          const payload = (ev.payload ?? {}) as Record<string, unknown>;
          const built = await def.build(payload, ctx);
          if (built) summary.queued += await enqueue(ctx, rule, `${ev.rule_key}:${ev.id}`, built, resolveRecipients(rule, built, audience, payload));
        }
      } catch (err) {
        summary.errors.push(`${ev.rule_key}: ${err instanceof Error ? err.message : err}`);
        console.error("notifications-run event failed", ev.rule_key, ev.id, err);
      }
      await db.from("notification_events").update({ processed_at: new Date().toISOString() }).eq("id", ev.id);
      summary.events++;
    }

    // ---- Send. The call center is 24/7, so instant emails (new cases,
    // emergencies, replies) go out at any hour; scheduled digests that
    // are still pending wait until 06:30. ----
    const daytime = clock.minutes >= QUIET_UNTIL && clock.minutes < QUIET_FROM;
    const instantKeys = Object.keys(RULES).filter((k) => RULES[k].kind === "event");
    const results = await sendPending(db, undefined, daytime ? undefined : instantKeys);
    summary.sent = results.filter((r) => r.ok).length;
    summary.failed = results.filter((r) => !r.ok).length;

    return json({ ok: true, kigali: `${clock.today} ${Math.floor(clock.minutes / 60)}:${String(clock.minutes % 60).padStart(2, "0")}`, ...summary });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
