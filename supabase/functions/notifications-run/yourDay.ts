import Anthropic from "npm:@anthropic-ai/sdk";
import { Block, Built, Ctx, esc, firstName, plural, Profile, Tone } from "./core.ts";
import { loadTodayTasks, TodayTask } from "./smartTasks.ts";

// "Your day" (07:00): one email per person instead of many. Order:
//   focus line -> what needs you today (smart + own tasks) -> since
//   yesterday (instant-but-not-urgent events) -> the reports for your role.
// "Still open" (16:00): only when a high-priority task is still open.
//
// The focus line is written by Claude when ANTHROPIC_API_KEY is set (from
// the real numbers only - any number not in the facts rejects the text);
// otherwise, or on any error, a plain rule-based line is used.

export interface BundledPart { ruleKey: string; built: Built }
export interface DigestLine { id: string; rule_key: string; line: string; created_at: string }

// Reports in the order they appear in the email.
const SECTION_ORDER = ["driver_payments_morning", "money_daily", "finance_daily_digest", "md_daily_digest", "outreach_interested_fleet"];
// Inside the morning email some reports get a shorter title, and the MD's
// company briefing drops parts another section already covers.
const SECTION_TITLE: Record<string, string> = { money_daily: "Money & growth", md_daily_digest: "Company today", finance_daily_digest: "Finance today" };
const DUPLICATE_BLOCKS: Record<string, { ifPresent: string; headings: string[] }> = {
  md_daily_digest: { ifPresent: "driver_payments_morning", headings: ["Driver payments"] },
};
const DIGEST_LABEL: Record<string, string> = {
  shift_report: "Call Center shifts", shift_not_closed: "Call Center shifts", driver_new: "Drivers", driver_contract_ended: "Drivers",
  driver_contract_fleet: "Drivers", car_interest_recorded: "Non-Insider cars", ticket_activity: "Call Center cases", ticket_resolved: "Call Center cases",
};

const personShort = (ctx: Ctx, id: string) => ctx.profiles.find((p) => p.id === id)?.full_name.trim() ?? "—";
const bullets = (t: TodayTask) => (t.description ?? "").split("\n").filter((l) => l.startsWith("• ")).map((l) => l.slice(2));
const progress = (t: TodayTask) => (t.smart_total && t.smart_total > 1 ? ` (${t.smart_done ?? 0}/${t.smart_total})` : "");
const rank = (t: TodayTask) => (t.priority === "high" ? 0 : t.smart_key ? 1 : 2);
const sortTasks = (a: TodayTask, b: TodayTask) => rank(a) - rank(b) || (a.due_time ?? "99").localeCompare(b.due_time ?? "99") || a.title.localeCompare(b.title);

function taskTable(tasks: TodayTask[]): Block["table"] {
  return {
    head: ["What", "Details", "By"],
    rows: tasks.map((t) => {
      const b = bullets(t);
      const details = b.length
        ? `${b.slice(0, 4).map((x) => esc(x)).join("<br>")}${b.length > 4 ? `<br><span style="color:#6b7280;">+ ${b.length - 4} more in Kivu Daily</span>` : ""}`
        : t.recurring_task_id ? '<span style="color:#6b7280;">Standing duty</span>' : '<span style="color:#6b7280;">Your task</span>';
      return [`<b>${esc(t.title)}</b>${progress(t)}`, details, t.due_time ?? "Today"];
    }),
    align: ["left", "left", "right"],
    tones: tasks.map((t) => (t.priority === "high" ? "warning" as Tone : null)),
    phoneHide: [],
  };
}

function ruleFocus(p: Profile, tasks: TodayTask[], parts: BundledPart[], digest: DigestLine[]): string {
  const high = tasks.filter((t) => t.priority === "high");
  const lines: string[] = [];
  if (tasks.length) {
    const first = (high[0] ?? tasks[0]);
    lines.push(`Start with <b>${esc(first.title.charAt(0).toLowerCase() + first.title.slice(1))}</b>${first.due_time ? ` before ${first.due_time}` : ""}.`);
    if (tasks.length > 1) lines.push(`${plural(tasks.length - 1, "more thing")} after that${high.length > 1 ? ` — ${high.length - 1} of them urgent` : ""}.`);
  } else lines.push("Nothing is waiting on you right now.");
  if (digest.length) lines.push(`${plural(digest.length, "update")} since yesterday below.`);
  if (parts.length) lines.push(`Your ${parts.length === 1 ? "report is" : "reports are"} at the end.`);
  return lines.join(" ");
}

