import { Built, Ctx, day, esc, hm, RuleDef, rows, rwf } from "./core.ts";

// IT workspace (migration 20261017100000): the 10:00 and 14:00 "what are
// you working on?" check-ins (Mon-Fri), and the morning nudge about work
// In progress with no update for 3 days.

const MON_FRI = [1, 2, 3, 4, 5];
const ACTIVE = ["in_progress", "in_review", "testing"];
const key = (id: number) => `KR-${id}`;

interface MemberRow { profile_id: string; role: string; checks_in: boolean }
interface IssueRow { id: number; title: string; status: string; assignee_id: string | null; last_activity_at: string; started_at: string | null; planned: boolean }

const loadMembers = (ctx: Ctx) => rows<MemberRow>(ctx.db.from("it_members").select("profile_id, role, checks_in"));
const loadActive = (ctx: Ctx) => rows<IssueRow>(ctx.db.from("it_issues").select("id, title, status, assignee_id, last_activity_at, started_at, planned").in("status", ACTIVE));
const label = (s: string) => ({ in_progress: "In progress", in_review: "In review", testing: "Testing" } as Record<string, string>)[s] ?? s;

async function checkin(ctx: Ctx, slot: "morning" | "afternoon", force: boolean): Promise<Built[]> {
  const [members, active] = await Promise.all([loadMembers(ctx), loadActive(ctx)]);
  const already = await rows<{ profile_id: string; slot: string; confirmed_at: string | null }>(
    ctx.db.from("it_checkins").select("profile_id, slot, confirmed_at").eq("day", ctx.today));
  const out: Built[] = [];
  for (const m of members.filter((x) => x.checks_in)) {
    const p = ctx.profiles.find((x) => x.id === m.profile_id && x.is_active);
    if (!p) continue;
    if (!force && already.some((c) => c.profile_id === m.profile_id && c.slot === slot)) continue;
    // Someone who just confirmed on their own (within the last 2 hours) isn't asked again.
    const self = already.find((c) => c.profile_id === m.profile_id && c.slot === "self" && c.confirmed_at && Date.now() - Date.parse(c.confirmed_at) < 2 * 3600_000);
    if (self && !force) continue;
    if (!force) await ctx.db.from("it_checkins").upsert({ profile_id: m.profile_id, day: ctx.today, slot, asked_at: new Date().toISOString() }, { onConflict: "profile_id,day,slot", ignoreDuplicates: true });
    const mine = active.filter((i) => i.assignee_id === m.profile_id);
    const first = p.full_name.trim().split(/\s+/).slice(-1)[0];
    out.push(mine.length ? {
      subject: `Still on ${key(mine[0].id)}? Confirm what you're working on`,
      heading: "What are you working on?",
      intro: `Hi ${esc(first)}, the ${slot === "morning" ? "morning" : "afternoon"} check-in. You have <b>${mine.length}</b> issue${mine.length === 1 ? "" : "s"} in progress — confirm the one you're on now, or switch.`,
      table: { head: ["Issue", "Status", "Last update"], rows: mine.map((i) => [`${key(i.id)} · ${esc(i.title)}`, label(i.status), i.last_activity_at.slice(0, 10)]) },
      inApp: `Check-in: confirm you're working on ${key(mine[0].id)}`,
      recipients: [m.profile_id],
      cta: { label: "Confirm my work", query: "page=it_checkin" },
    } : {
      subject: "What are you working on? Nothing is In progress for you",
      heading: "What are you working on?",
      alert: { tone: "warning", text: "You have no issue In progress in Kivu Daily." },
      intro: `Hi ${esc(first)}, the ${slot === "morning" ? "morning" : "afternoon"} check-in. Pick the issue you're working on — or create it if it isn't there yet — so the team and the MD can see it.`,
      inApp: "Check-in: pick what you're working on",
      recipients: [m.profile_id],
      cta: { label: "Pick my work", query: "page=it_checkin" },
    });
  }
  return out;
}

