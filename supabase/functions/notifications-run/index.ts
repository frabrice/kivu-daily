import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendWithResend, wrapEmail } from "../_shared/email.ts";
import { isoWeekday } from "../_shared/depositRules.ts";
import { Built, Ctx, esc, firstName, Profile, Recipient, RuleDef, ScheduledRule } from "./core.ts";
import { driverRules } from "./drivers.ts";
import { financeRules } from "./finance.ts";
import { operationsRules } from "./operations.ts";
import { workspaceRules } from "./workspace.ts";
import { companyRules } from "./company.ts";
import { ticketRules } from "./tickets.ts";

// Runs every 5 minutes (pg_cron -> pg_net, authenticated by a shared
// secret). Each run: (1) builds any scheduled email that's due today in
// Kigali time and hasn't run yet, (2) turns new database events into
// emails, (3) sends everything pending in the outbox. The MD can also
// call it with { mode: 'test', rule_key } to receive one rule's email
// themselves, built from live data, without anyone else being emailed.
// What each email says lives in the per-area modules; this file only
// decides when, to whom, and makes sure nothing goes out twice.

const RULES: Record<string, RuleDef> = { ...driverRules, ...financeRules, ...companyRules, ...operationsRules, ...workspaceRules, ...ticketRules };

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
function htmlTable(t: { head: string[]; rows: string[][] }) {
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 16px;">
    ${t.head.some(Boolean) ? `<tr>${t.head.map((h) => `<th style="text-align:left;padding:8px 6px;border-bottom:2px solid #e5e7eb;color:#17263A;">${h}</th>`).join("")}</tr>` : ""}
    ${t.rows.map((r) => `<tr>${r.map((c) => `<td style="padding:8px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${c}</td>`).join("")}</tr>`).join("")}
  </table>`;
}

const plain = (s: string) => s.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function render(b: Built, recipientName: string) {
  const blocks = (b.blocks ?? []).map((bl) => `
    ${bl.heading ? `<div style="font-size:14px;font-weight:600;color:#17263A;margin:20px 0 6px;">${bl.heading}</div>` : ""}
    ${bl.text ? `<p style="margin:0 0 8px;font-size:14px;">${bl.text}</p>` : ""}
    ${bl.table ? htmlTable(bl.table) : ""}`).join("");
  const inner = `
    <div class="title">${b.heading}</div>
    <div class="content"><p class="greeting">Hi ${esc(firstName(recipientName))},</p><p>${b.intro}</p></div>
    ${b.table ? htmlTable(b.table) : ""}
    ${blocks}
    ${b.footnote ? `<div class="content" style="font-size:12px;color:#888;"><p>${b.footnote}</p></div>` : ""}
    <div style="text-align:center;margin-top:16px;"><a href="${b.cta ? `${appUrl.replace(/\/$/, "")}/?${b.cta.query}` : appUrl}" class="button">${b.cta?.label ?? "Open Kivu Daily"}</a></div>`;
  const tableText = (t?: { head: string[]; rows: string[][] }) => (t ? [t.head.join(" | "), ...t.rows.map((r) => r.join(" | "))] : []);
  const text = plain([
    b.heading, "", b.intro, "", ...tableText(b.table),
    ...(b.blocks ?? []).flatMap((bl) => ["", bl.heading ?? "", bl.text ?? "", ...tableText(bl.table)]),
    "", b.footnote ?? "", appUrl,
  ].join("\n"));
  return { html: wrapEmail(inner), text };
}

async function enqueue(ctx: Ctx, rule: RuleRow, dedupeBase: string, built: Built, recipients: Recipient[], isTest = false) {
  let queued = 0;
  for (const r of recipients) {
    const { html, text } = render(built, r.name);
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

async function sendPending(db: SupabaseClient, onlyIds?: string[]) {
  let query = db.from("notification_outbox").select("*").neq("status", "sent").lt("attempts", 3).order("created_at").limit(50);
  if (onlyIds) query = query.in("id", onlyIds);
  const { data: pending } = await query;
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const row of pending ?? []) {
    const res = await sendWithResend(row.recipient_email, row.subject, row.html, row.text_body, undefined, notificationsFrom);
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
        out[key] = built.length === 0 ? "skipped" : built.map((b) => ({ subject: b.subject, to: resolveRecipients(rule, b, pa).map((r) => r.name) }));
      }
      return json({ today: pctx.today, preview: out });
    }

    const summary = { scheduled: [] as string[], events: 0, queued: 0, sent: 0, failed: 0, errors: [] as string[] };

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