// Claude-written focus, grounded on the facts. Returns null to fall back.
async function aiFocus(p: Profile, tasks: TodayTask[], parts: BundledPart[], digest: DigestLine[]): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const facts = {
    person: firstName(p.full_name), role: p.department?.name ?? (p.role === "managing_director" ? "Managing Director" : "Employee"),
    tasks: tasks.slice(0, 8).map((t) => ({ task: t.title, urgent: t.priority === "high", by: t.due_time, items: bullets(t).slice(0, 5) })),
    reports: parts.map((x) => x.built.subject),
    since_yesterday: digest.slice(0, 12).map((d) => d.line),
  };
  const factsText = JSON.stringify(facts);
  try {
    const client = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 1 });
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: "You write the opening paragraph of a staff member's morning email at Kivu Ride, an electric ride-hailing company in Kigali. Write 2 or 3 short sentences in plain English that tell this person what matters most today and in what order. Use only the facts provided: never invent names, amounts or counts, and only use numbers that appear in the facts. No greeting, no sign-off, no lists, no markdown.",
      messages: [{ role: "user", content: `Facts for today (JSON):\n${factsText}` }],
    } as unknown as Parameters<typeof client.beta.messages.create>[0]) as Anthropic.Beta.BetaMessage;
    if (res.stop_reason === "refusal") return null;
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
    if (!text || text.length > 700) return null;
    // Grounding check: every number in the text must appear in the facts.
    const nums = text.match(/\d[\d,.]*/g) ?? [];
    if (nums.some((n) => !factsText.includes(n.replace(/[.,]$/, "")))) return null;
    return esc(text);
  } catch (err) {
    console.error("your_day focus: falling back to rule-based text", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function composeYourDay(ctx: Ctx, parts: Map<string, BundledPart[]>, digest: Map<string, DigestLine[]>): Promise<Built[]> {
  const all = await loadTodayTasks(ctx);
  const tasks = all.filter((t) => !t.completed);
  const teamTasks = all.filter((t) => t.smart_key && !t.completed);
  const people = ctx.profiles.filter((p) => p.is_active && p.email);
  const out: Built[] = [];
  await Promise.all(people.map(async (p) => {
    const mine = tasks.filter((t) => t.user_id === p.id).sort(sortTasks);
    const myParts = (parts.get(p.id) ?? []).sort((a, b) => SECTION_ORDER.indexOf(a.ruleKey) - SECTION_ORDER.indexOf(b.ruleKey));
    const myDigest = digest.get(p.id) ?? [];
    if (!mine.length && !myParts.length && !myDigest.length) return;

    const focus = (await aiFocus(p, mine, myParts, myDigest)) ?? ruleFocus(p, mine, myParts, myDigest);
    const blocks: Block[] = [];
    if (mine.length) blocks.push({ heading: `Needs you today (${mine.length})`, table: taskTable(mine) });
    if (myDigest.length) {
      const groups = new Map<string, DigestLine[]>();
      for (const d of myDigest) groups.set(DIGEST_LABEL[d.rule_key] ?? "Updates", [...(groups.get(DIGEST_LABEL[d.rule_key] ?? "Updates") ?? []), d]);
      blocks.push({
        heading: `Since yesterday (${myDigest.length})`,
        table: { head: ["", ""], rows: [...groups].flatMap(([label, list]) => list.slice(0, 12).map((d, i) => [i === 0 ? `<b>${esc(label)}</b>` : "", esc(d.line)])), align: ["left", "left"] },
      });
    }
    // The MD sees how the team's smart tasks are going (accountability).
    if (p.role === "managing_director") {
      const team = teamTasks.filter((t) => t.user_id !== p.id).sort(sortTasks);
      if (team.length) blocks.push({
        heading: `Team's tasks today (${team.length})`,
        text: "Created from live data; each ticks itself off as the work gets done.",
        table: {
          head: ["Person", "Task", "Progress"],
          rows: team.map((t) => [esc(personShort(ctx, t.user_id)), esc(t.title), t.smart_total ? `${t.smart_done ?? 0} / ${t.smart_total}` : "—"]),
          align: ["left", "left", "right"],
          tones: team.map((t) => (t.priority === "high" && !(t.smart_done ?? 0) ? "warning" as Tone : null)),
        },
      });
    }
    const keys = new Set(myParts.map((x) => x.ruleKey));
    for (const part of myParts) {
      const b = part.built;
      const dup = DUPLICATE_BLOCKS[part.ruleKey];
      const title = SECTION_TITLE[part.ruleKey];
      blocks.push({ heading: title ?? b.heading, text: title === "Company today" ? undefined : b.intro, alert: b.alert, stats: b.stats, table: b.table });
      for (const sub of b.blocks ?? []) if (!(dup && keys.has(dup.ifPresent) && sub.heading && dup.headings.includes(sub.heading))) blocks.push(sub);
    }

    const high = mine.filter((t) => t.priority === "high").length;
    const top = mine.slice(0, 2).map((t) => t.title).join(" · ");
    out.push({
      recipients: [p.id],
      subject: mine.length
        ? `Your day: ${plural(mine.length, "thing needs", "things need")} you${high ? ` (${high} urgent)` : ""} — ${top}`
        : `Your day: ${myParts[0]?.built.subject ?? `${plural(myDigest.length, "update")} since yesterday`}`,
      heading: mine.length ? `${plural(mine.length, "thing needs", "things need")} you today` : "Here's your day",
      intro: focus,
      blocks,
      inApp: mine.length ? `Your day: ${plural(mine.length, "thing needs", "things need")} you` : "Your day is ready",
    });
  }));
  return out;
}

export async function composeUrgentNudge(ctx: Ctx): Promise<Built[]> {
  const open = (await loadTodayTasks(ctx)).filter((t) => !t.completed && t.priority === "high");
  return ctx.profiles.filter((p) => p.is_active && p.email).flatMap((p): Built[] => {
    const mine = open.filter((t) => t.user_id === p.id).sort(sortTasks);
    if (!mine.length) return [];
    return [{
      recipients: [p.id],
      subject: `Still open: ${mine.map((t) => t.title).slice(0, 2).join(" · ")}`,
      heading: `${plural(mine.length, "urgent thing is", "urgent things are")} still open`,
      intro: `${esc(firstName(p.full_name))}, these are the urgent ones left for today. They tick off by themselves as the work gets done.`,
      blocks: [{ table: taskTable(mine) }],
      inApp: `${plural(mine.length, "urgent task")} still open`,
    }];
  });
}