async function stale(ctx: Ctx): Promise<Built[]> {
  const [members, active] = await Promise.all([loadMembers(ctx), loadActive(ctx)]);
  const old = active.filter((i) => Date.now() - Date.parse(i.last_activity_at) >= 3 * 86400_000);
  if (!old.length) return [];
  const days = (i: IssueRow) => Math.floor((Date.now() - Date.parse(i.last_activity_at)) / 86400_000);
  const name = (id: string | null) => ctx.profiles.find((p) => p.id === id)?.full_name.trim() ?? "Nobody";
  const out: Built[] = [];
  const byPerson = new Map<string, IssueRow[]>();
  for (const i of old) if (i.assignee_id) byPerson.set(i.assignee_id, [...(byPerson.get(i.assignee_id) ?? []), i]);
  for (const [pid, list] of byPerson) {
    out.push({
      subject: `${list.length} issue${list.length === 1 ? "" : "s"} with no update for 3+ days`,
      heading: "Is this still moving?",
      intro: "These are In progress in your name but nothing has changed for 3 days or more. Add an update, mark them blocked, or move them on.",
      table: { head: ["Issue", "Status", "No update for"], rows: list.map((i) => [`${key(i.id)} · ${esc(i.title)}`, label(i.status), `${days(i)} days`]) },
      inApp: `${list.length} of your IT issues have had no update for 3+ days`,
      recipients: [pid],
      cta: { label: "Open my issues", query: "page=it_issue" },
    });
  }
  const leads = members.filter((m) => m.role === "head").map((m) => m.profile_id);
  if (leads.length) out.push({
    subject: `Stalled IT work: ${old.length} issue${old.length === 1 ? "" : "s"} with no update for 3+ days`,
    heading: "Stalled work",
    intro: "Issues In progress with nothing new for 3 days or more.",
    table: { head: ["Issue", "Who", "No update for"], rows: old.map((i) => [`${key(i.id)} · ${esc(i.title)}`, esc(name(i.assignee_id)), `${days(i)} days`]) },
    inApp: `${old.length} IT issues have stalled`,
    recipients: leads,
    cta: { label: "Open IT team", query: "page=it_checkin" },
  });
  return out;
}

// Projects on the roadmap (migration 20261018100000): the head of IT asks
// the MD to approve a project and its budget; the owner hears the decision.
interface InitiativeRow { id: string; number: number; name: string; problem: string | null; outcome: string | null; owner_id: string | null; start_date: string | null; target_date: string | null; status: string; approved_budget: number | null; decision_note: string | null; proposed_at: string | null; approved_at: string | null }
interface LineRow { category: string; description: string; amount: number; recurrence: string; months: number }
const CATEGORY: Record<string, string> = { people: "People & time", tools: "Tools & subscriptions", cloud: "Cloud & hosting", ai: "AI services", devices: "Devices & hardware", contractors: "Contractors", other: "Other" };
const lineTotal = (l: LineRow) => Number(l.amount) * (l.recurrence === "monthly" ? l.months : 1);
async function loadInitiative(ctx: Ctx, id: unknown) {
  const [i] = await rows<InitiativeRow>(ctx.db.from("it_initiatives").select("id, number, name, problem, outcome, owner_id, start_date, target_date, status, approved_budget, decision_note, proposed_at, approved_at").eq("id", String(id)));
  if (!i) return null;
  const lines = await rows<LineRow>(ctx.db.from("it_budget_lines").select("category, description, amount, recurrence, months").eq("initiative_id", i.id).order("created_at"));
  return { i, lines, planned: lines.reduce((s, l) => s + lineTotal(l), 0) };
}
const latestInitiative = async (ctx: Ctx, col: "proposed_at" | "approved_at") => {
  const [x] = await rows<{ id: string }>(ctx.db.from("it_initiatives").select("id").not(col, "is", null).order(col, { ascending: false }).limit(1));
  return x ? { initiative_id: x.id, approved: true } : null;
};
const who = (ctx: Ctx, id: unknown) => ctx.profiles.find((p) => p.id === id)?.full_name.trim() || "Someone";
const projectName = (i: InitiativeRow) => `I${i.number} · ${i.name}`;

export const itRules: Record<string, RuleDef> = {
  it_initiative_proposed: {
    kind: "event",
    sample: (ctx) => latestInitiative(ctx, "proposed_at"),
    build: async (p, ctx) => {
      const x = await loadInitiative(ctx, p.initiative_id);
      if (!x) return null;
      const { i, lines, planned } = x;
      const bigger = i.approved_budget !== null;
      return {
        subject: bigger ? `Bigger budget to approve: ${projectName(i)} (${rwf(planned)})` : `Project to approve: ${projectName(i)} (${rwf(planned)})`,
        heading: bigger ? "A project needs a bigger budget" : "A project is waiting for your approval",
        intro: `<b>${esc(who(ctx, p.actor_id))}</b> asks you to approve <b>${esc(projectName(i))}</b>`
          + (bigger ? `: the budget grew from ${rwf(Number(i.approved_budget))} to <b>${rwf(planned)}</b>.` : ` with a budget of <b>${rwf(planned)}</b>.`)
          + `<br><br><b>Problem:</b> ${esc(i.problem ?? "—").replace(/\n/g, "<br>")}`
          + `<br><b>Outcome:</b> ${esc(i.outcome ?? "—").replace(/\n/g, "<br>")}`
          + `<br><b>Dates:</b> ${day(i.start_date)} → ${day(i.target_date)} · <b>Owner:</b> ${esc(who(ctx, i.owner_id))}`,
        table: lines.length ? { head: ["Budget line", "Category", "Total"], rows: [...lines.map((l) => [esc(l.description) + (l.recurrence === "monthly" ? ` (${rwf(Number(l.amount))} × ${l.months} months)` : ""), CATEGORY[l.category] ?? l.category, rwf(lineTotal(l))]), ["<b>Total</b>", "", `<b>${rwf(planned)}</b>`]] } : undefined,
        inApp: `Approve or decline ${projectName(i)} (${rwf(planned)})`,
        cta: { label: "Approve or decline", query: `page=it_roadmap&i=${i.id}` },
      };
    },
  },
  it_initiative_decided: {
    kind: "event",
    sample: (ctx) => latestInitiative(ctx, "approved_at"),
    build: async (p, ctx) => {
      const x = await loadInitiative(ctx, p.initiative_id);
      if (!x) return null;
      const { i } = x;
      const yes = p.approved === true;
      if (!yes && p.kept_budget === true) return {
        subject: `Budget kept at ${rwf(Number(i.approved_budget ?? 0))}: ${projectName(i)}`,
        heading: "The bigger budget was not approved",
        intro: `<b>${esc(who(ctx, p.actor_id))}</b> kept <b>${esc(projectName(i))}</b> on its approved budget of <b>${rwf(Number(i.approved_budget ?? 0))}</b>. The project keeps running; trim the budget lines to fit.`
          + (i.decision_note ? `<br><br>“${esc(i.decision_note)}”` : ""),
        inApp: `Budget kept at ${rwf(Number(i.approved_budget ?? 0))}: ${projectName(i)}`,
        cta: { label: "Open the project", query: `page=it_roadmap&i=${i.id}` },
      };
      return {
        subject: yes ? `Approved: ${projectName(i)} — ${rwf(Number(i.approved_budget ?? 0))}` : `Declined: ${projectName(i)}`,
        heading: yes ? "Your project is approved" : "Your project was declined",
        intro: `<b>${esc(who(ctx, p.actor_id))}</b> ${yes ? `approved <b>${esc(projectName(i))}</b> with a budget of <b>${rwf(Number(i.approved_budget ?? 0))}</b>. You can start it: set it In progress on the roadmap and plan its milestones.` : `declined <b>${esc(projectName(i))}</b>.`}`
          + (i.decision_note ? `<br><br>“${esc(i.decision_note)}”` : ""),
        inApp: yes ? `Approved: ${projectName(i)} (${rwf(Number(i.approved_budget ?? 0))})` : `Declined: ${projectName(i)}`,
        cta: { label: "Open the project", query: `page=it_roadmap&i=${i.id}` },
      };
    },
  },
  it_checkin_morning: { kind: "scheduled", days: MON_FRI, at: hm(10), build: (ctx, force) => checkin(ctx, "morning", force), testAll: true },
  it_checkin_afternoon: { kind: "scheduled", days: MON_FRI, at: hm(14), build: (ctx, force) => checkin(ctx, "afternoon", force), testAll: true },
  it_stale_work: { kind: "scheduled", days: MON_FRI, at: hm(9), build: (ctx) => stale(ctx), testAll: true },
};
